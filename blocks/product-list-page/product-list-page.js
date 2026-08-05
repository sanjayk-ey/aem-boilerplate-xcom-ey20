// Product Discovery Dropins
import SearchResults from '@dropins/storefront-product-discovery/containers/SearchResults.js';
import Facets from '@dropins/storefront-product-discovery/containers/Facets.js';
import SortBy from '@dropins/storefront-product-discovery/containers/SortBy.js';
import Pagination from '@dropins/storefront-product-discovery/containers/Pagination.js';
import { render as provider } from '@dropins/storefront-product-discovery/render.js';
import { Button, Icon, provider as UI } from '@dropins/tools/components.js';
import { search } from '@dropins/storefront-product-discovery/api.js';
// Wishlist Dropin
import { WishlistToggle } from '@dropins/storefront-wishlist/containers/WishlistToggle.js';
import { render as wishlistRender } from '@dropins/storefront-wishlist/render.js';
// Cart Dropin
import * as cartApi from '@dropins/storefront-cart/api.js';
import { tryRenderAemAssetsImage } from '@dropins/tools/lib/aem/assets.js';
// Event Bus
import { events } from '@dropins/tools/event-bus.js';
// AEM
import { readBlockConfig } from '../../scripts/aem.js';
import { fetchPlaceholders, getProductLink } from '../../scripts/commerce.js';
import { loadFragment } from '../fragment/fragment.js';

// Initializers
import '../../scripts/initializers/search.js';
import '../../scripts/initializers/wishlist.js';

export default async function decorate(block) {
  const labels = await fetchPlaceholders();

  const config = readBlockConfig(block);
  const promoTiles = parsePromoTiles(config['promo-tiles']);

  const fragment = document.createRange().createContextualFragment(`
    <div class="search__wrapper">
      <div class="search__result-info"></div>
      <div class="search__view-facets"></div>
      <div class="search__facets"></div>
      <div class="search__product-sort"></div>
      <div class="search__product-list"></div>
      <div class="search__pagination"></div>
    </div>
  `);

  const $resultInfo = fragment.querySelector('.search__result-info');
  const $viewFacets = fragment.querySelector('.search__view-facets');
  const $facets = fragment.querySelector('.search__facets');
  const $productSort = fragment.querySelector('.search__product-sort');
  const $productList = fragment.querySelector('.search__product-list');
  const $pagination = fragment.querySelector('.search__pagination');

  block.innerHTML = '';
  block.appendChild(fragment);

  // Add category url path to block for enrichment
  if (config.urlpath) {
    block.dataset.category = config.urlpath;
  }

  // Get variables from the URL
  const urlParams = new URLSearchParams(window.location.search);
  // get all params
  const {
    q,
    page,
    sort,
    filter,
  } = Object.fromEntries(urlParams.entries());

  // Request search based on the page type on block load
  if (config.urlpath) {
    // If it's a category page...
    await search({
      phrase: '', // search all products in the category
      currentPage: page ? Number(page) : 1,
      pageSize: 8,
      sort: sort ? getSortFromParams(sort) : [{ attribute: 'position', direction: 'DESC' }],
      filter: [
        { attribute: 'categoryPath', eq: config.urlpath }, // Add category filter
        ...getFilterFromParams(filter),
      ],
    }).catch(() => {
      console.error('Error searching for products');
    });
  } else {
    // If it's a search page...
    await search({
      phrase: q || '',
      currentPage: page ? Number(page) : 1,
      pageSize: 8,
      sort: getSortFromParams(sort),
      filter: getFilterFromParams(filter),
    }).catch(() => {
      console.error('Error searching for products');
    });
  }

  const getAddToCartButton = (product) => {
    if (product.typename === 'ComplexProductView') {
      const button = document.createElement('div');
      UI.render(Button, {
        children: labels.Global?.AddProductToCart,
        icon: Icon({ source: 'Cart' }),
        href: getProductLink(product.urlKey, product.sku),
        variant: 'primary',
      })(button);
      return button;
    }
    const button = document.createElement('div');
    UI.render(Button, {
      children: labels.Global?.AddProductToCart,
      icon: Icon({ source: 'Cart' }),
      onClick: () => cartApi.addProductsToCart([{ sku: product.sku, quantity: 1 }]),
      variant: 'primary',
    })(button);
    return button;
  };

  await Promise.all([
    // Sort By
    provider.render(SortBy, {})($productSort),

    // Pagination
    provider.render(Pagination, {
      onPageChange: () => {
        // scroll to the top of the page
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    })($pagination),

    // View Facets Button
    UI.render(Button, {
      children: labels.Global?.Filters,
      icon: Icon({ source: 'Burger' }),
      variant: 'secondary',
      onClick: () => {
        $facets.classList.toggle('search__facets--visible');
      },
    })($viewFacets),

    // Facets
    provider.render(Facets, {})($facets),
    // Product List
    provider.render(SearchResults, {
      routeProduct: (product) => getProductLink(product.urlKey, product.sku),
      slots: {
        ProductImage: (ctx) => {
          const { product, defaultImageProps } = ctx;
          const anchorWrapper = document.createElement('a');
          anchorWrapper.href = getProductLink(product.urlKey, product.sku);

          tryRenderAemAssetsImage(ctx, {
            alias: product.sku,
            imageProps: defaultImageProps,
            wrapper: anchorWrapper,
            params: {
              width: defaultImageProps.width,
              height: defaultImageProps.height,
            },
          });
        },
        ProductActions: (ctx) => {
          const actionsWrapper = document.createElement('div');
          actionsWrapper.className = 'product-discovery-product-actions';
          // Add to Cart Button
          const addToCartBtn = getAddToCartButton(ctx.product);
          addToCartBtn.className = 'product-discovery-product-actions__add-to-cart';
          // Wishlist Button
          const $wishlistToggle = document.createElement('div');
          $wishlistToggle.classList.add('product-discovery-product-actions__wishlist-toggle');
          wishlistRender.render(WishlistToggle, {
            product: ctx.product,
            variant: 'tertiary',
          })($wishlistToggle);
          actionsWrapper.appendChild(addToCartBtn);
          actionsWrapper.appendChild($wishlistToggle);
          ctx.replaceWith(actionsWrapper);
        },
      },
    })($productList),
  ]);

  // Listen for search results (event is fired before the block is rendered; eager: true)
  events.on('search/result', (payload) => {
    const totalCount = payload.result?.totalCount || 0;

    block.classList.toggle('product-list-page--empty', totalCount === 0);

    // Results Info
    $resultInfo.innerHTML = payload.request?.phrase
      ? `${totalCount} results found for <strong>"${payload.request.phrase}"</strong>.`
      : `${totalCount} results found.`;

    // Update the view facets button with the number of filters
    if (payload.request.filter.length > 0) {
      $viewFacets.querySelector('button').setAttribute('data-count', payload.request.filter.length);
    } else {
      $viewFacets.querySelector('button').removeAttribute('data-count');
    }
  }, { eager: true });

  // Listen for search results (event is fired after the block is rendered; eager: false)
  events.on('search/result', (payload) => {
    // update URL with new search params
    const url = new URL(window.location.href);

    if (payload.request?.phrase) {
      url.searchParams.set('q', payload.request.phrase);
    }

    if (payload.request?.currentPage) {
      url.searchParams.set('page', payload.request.currentPage);
    }

    if (payload.request?.sort) {
      url.searchParams.set('sort', getParamsFromSort(payload.request.sort));
    }

    if (payload.request?.filter) {
      url.searchParams.set('filter', getParamsFromFilter(payload.request.filter));
    }

    // Update the URL
    window.history.pushState({}, '', url.toString());

    // Inject authored CMS tiles among product cards (IKEA-style)
    requestAnimationFrame(() => {
      injectPromoTiles(block, promoTiles);
    });
  }, { eager: false });
}

/**
 * Parses promo-tiles config entries into { position, path } objects.
 * Supports multi text values or a single newline/comma-separated string.
 * Entry format: position|path  (e.g. 3|/fragments/apparel-promo-1)
 * @param {string|string[]|undefined} raw
 * @returns {{ position: number, path: string }[]}
 */
function parsePromoTiles(raw) {
  if (!raw) return [];

  const lines = (Array.isArray(raw) ? raw : String(raw).split(/\r?\n|,/))
    .map((line) => String(line).trim())
    .filter(Boolean);

  return lines
    .map((line) => {
      const separator = line.includes('|') ? '|' : ';';
      const [positionPart, ...pathParts] = line.split(separator);
      const position = Number(String(positionPart).trim());
      let path = pathParts.join(separator).trim();

      if (!Number.isFinite(position) || position < 1 || !path) return null;

      // Normalize authored paths
      try {
        if (path.startsWith('http://') || path.startsWith('https://')) {
          path = new URL(path).pathname;
        }
      } catch {
        // keep original path
      }
      path = path.replace(/(\.plain)?\.html$/i, '');
      if (!path.startsWith('/')) path = `/${path}`;

      return { position, path };
    })
    .filter(Boolean);
}

/**
 * Inserts CMS fragment tiles into the Live Search product grid.
 * Re-runs after every search/result (sort/filter/pagination).
 * @param {Element} block
 * @param {{ position: number, path: string }[]} tiles
 */
async function injectPromoTiles(block, tiles) {
  const grid = block.querySelector('.product-discovery-product-list__grid');
  if (!grid) return;

  grid.querySelectorAll('.plp-cms-tile').forEach((el) => el.remove());
  if (!tiles.length) return;

  // Load in parallel, then insert highest→lowest so indexes stay stable
  const sorted = [...tiles].sort((a, b) => b.position - a.position);
  const loaded = await Promise.all(sorted.map(async (tile) => {
    try {
      const fragment = await loadFragment(tile.path);
      if (!fragment) {
        console.warn(`PLP promo tile not found: ${tile.path}`);
        return null;
      }
      return { tile, fragment };
    } catch (error) {
      console.error(`PLP promo tile failed (${tile.path})`, error);
      return null;
    }
  }));

  loaded.filter(Boolean).forEach(({ tile, fragment }) => {
    const el = document.createElement('div');
    el.className = 'plp-cms-tile';
    el.dataset.promoPosition = String(tile.position);
    el.dataset.promoPath = tile.path;

    const section = fragment.querySelector(':scope .section') || fragment;
    el.append(...section.childNodes);

    const index = Math.max(tile.position - 1, 0);
    const ref = grid.children[index];
    if (ref) {
      grid.insertBefore(el, ref);
    } else {
      grid.appendChild(el);
    }
  });
}

function getSortFromParams(sortParam) {
  if (!sortParam) return [];
  return sortParam.split(',').map((item) => {
    const [attribute, direction] = item.split('_');
    return { attribute, direction };
  });
}

function getParamsFromSort(sort) {
  return sort.map((item) => `${item.attribute}_${item.direction}`).join(',');
}

function getFilterFromParams(filterParam) {
  if (!filterParam) return [];

  // Decode the URL-encoded parameter
  const decodedParam = decodeURIComponent(filterParam);
  const results = [];
  const filters = decodedParam.split('|');

  filters.forEach((filter) => {
    if (filter.includes(':')) {
      const [attribute, value] = filter.split(':');

      if (value.includes(',')) {
        // Handle array values (like categories)
        results.push({
          attribute,
          in: value.split(','),
        });
      } else if (value.includes('-')) {
        // Handle range values (like price)
        const [from, to] = value.split('-');
        results.push({
          attribute,
          range: {
            from: Number(from),
            to: Number(to),
          },
        });
      } else {
        // Handle single values (like categories with one value)
        results.push({
          attribute,
          in: [value],
        });
      }
    }
  });

  return results;
}

function getParamsFromFilter(filter) {
  if (!filter || filter.length === 0) return '';

  return filter.map(({ attribute, in: inValues, range }) => {
    if (inValues) {
      return `${attribute}:${inValues.join(',')}`;
    }

    if (range) {
      return `${attribute}:${range.from}-${range.to}`;
    }

    return null;
  }).filter(Boolean).join('|');
}
