import { WishlistToggle } from '@dropins/storefront-wishlist/containers/WishlistToggle.js';
import { render as wishlistRender } from '@dropins/storefront-wishlist/render.js';
import { checkIsAuthenticated, rootLink, CUSTOMER_LOGIN_PATH } from './commerce.js';

/**
 * Renders the wishlist heart on PLP and PDP.
 * Logged-in shoppers get the drop-in toggle. Guests still see the heart;
 * choosing it sends them to login, then back to the current page.
 * @param {HTMLElement} container
 * @param {object} props WishlistToggle props
 * @param {string} [label] Accessible name for the guest heart button
 */
export function mountWishlistIcon(container, props, label = 'Add to wishlist') {
  const host = document.createElement('div');
  host.className = 'wishlist-icon__toggle';

  const fallback = document.createElement('button');
  fallback.type = 'button';
  fallback.className = 'wishlist-icon__fallback';
  fallback.setAttribute('aria-label', label);
  fallback.innerHTML = '<span class="wishlist-icon__glyph" aria-hidden="true"></span>';
  fallback.addEventListener('click', () => {
    const toggle = host.querySelector('[data-testid="wishlist-toggle"]');
    if (toggle) {
      toggle.click();
      return;
    }
    if (checkIsAuthenticated()) return;
    const loginUrl = new URL(rootLink(CUSTOMER_LOGIN_PATH), window.location.origin);
    loginUrl.searchParams.set(
      'redirect',
      `${window.location.pathname}${window.location.search}`,
    );
    window.location.href = loginUrl.href;
  });

  container.classList.add('wishlist-icon');
  container.replaceChildren(fallback, host);

  return wishlistRender.render(WishlistToggle, props)(host);
}
