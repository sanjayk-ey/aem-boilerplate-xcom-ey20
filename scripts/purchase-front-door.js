import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';

export const PURCHASE_FRONT_DOOR_STATUS = Object.freeze({
  AUTHORIZED: 'authorized',
  UNAUTHORIZED: 'unauthorized',
});

export const PURCHASE_FRONT_DOOR_UNAUTHORIZED_MESSAGE = (
  'Transaction is not allowed due to invalid details.'
);

const MOCK_RESPONSE_FILE = '/purchasefrontdoor.json';

/**
 * Builds a REST-friendly address payload from checkout cart address data.
 * @param {object|null} address - Checkout billing or shipping address
 * @returns {object}
 */
export function serializeCustomerAddress(address) {
  if (!address) return {};

  const country = address.country?.code || address.country || '';
  const region = address.region?.code || address.region?.name || address.region || '';

  return {
    firstName: address.firstName || '',
    lastName: address.lastName || '',
    street: Array.isArray(address.street) ? address.street : [address.street].filter(Boolean),
    city: address.city || '',
    region,
    postCode: address.postCode || address.postcode || '',
    country,
    telephone: address.telephone || '',
    company: address.company || '',
  };
}

/**
 * Payment Services hosted fields do not expose the PCI card token to storefront JS.
 * After a successful credit-card submit the token lives on the cart, so this POC
 * sends a cart-scoped token identifier the front-door service can authorize.
 * @param {string} cartId
 * @param {string} paymentMethodCode
 * @returns {string}
 */
export function getPaymentCardToken(cartId, paymentMethodCode) {
  if (cartId && paymentMethodCode) {
    return `${paymentMethodCode}:${cartId}`;
  }
  return cartId || paymentMethodCode || '';
}

/**
 * @param {{ status?: string }} result
 * @returns {boolean}
 */
export function isPurchaseAuthorized(result) {
  return String(result?.status || '').trim().toLowerCase()
    === PURCHASE_FRONT_DOOR_STATUS.AUTHORIZED;
}

function getPurchaseFrontDoorEndpoint() {
  try {
    return getConfigValue('purchase-front-door-endpoint');
  } catch (error) {
    console.warn('[purchasefrontdoor] could not read endpoint from config', error);
    return '';
  }
}

function isRemoteEndpoint(endpoint) {
  return /^https?:\/\//i.test(endpoint);
}

function getForcedMockStatus() {
  const params = new URLSearchParams(window.location.search);
  const queryStatus = params.get('purchasefrontdoor');
  const storedStatus = window.sessionStorage.getItem('purchasefrontdoor-status');
  return String(queryStatus || storedStatus || '').trim().toLowerCase();
}

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase() === PURCHASE_FRONT_DOOR_STATUS.AUTHORIZED
    ? PURCHASE_FRONT_DOOR_STATUS.AUTHORIZED
    : PURCHASE_FRONT_DOOR_STATUS.UNAUTHORIZED;
}

function hasAuthorizationStatus(data) {
  return data && typeof data.status === 'string' && data.status.trim() !== '';
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    console.warn('[purchasefrontdoor] response was not JSON', error);
    return {};
  }
}

/**
 * Loads the mock API response from purchasefrontdoor.json.
 * @returns {Promise<object>}
 */
async function fetchMockResponse() {
  const response = await fetch(MOCK_RESPONSE_FILE, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    console.error('[purchasefrontdoor] failed to load', MOCK_RESPONSE_FILE, response.status);
    return { status: PURCHASE_FRONT_DOOR_STATUS.UNAUTHORIZED };
  }

  return parseJsonResponse(response);
}

/**
 * POST to the configured /purchasefrontdoor endpoint.
 * Local AEM preview returns HTML for that path, so the real mock body is
 * always read from purchasefrontdoor.json when POST does not return JSON status.
 * @param {string} endpoint
 * @param {{ address: object, paymentCardToken: string }} payload
 * @returns {Promise<object>}
 */
async function requestPurchaseFrontDoor(endpoint, payload) {
  if (endpoint) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });

      const contentType = response.headers.get('content-type') || '';
      if (response.ok && contentType.includes('application/json')) {
        const data = await parseJsonResponse(response);
        if (hasAuthorizationStatus(data)) {
          return data;
        }
      }
    } catch (error) {
      console.warn('[purchasefrontdoor] POST failed, loading mock JSON', error);
    }
  }

  if (!isRemoteEndpoint(endpoint)) {
    return fetchMockResponse();
  }

  return { status: PURCHASE_FRONT_DOOR_STATUS.UNAUTHORIZED };
}

/**
 * Calls POST /purchasefrontdoor, then uses purchasefrontdoor.json as the
 * local mock response when that API is not available.
 * @param {{ address: object, paymentCardToken: string }} params
 * @returns {Promise<{ status: 'authorized'|'unauthorized' }>}
 */
export async function authorizePurchase({ address, paymentCardToken }) {
  const payload = {
    address: serializeCustomerAddress(address),
    paymentCardToken: paymentCardToken || '',
  };
  const endpoint = getPurchaseFrontDoorEndpoint();
  const data = await requestPurchaseFrontDoor(endpoint, payload);

  const forcedStatus = getForcedMockStatus();
  const status = (forcedStatus === PURCHASE_FRONT_DOOR_STATUS.AUTHORIZED
    || forcedStatus === PURCHASE_FRONT_DOOR_STATUS.UNAUTHORIZED)
    ? forcedStatus
    : normalizeStatus(data?.status);

  const result = { status };
  console.info('[purchasefrontdoor]', endpoint, payload, '?', result);
  return result;
}

/**
 * Error that Place Order surfaces as the checkout server-error message.
 * @param {string} [message]
 * @returns {Error}
 */
export function createPurchaseUnauthorizedError(
  message = PURCHASE_FRONT_DOOR_UNAUTHORIZED_MESSAGE,
) {
  const error = new Error(message);
  error.name = 'PlaceOrderError';
  return error;
}
