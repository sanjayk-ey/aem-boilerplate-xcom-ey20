import * as cartApi from '@dropins/storefront-cart/api.js';
import * as pdpApi from '@dropins/storefront-pdp/api.js';
import { getHeaders } from '@dropins/tools/lib/aem/configs.js';
import { render as wishlistRenderer } from '@dropins/storefront-wishlist/render.js';
import { render as authRenderer } from '@dropins/storefront-auth/render.js';
import { AuthCombine } from '@dropins/storefront-auth/containers/AuthCombine.js';
import { events } from '@dropins/tools/event-bus.js';
import Wishlist from '@dropins/storefront-wishlist/containers/Wishlist.js';
import { tryRenderAemAssetsImage } from '@dropins/tools/lib/aem/assets.js';
import {
  commerceEndpointWithQueryParams,
  rootLink,
  getProductLink,
  checkIsAuthenticated,
  CUSTOMER_LOGIN_PATH,
} from '../../scripts/commerce.js';
import '../../scripts/initializers/wishlist.js';
import { readBlockConfig } from '../../scripts/aem.js';

// Initialize

// Set Fetch Endpoint (Service)
pdpApi.setEndpoint(await commerceEndpointWithQueryParams());

// Set Fetch Headers (Service)
pdpApi.setFetchGraphQlHeaders((prev) => ({ ...prev, ...getHeaders('cs') }));

const WISHLIST_IMAGE_DIMENSIONS = {
  width: 288,
  height: 288,
};

const showAuthModal = (event) => {
  if (event) {
    event.preventDefault();
  }

  const signInModal = document.createElement('div');
  signInModal.setAttribute('id', 'signin-modal');

  const signInForm = document.createElement('div');
  signInForm.setAttribute('id', 'signin-form');

  signInModal.onclick = (clickEvent) => {
    if (clickEvent.target === signInModal) {
      signInModal.remove();
    }
  };

  signInModal.appendChild(signInForm);
  document.body.appendChild(signInModal);

  // Render auth form
  authRenderer.render(AuthCombine, {
    signInFormConfig: { renderSignUpLink: true },
    signUpFormConfig: {},
    resetPasswordFormConfig: {},
  })(signInForm);

  const authListener = events.on('authenticated', (authenticated) => {
    if (authenticated) {
      signInModal.remove();
      authListener.off();
    }
  });
};

events.on('wishlist/alert', () => {
  setTimeout(() => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }, 0);
});

function redirectGuestToLogin() {
  const returnPath = `${window.location.pathname}${window.location.search}` || rootLink('/wishlist');
  const loginUrl = new URL(rootLink(CUSTOMER_LOGIN_PATH), window.location.origin);
  loginUrl.searchParams.set('redirect', returnPath);
  window.location.href = loginUrl.href;
}

export default async function decorate(block) {
  // Wishlist is for logged-in customers only
  if (!checkIsAuthenticated()) {
    redirectGuestToLogin();
    return;
  }

  const {
    'start-shopping-url': startShoppingURL = '',
  } = readBlockConfig(block);

  await wishlistRenderer.render(Wishlist, {
    routeEmptyWishlistCTA: startShoppingURL ? () => rootLink(startShoppingURL) : undefined,
    moveProdToCart: cartApi.addProductsToCart,
    routeProdDetailPage: (product) => getProductLink(product.urlKey, product.sku),
    onLoginClick: showAuthModal,
    getProductData: pdpApi.getProductData,
    getRefinedProduct: pdpApi.getRefinedProduct,
    slots: {
      image: (ctx) => {
        const { item, defaultImageProps } = ctx;
        tryRenderAemAssetsImage(ctx, {
          alias: item.product.sku,
          imageProps: defaultImageProps,
          params: {
            width: defaultImageProps.width || WISHLIST_IMAGE_DIMENSIONS.width,
            height: defaultImageProps.height || WISHLIST_IMAGE_DIMENSIONS.height,
          },
        });
      },
    },
  })(block);
}
