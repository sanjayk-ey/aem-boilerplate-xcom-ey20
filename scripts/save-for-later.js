/**
 * Cart-page "Save for later" helpers (Microsoft-style POC).
 * Logged-in customers only. Persists per customer email in localStorage
 * so items survive logout / login (auth tokens change each session).
 */

import { getCookie } from '@dropins/tools/lib.js';

const STORAGE_PREFIX = 'aem-storefront:save-for-later';
const EMAIL_CACHE_KEY = 'aem-storefront:save-for-later-email';

/**
 * @param {string} email
 * @returns {string}
 */
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * @returns {string|null}
 */
export function getCachedCustomerEmail() {
  const email = normalizeEmail(localStorage.getItem(EMAIL_CACHE_KEY) || '');
  return email || null;
}

/**
 * @param {string|null|undefined} email
 */
export function setCachedCustomerEmail(email) {
  const normalized = normalizeEmail(email);
  if (normalized) {
    localStorage.setItem(EMAIL_CACHE_KEY, normalized);
  } else {
    localStorage.removeItem(EMAIL_CACHE_KEY);
  }
}

/**
 * Clear cached identity when the shopper logs out.
 * Saved item lists are kept under the email key for the next login.
 * @param {boolean} isAuthenticated
 */
export function syncSaveForLaterAuthState(isAuthenticated) {
  if (!isAuthenticated) {
    setCachedCustomerEmail(null);
  }
}

/**
 * Customer-scoped storage key derived from email.
 * @returns {string|null}
 */
export function getSaveForLaterStorageKey() {
  const email = getCachedCustomerEmail();
  if (!email) return null;
  return `${STORAGE_PREFIX}:${email}`;
}

/**
 * Merge source items into the email-scoped list.
 * @param {string} emailKey
 * @param {Array<object>} sourceItems
 */
function mergeIntoEmailList(emailKey, sourceItems) {
  if (!Array.isArray(sourceItems) || !sourceItems.length) return;
  const currentRaw = localStorage.getItem(emailKey);
  let merged = [];
  try {
    const currentItems = currentRaw ? JSON.parse(currentRaw) : [];
    merged = Array.isArray(currentItems) ? [...currentItems] : [];
  } catch {
    merged = [];
  }

  sourceItems.forEach((item) => {
    if (!item?.id) return;
    if (!merged.some((existing) => existing.id === item.id)) {
      merged.push(item);
    }
  });

  localStorage.setItem(emailKey, JSON.stringify(merged));
}

/**
 * Move items saved under previous token-based / orphan keys into the email key.
 * @param {string} token
 * @param {string} email
 */
function migrateLegacyTokenScopedItems(token, email) {
  if (!email) return;
  const normalized = normalizeEmail(email);
  const emailKey = `${STORAGE_PREFIX}:${normalized}`;

  // 1) Same-session token key (before logout)
  if (token) {
    const legacyKey = `${STORAGE_PREFIX}:${token.slice(-24)}`;
    if (legacyKey !== emailKey) {
      try {
        const legacyRaw = localStorage.getItem(legacyKey);
        if (legacyRaw) {
          const legacyItems = JSON.parse(legacyRaw);
          mergeIntoEmailList(emailKey, legacyItems);
          localStorage.removeItem(legacyKey);
        }
      } catch {
        // keep legacy data if parse fails
      }
    }
  }

  // 2) Orphan keys from earlier logins (token changed) — reclaim by customerEmail
  //    or, if the email list is empty and only one orphan exists, migrate it (POC).
  const orphanKeys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(`${STORAGE_PREFIX}:`)) continue;
    if (key === EMAIL_CACHE_KEY || key === emailKey) continue;
    orphanKeys.push(key);
  }

  let emailListEmpty = true;
  try {
    const existing = localStorage.getItem(emailKey);
    const parsed = existing ? JSON.parse(existing) : [];
    emailListEmpty = !Array.isArray(parsed) || parsed.length === 0;
  } catch {
    emailListEmpty = true;
  }

  orphanKeys.forEach((key) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const items = JSON.parse(raw);
      if (!Array.isArray(items) || !items.length) {
        localStorage.removeItem(key);
        return;
      }

      const matching = items.filter(
        (item) => normalizeEmail(item?.customerEmail) === normalized,
      );
      if (matching.length) {
        mergeIntoEmailList(emailKey, matching);
        const remaining = items.filter(
          (item) => normalizeEmail(item?.customerEmail) !== normalized,
        );
        if (remaining.length) {
          localStorage.setItem(key, JSON.stringify(remaining));
        } else {
          localStorage.removeItem(key);
        }
        return;
      }

      // POC recovery: single orphan list + empty email list → assume same shopper
      if (emailListEmpty && orphanKeys.length === 1) {
        mergeIntoEmailList(emailKey, items);
        localStorage.removeItem(key);
        emailListEmpty = false;
      }
    } catch {
      // ignore bad orphan entries
    }
  });
}

/**
 * Resolve a stable customer email for the current session.
 * Uses cache, Adobe Data Layer, then auth getCustomerData(token).
 * @returns {Promise<string|null>}
 */
export async function ensureSaveForLaterCustomerIdentity() {
  const token = getCookie('auth_dropin_user_token');
  if (!token) {
    setCachedCustomerEmail(null);
    return null;
  }

  const cached = getCachedCustomerEmail();
  if (cached) {
    migrateLegacyTokenScopedItems(token, cached);
    return cached;
  }

  // Fast path: account context from ACDL after sign-in
  try {
    const account = window.adobeDataLayer?.getState?.('accountContext');
    const acdlEmail = normalizeEmail(account?.emailAddress || account?.email || '');
    if (acdlEmail) {
      setCachedCustomerEmail(acdlEmail);
      migrateLegacyTokenScopedItems(token, acdlEmail);
      return acdlEmail;
    }
  } catch {
    // ignore
  }

  try {
    const { getCustomerData } = await import('@dropins/storefront-auth/api.js');
    const customer = await getCustomerData(token);
    const email = normalizeEmail(customer?.email || customer?.emailAddress || '');
    if (email) {
      setCachedCustomerEmail(email);
      migrateLegacyTokenScopedItems(token, email);
      return email;
    }
  } catch (error) {
    console.error('Save for later: unable to resolve customer email', error);
  }

  return null;
}

/**
 * @returns {Array<object>}
 */
export function getSavedForLaterItems() {
  const key = getSaveForLaterStorageKey();
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {Array<object>} items
 */
function persist(items) {
  const key = getSaveForLaterStorageKey();
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(items));
}

/**
 * Builds a stable id for a cart line / saved item.
 * @param {{ sku?: string, topLevelSku?: string, selectedOptionsUIDs?: object|string[], selectedOptions?: object|Array }} item
 */
export function buildSavedItemId(item) {
  const options = extractOptionsUIDs(item).slice().sort().join('|');
  return `${item.topLevelSku || item.sku || 'item'}::${options || 'default'}`;
}

/**
 * @param {object} item Cart dropin line item
 * @returns {string[]}
 */
export function extractOptionsUIDs(item = {}) {
  const { selectedOptionsUIDs, selectedOptions, bundleOptionsUIDs } = item;

  if (Array.isArray(selectedOptionsUIDs)) {
    return selectedOptionsUIDs.filter(Boolean);
  }

  if (selectedOptionsUIDs && typeof selectedOptionsUIDs === 'object') {
    return Object.values(selectedOptionsUIDs)
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .filter((value) => typeof value === 'string' && value.length > 0);
  }

  if (Array.isArray(selectedOptions)) {
    return selectedOptions.map((option) => option?.uid).filter(Boolean);
  }

  if (selectedOptions && typeof selectedOptions === 'object') {
    return Object.values(selectedOptions)
      .map((option) => (typeof option === 'string' ? option : option?.uid))
      .filter(Boolean);
  }

  if (Array.isArray(bundleOptionsUIDs)) {
    return bundleOptionsUIDs.filter(Boolean);
  }

  return [];
}

/**
 * Human-readable option labels (e.g. "Platinum").
 * @param {object} item
 * @returns {string[]}
 */
export function extractOptionLabels(item = {}) {
  const { selectedOptions } = item;
  if (!selectedOptions) return [];

  if (Array.isArray(selectedOptions)) {
    return selectedOptions
      .map((option) => option?.value || option?.label || option?.name)
      .filter(Boolean);
  }

  if (typeof selectedOptions === 'object') {
    return Object.values(selectedOptions)
      .map((option) => {
        if (typeof option === 'string') return option;
        return option?.value || option?.label || option?.name;
      })
      .filter(Boolean);
  }

  return [];
}

/**
 * Snapshot a cart line item for local persistence.
 * @param {object} cartItem
 */
export function toSavedItem(cartItem) {
  const optionsUIDs = extractOptionsUIDs(cartItem);
  const optionLabels = extractOptionLabels(cartItem);
  const price = cartItem.price || cartItem.regularPrice || cartItem.total || {};

  return {
    id: buildSavedItemId(cartItem),
    uid: cartItem.uid,
    sku: cartItem.sku,
    topLevelSku: cartItem.topLevelSku || cartItem.sku,
    name: cartItem.name,
    quantity: cartItem.quantity || 1,
    image: {
      src: cartItem.image?.src || '',
      alt: cartItem.image?.alt || cartItem.name || '',
    },
    price: {
      value: Number(price.value) || 0,
      currency: price.currency || 'USD',
    },
    optionsUIDs,
    optionLabels,
    urlKey: cartItem.url?.urlKey || '',
    customerEmail: getCachedCustomerEmail() || '',
    savedAt: Date.now(),
  };
}

/**
 * @param {object} cartItem
 * @returns {Array<object>} updated list
 */
export function saveItemForLater(cartItem) {
  if (!getSaveForLaterStorageKey()) return [];
  const savedItem = toSavedItem(cartItem);
  const items = getSavedForLaterItems().filter((item) => item.id !== savedItem.id);
  items.unshift(savedItem);
  persist(items);
  return items;
}

/**
 * @param {string} id
 * @returns {Array<object>}
 */
export function removeSavedForLaterItem(id) {
  if (!getSaveForLaterStorageKey()) return [];
  const items = getSavedForLaterItems().filter((item) => item.id !== id);
  persist(items);
  return items;
}

/**
 * Format money for display.
 * @param {{ value?: number, currency?: string }} price
 * @param {string} [locale]
 */
export function formatSavedItemPrice(price = {}, locale = navigator.language || 'en-US') {
  const value = Number(price.value) || 0;
  const currency = price.currency || 'USD';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
