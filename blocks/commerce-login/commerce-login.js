import { SignIn } from '@dropins/storefront-auth/containers/SignIn.js';
import { render as authRenderer } from '@dropins/storefront-auth/render.js';
import {
  CUSTOMER_ACCOUNT_PATH,
  CUSTOMER_FORGOTPASSWORD_PATH,
  checkIsAuthenticated,
  rootLink,
} from '../../scripts/commerce.js';

// Initialize
import '../../scripts/initializers/auth.js';

/**
 * Allows safe same-site relative redirects after sign-in (e.g. back to cart).
 * Query param: ?redirect=/cart
 * @returns {string}
 */
function getPostSignInRedirect() {
  const redirect = new URLSearchParams(window.location.search).get('redirect');
  if (
    redirect
    && redirect.startsWith('/')
    && !redirect.startsWith('//')
    && !redirect.includes('://')
  ) {
    return redirect;
  }
  return rootLink(CUSTOMER_ACCOUNT_PATH);
}

export default async function decorate(block) {
  const postSignInRedirect = getPostSignInRedirect();

  if (checkIsAuthenticated()) {
    window.location.href = postSignInRedirect;
  } else {
    await authRenderer.render(SignIn, {
      routeForgotPassword: () => rootLink(CUSTOMER_FORGOTPASSWORD_PATH),
      routeRedirectOnSignIn: () => postSignInRedirect,
    })(block);
  }
}
