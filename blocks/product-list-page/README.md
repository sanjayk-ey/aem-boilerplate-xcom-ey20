# Product List Page Block

## Overview

Renders category/search product listings with Live Search dropins (results, facets, sort, pagination), and optionally injects authored CMS promo tiles into the product grid (IKEA-style).

## Block Configuration

| Key | Type | Description |
|-----|------|-------------|
| `urlPath` | string | Category URL path used for Live Search filter and enrichment category matching (e.g. `apparel`) |
| `promo-tiles` | string (multi) | CMS tiles among products. One entry per tile: `position\|path` |

### Promo Tiles format

```text
3|/fragments/apparel-promo-1
7|/fragments/apparel-promo-2
```

- `position` — 1-based index in the product grid (3 = third cell)
- `path` — storefront path of a normal AEM page/fragment (Preview-published)

## Authoring steps (Apparel example)

1. Create CMS pages (Create → Page), e.g. `/fragments/apparel-promo-1`, with Image + Title + Button.
2. Publish those pages to **Preview**.
3. Edit the **Apparel** page → select **Product List Page** block.
4. Set **URL Path** = `apparel`.
5. Add **Promo Tiles** entries:
   - `3|/fragments/apparel-promo-1`
   - `7|/fragments/apparel-promo-2`
6. Publish Apparel to **Preview**.
7. Open `http://localhost:3000/apparel` (or `.aem.page/apparel`).

## Runtime behavior

- After each `search/result` (including sort/filter/pagination), existing `.plp-cms-tile` nodes are removed and tiles are re-injected.
- Tiles are inserted from highest position to lowest so indexes stay stable.
- Missing fragment paths are skipped (console warning).

## Notes

- OOTB Enrichment places content above/below the PLP section; **Promo Tiles** is what places content **between product cards**.
- Deploy code (`promo-tiles` field + inject JS) before the field appears in Universal Editor.
