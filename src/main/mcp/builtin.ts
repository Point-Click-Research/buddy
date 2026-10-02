// Search and phone calls ship with Buddy. When the account holds those keys,
// the desktop keeps a keyless server so the tools connect through the API.
// A server the user gave their own key stays pointed at the provider.

import { isExaServer } from '../../shared/search-servers';
import { isBlandServer } from '../../shared/types';

const BLAND_MCP_URL = 'https://api.bland.ai/v1/mcp';
const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';

const BUILTIN = [
  { name: 'bland', url: BLAND_MCP_URL, managed: 'bland' },
  { name: 'exa', url: EXA_MCP_URL, managed: 'exa' },
] as const;

function isBuiltin(server: { name: string; url: string }, managed: string): boolean {
  if (managed === 'bland') return isBlandServer({ ...server, enabled: true });
  return isExaServer(server);
}

/** Builtin servers the account can serve that are not already configured. */
export function missingBuiltinServers(
  servers: ReadonlyArray<{ name: string; url: string }>,
  managed: readonly string[],
): Array<{ name: string; url: string }> {
  return BUILTIN.filter(
    (spec) => managed.includes(spec.managed) && !servers.some((server) => isBuiltin(server, spec.managed)),
  ).map(({ name, url }) => ({ name, url }));
}

/** Where a keyless Exa server connects: the API, which holds Buddy's key. */
export function exaProxyUrl(
  server: { name: string; url: string; headers: Record<string, string> },
  apiUrl: string,
  managed: boolean,
): string | null {
  if (!managed || !apiUrl) return null;
  if (!isExaServer(server)) return null;
  const own = Object.entries(server.headers).some(
    ([name, value]) => name.toLowerCase() === 'x-api-key' && value.trim().length > 0,
  );
  if (own) return null;
  const target = new URL(server.url);
  return `${apiUrl.replace(/\/$/, '')}/v1/exa-mcp${target.pathname}${target.search}`;
}
