# Save for Later (Cart Page) – POC

## Summary

This POC adds a Microsoft Store–style **Save for later** experience to the Edge Delivery Commerce cart page:

- Each cart line item shows a **Save for later** action **and** the existing wishlist toggle (wishlist is unchanged).
- **Save for later works only for logged-in customers.**
- Guests who click **Save for later** are redirected to the login page with `?redirect=<cart path>`, then returned to the cart after sign-in.
- Clicking Save for later (when logged in) removes the item from the Magento cart and adds it to a **Saved for later** list.
- The **Saved for later** section appears only on the cart page and only when the customer is authenticated.
- Saved items show **Remove** and **Add to cart**.
- The section remains visible when the cart is empty (as long as that customer has saved items).

Reference behavior: Microsoft ecommerce cart (“Save for later” / “Saved for later”).

---

## Files changed

| File | Change |
|------|--------|
| `scripts/save-for-later.js` | **New** – localStorage helpers, item snapshot, option UID extraction, price formatting |
| `blocks/commerce-cart/commerce-cart.js` | Save for later link + auth gate; Saved for later section; wishlist left intact |
| `blocks/commerce-cart/commerce-cart.css` | Styles for Save for later link + Saved for later list (Microsoft-like layout) |
| `blocks/commerce-login/commerce-login.js` | Honors `?redirect=` after sign-in so guests return to cart |
| `blocks/commerce-cart/_commerce-cart.json` | Authoring field `enable-save-for-later` |
| `component-models.json` | Same authoring field for Universal Editor |
| `blocks/commerce-cart/README.md` | Block documentation updates |
| `docs/save-for-later-poc.md` | This developer handoff doc |

---

## How it works

```text
Cart line item
  ├─ Wishlist toggle (unchanged default feature)
  └─ "Save for later"
        ├─ Guest → redirect /customer/login?redirect=<cart path>
        └─ Logged in
              ├─ Snapshot item → localStorage `aem-storefront:save-for-later:<customerEmail>`
              └─ Remove from Magento cart → Cart.updateProductsFromCart([{ uid, quantity: 0 }])

Saved for later section (cart page + logged-in only)
  ├─ "Remove"     → delete from localStorage
  └─ "Add to cart" → Cart.addProductsToCart([...]) then delete from localStorage
```

### Why localStorage (not Magento Wishlist)?

Wishlist already exists and remains available on the cart. The Microsoft POC needs a separate **cart-page** list for logged-in customers. This POC does not replace wishlist.

---

## Block configuration

On the `commerce-cart` block:

| Key | Default | Description |
|-----|---------|-------------|
| `enable-save-for-later` | `true` | Enables Save for later UI alongside wishlist. Set to `false` to hide Save for later only. |

Optional placeholder keys (under `Global` in placeholders content):

| Key | Fallback |
|-----|----------|
| `CartSaveForLater` | Save for later |
| `CartSavedForLater` | Saved for later |
| `CartSavedAddToCart` | Add to cart |
| `CartSavedRemove` | Remove |
| `CartSaveForLaterError` | Unable to save this item for later. Please try again. |
| `CartSavedAddToCartError` | Unable to move this item back to the cart. Please try again. |

---

## Data shape (localStorage)

Keys:
- `aem-storefront:save-for-later-email` — cached customer email for the active session
- `aem-storefront:save-for-later:<customerEmail>` — saved items for that customer (survives logout/login)

```json
[
  {
    "id": "PARENT-SKU::optionUid1|optionUid2",
    "uid": "cart-line-uid-at-save-time",
    "sku": "VARIANT-SKU",
    "topLevelSku": "PARENT-SKU",
    "name": "Product name",
    "quantity": 1,
    "image": { "src": "https://...", "alt": "Product name" },
    "price": { "value": 179.99, "currency": "USD" },
    "optionsUIDs": ["optionUid1"],
    "optionLabels": ["Platinum"],
    "urlKey": "product-url-key",
    "savedAt": 1710000000000
  }
]
```

---

## Developer test plan

1. As a **guest**, open cart with products and click **Save for later**.
   - Redirects to `/customer/login?redirect=<cart-path>`.
2. Sign in.
   - Lands back on the **cart** page (not account).
3. Click **Save for later** again (now logged in).
   - Item leaves the cart and appears under **Saved for later**.
4. Confirm **Move to Wishlist** still works on cart line items.
5. Click **Add to cart** / **Remove** on saved items.
6. Log out → Saved for later section is hidden.
7. Log back in as the same customer → saved items return.

---

## Known POC limitations / follow-ups

- Persistence is **browser localStorage only** (scoped per customer email; not synced across devices/browsers).
- Guests must log in before saving; list is hidden when logged out.
- On re-login, email is resolved via customer API / ACDL; legacy token-keyed lists are migrated when possible.
- Not integrated with Magento Wishlist APIs (wishlist remains a separate feature).
- Mini-cart / header do not show saved items (cart page only, by design).
- Complex product types (bundles, gift cards) may need extra option mapping validation against Catalog Service.
- No server-side analytics event yet for save/restore actions.
- Production hardening ideas: Commerce backend save-for-later entity, inventory checks before Add to cart.

---

## Related APIs used

From `@dropins/storefront-cart`:

- `updateProductsFromCart([{ uid, quantity: 0 }])` – remove from cart on Save for later
- `addProductsToCart([{ sku, quantity, optionsUIDs?, parentSku? }])` – restore to cart

Shared helper module:

- `scripts/save-for-later.js`

---

## Rollback

1. Set `enable-save-for-later` to `false` on the cart block, **or**
2. Revert the files listed in **Files changed**.

Clearing browser key `aem-storefront:save-for-later` resets saved items for a shopper.
