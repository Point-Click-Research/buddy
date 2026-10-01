// Exa's product-search results, turned into product lines. The summary comes
// back as a JSON string shaped by PRODUCT_SUMMARY_SCHEMA; marketplace search
// pages and repeats are dropped, a price cap is applied, and each survivor
// reads as one line. Pure module: no Electron, no network, fully testable.

import { moneyLabel, productLine } from '../product-line';

/** What Exa is asked to pull off each product page. */
export const PRODUCT_SUMMARY_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Product',
  type: 'object',
  properties: {
    name: { type: 'string', description: 'The product name as the store lists it.' },
    price: { type: 'number', description: 'The current price as a plain number, sale price if one is shown.' },
    currency: { type: 'string', description: 'ISO 4217 code of the price, e.g. USD.' },
    seller: { type: 'string', description: 'The store or brand selling it.' },
    inStock: { type: 'boolean', description: 'Whether it can be bought right now.' },
  },
  required: ['name'],
} as const;

/** One Exa search hit. The summary is JSON text matching the request's schema when the extraction worked. */
export interface ExaResult {
  title?: string;
  url: string;
  image?: string;
  summary?: string;
}

/** @deprecated Name kept for the tests; the shape is any Exa hit. */
export type ExaProductResult = ExaResult;

export function parseSummary(summary: string | undefined): Record<string, unknown> {
  if (!summary) return {};
  try {
    const parsed: unknown = JSON.parse(summary);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export interface WebProduct {
  title: string;
  url: string;
  price?: number;
  currency?: string;
  seller?: string;
  inStock?: boolean;
  image?: string;
}

/** Search-results and listing pages that are never one product. */
const MARKETPLACE_LISTING = /\/(s|search|sch|browse|shop|c|category|collections?|catalogsearch)(\/|\?|$)|[?&](q|k|query|keyword)=/i;

export function isListingPage(url: string): boolean {
  try {
    const { pathname, search } = new URL(url);
    return MARKETPLACE_LISTING.test(pathname + search) || pathname === '/' || pathname === '';
  } catch {
    return true;
  }
}

/** One Exa result as a product, or null when it is not a single product page. */
export function toWebProduct(result: ExaProductResult): WebProduct | null {
  if (!result.url || isListingPage(result.url)) return null;
  const summary = parseSummary(result.summary);
  const title = text(summary['name']) || result.title?.trim();
  if (!title) return null;
  return {
    title,
    url: result.url,
    price: typeof summary['price'] === 'number' && summary['price'] > 0 ? summary['price'] : undefined,
    currency: text(summary['currency'])?.toUpperCase(),
    seller: text(summary['seller']),
    inStock: typeof summary['inStock'] === 'boolean' ? summary['inStock'] : undefined,
    image: result.image,
  };
}

/**
 * The list the model sees: listing pages and repeats gone, anything over
 * the cap or known to be out of stock gone, best-ranked first, at most `limit`.
 */
export function pickWebProducts(results: ExaProductResult[], limit: number, maxPrice?: number): WebProduct[] {
  const seen = new Set<string>();
  const picks: WebProduct[] = [];
  for (const result of results) {
    const product = toWebProduct(result);
    if (!product || product.inStock === false) continue;
    if (maxPrice && product.price !== undefined && product.price > maxPrice) continue;
    const key = product.url.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push(product);
    if (picks.length === limit) break;
  }
  return picks;
}

/** "- Title — $89.99 (Seller, photo: https://…) · https://…" */
export function webProductLine(product: WebProduct): string {
  return productLine({
    title: product.title,
    price: product.price !== undefined ? moneyLabel(product.price, product.currency) : undefined,
    extras: [product.seller, product.image ? `photo: ${product.image}` : undefined],
    url: product.url,
  });
}
