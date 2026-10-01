// product_search: product pages from any store on the open web, through Exa's
// search API steered at products, with a structured price and seller pulled
// off each page. The structured stop after catalog_search and before plain
// web search.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { type ToolOutcome, type ToolRegistry, toolArgs } from '../ai/tools';
import { createLogger } from '../log';
import { publishLinks } from '../sources';
import { exaAvailable, exaSearch } from './client';
import { PRODUCT_SUMMARY_SCHEMA, pickWebProducts, webProductLine } from './format';
import { errorMessage } from '../../shared/errors';

const log = createLogger('exa-products');

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
// Listing pages, repeats, and over-budget picks are dropped after the fact,
// so ask for more than the model needs.
const OVERFETCH = 3;

const PRODUCT_SEARCH: Tool = {
  name: 'product_search',
  description:
    'Product pages from any store on the open web, each with title, price, seller, and a photo link. ' +
    'Call it for "find me…" shopping asks after catalog_search (or first when there is no catalog_search); ' +
    'the web search tool is the fallback when it comes up short or the ask is not a product.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What to find, in plain words with every current criterion ("men\'s brown leather belt under $80").',
      },
      store: { type: 'string', description: 'Only this store, as a domain ("nike.com"), when the user named one.' },
      max_price: { type: 'number', description: 'Price cap in whole US dollars; pricier results are dropped.' },
      limit: { type: 'number', description: `How many products (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).` },
    },
    required: ['query'],
  },
};

/** An Exa key is saved and the app is online, so product_search can be offered. */
export const productSearchAvailable = exaAvailable;

export function addProductSearchTool(registry: ToolRegistry): void {
  if (!exaAvailable()) return;
  registry.set('product_search', {
    definition: PRODUCT_SEARCH,
    execute: (input, signal) => searchProducts(input, signal),
  });
}

async function searchProducts(input: unknown, signal: AbortSignal): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const query = typeof args['query'] === 'string' ? args['query'].trim() : '';
  if (!query) return { content: 'product_search needs a query.', isError: true };
  const store = typeof args['store'] === 'string' ? args['store'].trim().replace(/^https?:\/\//, '').split('/')[0] : '';
  const maxPrice = Number(args['max_price']);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(args['limit']) || DEFAULT_LIMIT));

  try {
    const results = await exaSearch(
      {
        query,
        category: 'product',
        numResults: limit * OVERFETCH,
        ...(store ? { includeDomains: [store] } : {}),
        summary: {
          query: 'The single product sold on this page: its name, current price, currency, seller, and stock.',
          schema: PRODUCT_SUMMARY_SCHEMA,
        },
      },
      signal,
    );
    const products = pickWebProducts(results, limit, Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : undefined);
    if (products.length === 0) {
      return { content: `No product pages matched "${query}"${store ? ` on ${store}` : ''}. Try the web search tool instead.` };
    }
    // Sources get the product pages only; the photo links are for the model.
    publishLinks(products.map((product) => product.url).join('\n'));
    return { content: `Product pages for "${query}":\n${products.map(webProductLine).join('\n')}` };
  } catch (error) {
    if (signal.aborted) return { content: 'Cancelled.', isError: true };
    const detail = errorMessage(error);
    log.warn(`product_search failed: ${detail}`);
    return { content: `product_search failed: ${detail}`, isError: true };
  }
}
