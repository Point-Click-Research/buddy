// catalog_search: structured product discovery across every Shopify merchant,
// through the Global Catalog's UCP endpoint. Real product pages with price,
// seller, and stock — the structured first stop before open-web search.
//
// The key is a Dev Dashboard credential pasted as "client_id:client_secret";
// it is exchanged for a 60-minute bearer at runtime and the bearer is cached
// until just before it expires.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { type ToolOutcome, type ToolRegistry, toolArgs } from '../ai/tools';
import { SEARCH_UNAVAILABLE } from '../exa/client';
import { createLogger } from '../log';
import { getAppSecret, getSettings } from '../settings';
import { publishLinks } from '../sources';
import { productLine, type CatalogProduct } from './format';
import { errorMessage } from '../../shared/errors';

const log = createLogger('shopify-catalog');

const TOKEN_URL = 'https://api.shopify.com/auth/access_token';
const CATALOG_URL = 'https://catalog.shopify.com/api/ucp/mcp';
// Every UCP request names an agent profile; Shopify's published sample
// profile covers the catalog capability until Buddy hosts its own.
const AGENT_PROFILE = 'https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json';

const TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

const CATALOG_SEARCH: Tool = {
  name: 'catalog_search',
  description:
    'Structured product search across every Shopify merchant: real product pages with title, ' +
    'price, seller, and stock. Call it first for "find me…" product asks; the web search tool ' +
    'is the fallback when the catalog comes up short or the ask is not a product.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to find, in plain words ("white linen shirt").' },
      max_price: { type: 'number', description: 'Price cap in whole US dollars.' },
      limit: { type: 'number', description: `How many products (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).` },
    },
    required: ['query'],
  },
};

/** catalog_search, when a Shopify Catalog key is saved. Airplane mode leaves it out. */
export function addCatalogTool(registry: ToolRegistry): void {
  if (getSettings().airplaneMode || !getAppSecret('shopify')) return;
  registry.set('catalog_search', {
    definition: CATALOG_SEARCH,
    execute: (input, signal) => searchCatalog(input, signal),
  });
}

// The bearer lives an hour; refresh a minute early so a request never rides
// a token that dies mid-flight.
let cached: { key: string; token: string; expiresAt: number } | null = null;

async function bearerToken(key: string, signal: AbortSignal): Promise<string> {
  if (cached && cached.key === key && Date.now() < cached.expiresAt) return cached.token;
  const colon = key.indexOf(':');
  if (colon <= 0) {
    throw new Error('The Shopify Catalog key must be "client_id:client_secret" from the Dev Dashboard.');
  }
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: key.slice(0, colon),
      client_secret: key.slice(colon + 1),
      grant_type: 'client_credentials',
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(`Shopify refused the Catalog key (HTTP ${response.status}): ${detail}`);
  }
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('Shopify returned no access token for the Catalog key.');
  cached = {
    key,
    token: body.access_token,
    expiresAt: Date.now() + Math.max(60, (body.expires_in ?? 3_600) - 60) * 1_000,
  };
  return body.access_token;
}

async function searchCatalog(input: unknown, signal: AbortSignal): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const query = typeof args['query'] === 'string' ? args['query'].trim() : '';
  if (!query) return { content: 'catalog_search needs a query.', isError: true };
  const maxPrice = Number(args['max_price']);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(args['limit']) || DEFAULT_LIMIT));

  const key = getAppSecret('shopify');
  if (!key) {
    return { content: 'No Shopify Catalog key is saved. Add one under Settings → Developer → API keys.', isError: true };
  }

  try {
    const token = await bearerToken(key, signal);
    const response = await fetch(CATALOG_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 1,
        params: {
          name: 'search_catalog',
          arguments: {
            meta: { 'ucp-agent': { profile: AGENT_PROFILE } },
            catalog: {
              query,
              filters: {
                available: true,
                ships_to: { country: 'US' },
                // The catalog counts price in minor units (cents).
                ...(Number.isFinite(maxPrice) && maxPrice > 0
                  ? { price: { max: Math.round(maxPrice * 100) } }
                  : {}),
              },
              pagination: { limit },
            },
          },
        },
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      log.warn(`catalog refused (HTTP ${response.status}): ${detail}`);
      return { content: SEARCH_UNAVAILABLE, isError: true };
    }
    const body = (await response.json()) as {
      result?: { structuredContent?: { products?: CatalogProduct[] } };
      error?: { message?: string };
    };
    if (body.error) {
      return { content: `The Shopify Catalog returned an error: ${body.error.message ?? 'unknown'}.`, isError: true };
    }
    const products = body.result?.structuredContent?.products ?? [];
    if (products.length === 0) {
      return { content: `No catalog products matched "${query}". Try the web search tool instead.` };
    }
    const content = `Shopify Catalog results for "${query}":\n${products.map(productLine).join('\n')}`;
    publishLinks(content);
    return { content };
  } catch (error) {
    if (signal.aborted) return { content: 'Cancelled.', isError: true };
    const detail = errorMessage(error);
    log.warn(`catalog_search failed: ${detail}`);
    return { content: `catalog_search failed: ${detail}`, isError: true };
  }
}

