import { events } from '@dropins/tools/event-bus.js';
import { render as provider } from '@dropins/storefront-cart/render.js';
import * as Cart from '@dropins/storefront-cart/api.js';
import { h } from '@dropins/tools/preact.js';
import {
  InLineAlert,
  Icon,
  Button,
  provider as UI,
} from '@dropins/tools/components.js';

// Dropin Containers
import CartSummaryList from '@dropins/storefront-cart/containers/CartSummaryList.js';
import OrderSummary from '@dropins/storefront-cart/containers/OrderSummary.js';
import EstimateShipping from '@dropins/storefront-cart/containers/EstimateShipping.js';
import Coupons from '@dropins/storefront-cart/containers/Coupons.js';
import GiftCards from '@dropins/storefront-cart/containers/GiftCards.js';
import GiftOptions from '@dropins/storefront-cart/containers/GiftOptions.js';
import { render as wishlistRender } from '@dropins/storefront-wishlist/render.js';
import { WishlistToggle } from '@dropins/storefront-wishlist/containers/WishlistToggle.js';
import { WishlistAlert } from '@dropins/storefront-wishlist/containers/WishlistAlert.js';
import { tryRenderAemAssetsImage } from '@dropins/tools/lib/aem/assets.js';

// API
import { publishShoppingCartViewEvent } from '@dropins/storefront-cart/api.js';

// Modal and Mini PDP
import createMiniPDP from '../../scripts/components/commerce-mini-pdp/commerce-mini-pdp.js';
import createModal from '../modal/modal.js';

// Initializers
import '../../scripts/initializers/cart.js';
import '../../scripts/initializers/wishlist.js';
import '../../scripts/initializers/auth.js';

import { readBlockConfig } from '../../scripts/aem.js';
import {
  fetchPlaceholders,
  rootLink,
  getProductLink,
  checkIsAuthenticated,
  CUSTOMER_LOGIN_PATH,
} from '../../scripts/commerce.js';
import {
  getSavedForLaterItems,
  saveItemForLater,
  removeSavedForLaterItem,
  formatSavedItemPrice,
  buildSavedItemId,
  ensureSaveForLaterCustomerIdentity,
  syncSaveForLaterAuthState,
} from '../../scripts/save-for-later.js';

export default async function decorate(block) {
  // Configuration
  const {
    'hide-heading': hideHeading = 'false',
    'max-items': maxItems,
    'hide-attributes': hideAttributes = '',
    'enable-item-quantity-update': enableUpdateItemQuantity = 'false',
    'enable-item-remove': enableRemoveItem = 'true',
    'enable-estimate-shipping': enableEstimateShipping = 'false',
    'start-shopping-url': startShoppingURL = '',
    'checkout-url': checkoutURL = '',
    'enable-updating-product': enableUpdatingProduct = 'false',
    'undo-remove-item': undo = 'false',
    'enable-save-for-later': enableSaveForLater = 'true',
  } = readBlockConfig(block);

  const placeholders = await fetchPlaceholders();
  const saveForLaterEnabled = enableSaveForLater === 'true';

  const labels = {
    saveForLater: placeholders?.Global?.CartSaveForLater || 'Save for later',
    savedForLater: placeholders?.Global?.CartSavedForLater || 'Saved for later',
    addToCart: placeholders?.Global?.CartSavedAddToCart || 'Add to cart',
    remove: placeholders?.Global?.CartSavedRemove || 'Remove',
    saveError: placeholders?.Global?.CartSaveForLaterError || 'Unable to save this item for later. Please try again.',
    addError: placeholders?.Global?.CartSavedAddToCartError || 'Unable to move this item back to the cart. Please try again.',
  };

  // Modal state
  let currentModal = null;
  let currentNotification = null;

  // Layout
  const fragment = document.createRange().createContextualFragment(`
    <div class="cart__notification"></div>
    <div class="cart__wrapper">
      <div class="cart__left-column">
        <div class="cart__list"></div>
      </div>
      <div class="cart__right-column">
        <div class="cart__order-summary"></div>
        <div class="cart__gift-options"></div>
      </div>
    </div>

    <div class="cart__empty-cart"></div>
    <div class="cart__save-for-later" hidden></div>
  `);

  const $wrapper = fragment.querySelector('.cart__wrapper');
  const $notification = fragment.querySelector('.cart__notification');
  const $list = fragment.querySelector('.cart__list');
  const $summary = fragment.querySelector('.cart__order-summary');
  const $emptyCart = fragment.querySelector('.cart__empty-cart');
  const $giftOptions = fragment.querySelector('.cart__gift-options');
  const $rightColumn = fragment.querySelector('.cart__right-column');
  const $saveForLater = fragment.querySelector('.cart__save-for-later');

  block.innerHTML = '';
  block.appendChild(fragment);

  // Wishlist variables
  const routeToWishlist = '/wishlist';

  // Toggle Empty Cart
  function toggleEmptyCart(_state) {
    $wrapper.removeAttribute('hidden');
    $emptyCart.setAttribute('hidden', '');
  }

  async function showNotification(heading, type = 'success') {
    currentNotification?.remove();
    currentNotification = await UI.render(InLineAlert, {
      heading,
      type,
      variant: 'primary',
      icon: h(Icon, { source: type === 'error' ? 'AlertWithCircle' : 'CheckWithCircle' }),
      'aria-live': 'assertive',
      role: 'alert',
      onDismiss: () => {
        currentNotification?.remove();
      },
    })($notification);

    setTimeout(() => {
      currentNotification?.remove();
    }, 5000);
  }

  function redirectToLoginFromCart() {
    const returnPath = `${window.location.pathname}${window.location.search}` || rootLink('/cart');
    const loginUrl = new URL(rootLink(CUSTOMER_LOGIN_PATH), window.location.origin);
    loginUrl.searchParams.set('redirect', returnPath);
    window.location.href = loginUrl.href;
  }

  async function refreshSaveForLaterSection() {
    if (!saveForLaterEnabled || !checkIsAuthenticated()) {
      syncSaveForLaterAuthState(false);
      $saveForLater.hidden = true;
      $saveForLater.innerHTML = '';
      return;
    }

    await ensureSaveForLaterCustomerIdentity();
    renderSaveForLaterSection();
  }

  function renderSaveForLaterSection() {
    // Saved for later is only available for logged-in customers with resolved email
    if (!saveForLaterEnabled || !checkIsAuthenticated()) {
      $saveForLater.hidden = true;
      $saveForLater.innerHTML = '';
      return;
    }

    const items = getSavedForLaterItems();
    if (!items.length) {
      $saveForLater.hidden = true;
      $saveForLater.innerHTML = '';
      return;
    }

    $saveForLater.hidden = false;
    $saveForLater.innerHTML = `
      <h2 class="cart__save-for-later-title">${labels.savedForLater}</h2>
      <ul class="cart__save-for-later-list"></ul>
    `;

    const $itemsList = $saveForLater.querySelector('.cart__save-for-later-list');

    items.forEach((item) => {
      const $li = document.createElement('li');
      $li.className = 'cart__save-for-later-item';
      $li.dataset.savedId = item.id;

      const productHref = item.urlKey
        ? getProductLink(item.urlKey, item.topLevelSku || item.sku)
        : '#';
      const optionText = (item.optionLabels || []).join(', ');
      const priceText = formatSavedItemPrice(item.price);

      $li.innerHTML = `
        <a class="cart__save-for-later-image-link" href="${productHref}">
          <img
            class="cart__save-for-later-image"
            src="${item.image?.src || ''}"
            alt="${item.image?.alt || item.name || ''}"
            width="96"
            height="96"
            loading="lazy"
          />
        </a>
        <div class="cart__save-for-later-details">
          <div class="cart__save-for-later-main">
            <a class="cart__save-for-later-name" href="${productHref}">${item.name || ''}</a>
            ${optionText ? `<p class="cart__save-for-later-options">${optionText}</p>` : ''}
            <div class="cart__save-for-later-actions">
              <button type="button" class="cart__save-for-later-action" data-action="remove">${labels.remove}</button>
              <span class="cart__save-for-later-separator" aria-hidden="true"></span>
              <button type="button" class="cart__save-for-later-action" data-action="add-to-cart">${labels.addToCart}</button>
            </div>
          </div>
          <div class="cart__save-for-later-price">${priceText}</div>
        </div>
      `;

      $li.querySelector('[data-action="remove"]').addEventListener('click', () => {
        removeSavedForLaterItem(item.id);
        renderSaveForLaterSection();
      });

      $li.querySelector('[data-action="add-to-cart"]').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          const payload = {
            sku: item.sku,
            parentSku: item.topLevelSku !== item.sku ? item.topLevelSku : undefined,
            quantity: item.quantity || 1,
          };
          if (item.optionsUIDs?.length) {
            payload.optionsUIDs = item.optionsUIDs;
          }

          await Cart.addProductsToCart([payload]);
          removeSavedForLaterItem(item.id);
          renderSaveForLaterSection();
        } catch (error) {
          console.error('Save for later: add to cart failed', error);
          button.disabled = false;
          showNotification(labels.addError, 'error');
        }
      });

      $itemsList.appendChild($li);
    });
  }

  async function handleSaveForLater(cartItem, trigger) {
    if (!checkIsAuthenticated()) {
      redirectToLoginFromCart();
      return;
    }

    if (trigger) trigger.disabled = true;
    const savedId = buildSavedItemId(cartItem);
    try {
      const email = await ensureSaveForLaterCustomerIdentity();
      if (!email) {
        throw new Error('Customer email unavailable');
      }
      saveItemForLater(cartItem);
      await Cart.updateProductsFromCart([{ uid: cartItem.uid, quantity: 0 }]);
      renderSaveForLaterSection();
    } catch (error) {
      console.error('Save for later failed', error);
      removeSavedForLaterItem(savedId);
      if (trigger) trigger.disabled = false;
      showNotification(labels.saveError, 'error');
    }
  }

  // Handle Edit Button Click
  async function handleEditButtonClick(cartItem) {
    try {
      // Create mini PDP content
      const miniPDPContent = await createMiniPDP(
        cartItem,
        async (_updateData) => {
          // Show success message when mini-PDP updates item
          const productName = cartItem.name
            || cartItem.product?.name
            || placeholders?.Global?.CartUpdatedProductName;
          const message = placeholders?.Global?.CartUpdatedProductMessage?.replace(
            '{product}',
            productName,
          );

          // Clear any existing notifications
          currentNotification?.remove();

          currentNotification = await UI.render(InLineAlert, {
            heading: message,
            type: 'success',
            variant: 'primary',
            icon: h(Icon, { source: 'CheckWithCircle' }),
            'aria-live': 'assertive',
            role: 'alert',
            onDismiss: () => {
              currentNotification?.remove();
            },
          })($notification);

          // Auto-dismiss after 5 seconds
          setTimeout(() => {
            currentNotification?.remove();
          }, 5000);
        },
        () => {
          if (currentModal) {
            currentModal.removeModal();
            currentModal = null;
          }
        },
      );

      // Create and show modal
      currentModal = await createModal([miniPDPContent]);

      if (currentModal.block) {
        currentModal.block.setAttribute('id', 'mini-pdp-modal');
      }

      currentModal.showModal();
    } catch (error) {
      console.error('Error opening mini PDP modal:', error);

      // Clear any existing notifications
      currentNotification?.remove();

      // Show error notification
      currentNotification = await UI.render(InLineAlert, {
        heading: placeholders?.Global?.ProductLoadError,
        type: 'error',
        variant: 'primary',
        icon: h(Icon, { source: 'AlertWithCircle' }),
        'aria-live': 'assertive',
        role: 'alert',
        onDismiss: () => {
          currentNotification?.remove();
        },
      })($notification);
    }
  }

  // Render Containers
  const createProductLink = (product) => getProductLink(product.url.urlKey, product.topLevelSku);
  await Promise.all([
    // Cart List
    provider.render(CartSummaryList, {
      hideHeading: hideHeading === 'true',
      routeProduct: createProductLink,
      routeEmptyCartCTA: startShoppingURL ? () => rootLink(startShoppingURL) : undefined,
      maxItems: parseInt(maxItems, 10) || undefined,
      attributesToHide: hideAttributes
        .split(',')
        .map((attr) => attr.trim().toLowerCase()),
      enableUpdateItemQuantity: enableUpdateItemQuantity === 'true',
      enableRemoveItem: enableRemoveItem === 'true',
      undo: undo === 'true',
      slots: {
        Thumbnail: (ctx) => {
          const { item, defaultImageProps } = ctx;
          const anchorWrapper = document.createElement('a');
          anchorWrapper.href = createProductLink(item);

          tryRenderAemAssetsImage(ctx, {
            alias: item.sku,
            imageProps: defaultImageProps,
            wrapper: anchorWrapper,

            params: {
              width: defaultImageProps.width,
              height: defaultImageProps.height,
            },
          });
        },

        Footer: (ctx) => {
          // Edit Link
          if (ctx.item?.itemType === 'ConfigurableCartItem' && enableUpdatingProduct === 'true') {
            const editLink = document.createElement('div');
            editLink.className = 'cart-item-edit-link';

            UI.render(Button, {
              children: placeholders?.Global?.CartEditButton,
              variant: 'tertiary',
              size: 'medium',
              icon: h(Icon, { source: 'Edit' }),
              onClick: () => handleEditButtonClick(ctx.item),
            })(editLink);

            ctx.appendChild(editLink);
          }

          // Wishlist Button (default cart feature — always available)
          const $wishlistToggle = document.createElement('div');
          $wishlistToggle.classList.add('cart__action--wishlist-toggle');

          wishlistRender.render(WishlistToggle, {
            product: ctx.item,
            size: 'medium',
            labelToWishlist: placeholders?.Global?.CartMoveToWishlist,
            labelWishlisted: placeholders?.Global?.CartRemoveFromWishlist,
            removeProdFromCart: Cart.updateProductsFromCart,
          })($wishlistToggle);

          ctx.appendChild($wishlistToggle);

          // Microsoft-style Save for later (logged-in customers; guests redirected to login)
          if (saveForLaterEnabled) {
            const $saveAction = document.createElement('div');
            $saveAction.className = 'cart__action--save-for-later';

            const $saveButton = document.createElement('button');
            $saveButton.type = 'button';
            $saveButton.className = 'cart__save-for-later-link';
            $saveButton.textContent = labels.saveForLater;
            $saveButton.addEventListener('click', () => handleSaveForLater(ctx.item, $saveButton));

            $saveAction.appendChild($saveButton);
            ctx.appendChild($saveAction);
          }

          // Gift Options
          const giftOptions = document.createElement('div');

          provider.render(GiftOptions, {
            item: ctx.item,
            view: 'product',
            dataSource: 'cart',
            handleItemsLoading: ctx.handleItemsLoading,
            handleItemsError: ctx.handleItemsError,
            onItemUpdate: ctx.onItemUpdate,
            slots: {
              SwatchImage: swatchImageSlot,
            },
          })(giftOptions);

          ctx.appendChild(giftOptions);
        },
      },
    })($list),

    // Order Summary
    provider.render(OrderSummary, {
      routeProduct: createProductLink,
      routeCheckout: checkoutURL ? () => rootLink(checkoutURL) : undefined,
      slots: {
        EstimateShipping: async (ctx) => {
          if (enableEstimateShipping === 'true') {
            const wrapper = document.createElement('div');
            await provider.render(EstimateShipping, {})(wrapper);
            ctx.replaceWith(wrapper);
          }
        },
        Coupons: (ctx) => {
          const coupons = document.createElement('div');

          provider.render(Coupons)(coupons);

          ctx.appendChild(coupons);
        },
        GiftCards: (ctx) => {
          const giftCards = document.createElement('div');

          provider.render(GiftCards)(giftCards);

          ctx.appendChild(giftCards);
        },
      },
    })($summary),

    provider.render(GiftOptions, {
      view: 'order',
      dataSource: 'cart',

      slots: {
        SwatchImage: swatchImageSlot,
      },
    })($giftOptions),
  ]);

  let cartViewEventPublished = false;
  // Events
  events.on(
    'cart/data',
    (cartData) => {
      toggleEmptyCart(isCartEmpty(cartData));

      const isEmpty = !cartData || cartData.totalQuantity < 1;
      $giftOptions.style.display = isEmpty ? 'none' : '';
      $rightColumn.style.display = isEmpty ? 'none' : '';

      if (!cartViewEventPublished) {
        cartViewEventPublished = true;
        publishShoppingCartViewEvent();
      }

      refreshSaveForLaterSection();
    },
    { eager: true },
  );

  events.on('authenticated', (isAuthenticated) => {
    syncSaveForLaterAuthState(!!isAuthenticated);
    refreshSaveForLaterSection();
  });

  events.on('wishlist/alert', ({ action, item }) => {
    wishlistRender.render(WishlistAlert, {
      action,
      item,
      routeToWishlist,
    })($notification);

    setTimeout(() => {
      $notification.innerHTML = '';
    }, 5000);
  });

  // Initial paint for saved items (resolve email first when logged in)
  refreshSaveForLaterSection();

  return Promise.resolve();
}

function isCartEmpty(cart) {
  return cart ? cart.totalQuantity < 1 : true;
}

function swatchImageSlot(ctx) {
  const { imageSwatchContext, defaultImageProps } = ctx;
  tryRenderAemAssetsImage(ctx, {
    alias: imageSwatchContext.label,
    imageProps: defaultImageProps,
    wrapper: document.createElement('span'),

    params: {
      width: defaultImageProps.width,
      height: defaultImageProps.height,
    },
  });
}
