// One Exa search request, shared by the structured search tools (products,
// dining, lodging). The key is the one pasted on the Exa web-search server
// under Hands, so none of those tools need anything new configured.

import { isExaServer } from '../../shared/search-servers';
import { apiFetch } from '../account/api';
import { managedReady } from '../account/credentials';
import { listServers } from '../mcp/config';
import { getSettings } from '../settings';
import type { ExaResult } from './format';
import { createLogger } from '../log';

const log = createLogger('exa');

/** What a refused search tells the model: nothing about why. */
export const SEARCH_UNAVAILABLE = "The search couldn't run right now. Tell the user plainly you couldn't look it up, without saying why.";

const SEARCH_URL = 'https://api.exa.ai/search';
const TIMEOUT_MS = 20_000;

export interface ExaSearchRequest {
  query: string;
  /** A free-text hint at the kind of page ("product", "restaurant"). */
  category: string;
  numResults: number;
  includeDomains?: string[];
  /** What to pull off each page, and the JSON schema it must fit. */
  summary: { query: string; schema: object };
}

/** The key pasted on the Exa server under Hands, if any. */
export function exaApiKey(): string | null {
  for (const server of listServers()) {
    if (!server.enabled || !isExaServer(server)) continue;
    const header = Object.entries(server.headers).find(([name]) => name.toLowerCase() === 'x-api-key');
    if (header?.[1]) return header[1];
  }
  return null;
}

/** An Exa key is saved (or Buddy's serves it) and the app is online, so the Exa tools can be offered. */
export function exaAvailable(): boolean {
  return !getSettings().airplaneMode && (Boolean(exaApiKey()) || managedReady('exa'));
}

/** Run one search. Throws on a refused request; the caller words the failure for the model. */
export async function exaSearch(request: ExaSearchRequest, signal: AbortSignal): Promise<ExaResult[]> {
  const key = exaApiKey();
  if (!key && !managedReady('exa')) throw new Error('No Exa API key is saved on the Exa server under Hands.');
  const body = JSON.stringify({
    query: request.query,
    type: 'auto',
    category: request.category,
    numResults: request.numResults,
    userLocation: 'US',
    ...(request.includeDomains?.length ? { includeDomains: request.includeDomains } : {}),
    contents: { summary: request.summary },
  });
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
  // The user's key goes to Exa; Buddy's stays on the API, which forwards the same body.
  const response = key
    ? await fetch(SEARCH_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key }, body, signal: timeout })
    : await apiFetch('/v1/exa/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: timeout });
  if (!response.ok) {
    // The refusal's body (a spent allowance, the plan, cents) is for the log;
    // the model gets only that the search did not run, so it cannot read it out.
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    log.warn(`search refused (HTTP ${response.status}): ${detail}`);
    throw new Error(SEARCH_UNAVAILABLE);
  }
  const reply = (await response.json()) as { results?: ExaResult[] };
  return reply.results ?? [];
}
