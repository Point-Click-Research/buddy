// MCP configuration storage: server definitions (with safeStorage-encrypted
// secret header/env values), per-tool permission overrides, and the Claude
// Desktop-style `mcpServers` JSON import. Decrypted values stay in main.

import { randomUUID } from 'crypto';
import { safeStorage } from 'electron';
import Store from 'electron-store';
import { managedProviders } from '../account/api';
import { missingBuiltinServers } from './builtin';
import { isParallelServer } from '../../shared/search-servers';
import {
  MCP_SECRET_MASK,
  type McpImportResult,
  type McpServerDraft,
  type McpTransport,
  type ToolPermission,
} from '../../shared/types';

/** A header/env value: plain text, or safeStorage-encrypted base64. */
type StoredValue = string | { encrypted: string };

interface StoredServer {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
  url: string;
  headers: Record<string, StoredValue>;
  command: string;
  args: string[];
  env: Record<string, StoredValue>;
}

interface McpStoreShape {
  servers: StoredServer[];
  /** `${serverId}/${toolName}` -> the user's explicit permission. */
  permissions: Record<string, ToolPermission>;
}

// Separate file (mcp.json) so server configs never mix with app settings.
const store = new Store<McpStoreShape>({ name: 'mcp', defaults: { servers: [], permissions: {} } });

/** A fully decrypted server config. Main-process only; never send over IPC. */
export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
  url: string;
  headers: Record<string, string>;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function listServers(): McpServerConfig[] {
  return store.get('servers').map((server) => ({
    ...server,
    headers: mapValues(server.headers, decrypt),
    env: mapValues(server.env, decrypt),
  }));
}

/** Masked configs for the settings UI: secret values become MCP_SECRET_MASK. */
export function listServerDrafts(): Array<McpServerDraft & { id: string }> {
  return store.get('servers').map((server) => ({
    ...server,
    headers: mapValues(server.headers, mask),
    env: mapValues(server.env, mask),
  }));
}

/** Add keyless Bland and Exa servers when Buddy holds those keys. Returns whether anything was added. */
export function ensureBuiltinServers(): boolean {
  const missing = missingBuiltinServers(listServers(), managedProviders());
  for (const spec of missing) {
    saveServer({
      name: spec.name,
      transport: 'http',
      enabled: true,
      url: spec.url,
      headers: {},
      command: '',
      args: [],
      env: {},
    });
  }
  return missing.length > 0;
}

/** Drop saved Parallel Search servers. Web search is Exa only. */
export function removeParallelServers(): void {
  const ids = store
    .get('servers')
    .filter((server) => isParallelServer(server))
    .map((server) => server.id);
  for (const id of ids) removeServer(id);
}

/** Add (no id) or update (with id) a server. Returns the server's id. */
export function saveServer(draft: McpServerDraft): string {
  if (isParallelServer(draft)) {
    if (draft.id) removeServer(draft.id);
    return draft.id ?? '';
  }
  const servers = store.get('servers');
  const existing = servers.find((server) => server.id === draft.id);
  const stored: StoredServer = {
    id: existing?.id ?? randomUUID(),
    name: draft.name.trim() || 'server',
    transport: draft.transport,
    enabled: draft.enabled,
    url: draft.url.trim(),
    headers: encryptValues(draft.headers, existing?.headers),
    command: draft.command.trim(),
    args: draft.args.filter((arg: string) => arg.length > 0),
    env: encryptValues(draft.env, existing?.env),
  };
  store.set(
    'servers',
    existing ? servers.map((server) => (server.id === stored.id ? stored : server)) : [...servers, stored],
  );
  return stored.id;
}

export function removeServer(id: string): void {
  store.set('servers', store.get('servers').filter((server) => server.id !== id));
  const permissions = { ...store.get('permissions') };
  for (const key of Object.keys(permissions)) {
    if (key.startsWith(`${id}/`)) delete permissions[key];
  }
  store.set('permissions', permissions);
}

// --- Permission overrides ----------------------------------------------------

export function getPermissionOverride(serverId: string, toolName: string): ToolPermission | undefined {
  return store.get('permissions')[`${serverId}/${toolName}`];
}

export function setPermissionOverride(
  serverId: string,
  toolName: string,
  permission: ToolPermission,
): void {
  store.set('permissions', { ...store.get('permissions'), [`${serverId}/${toolName}`]: permission });
}

// --- Claude Desktop import -----------------------------------------------------

/** Import a Claude Desktop-style `mcpServers` JSON block (or just its contents). */
export function importServers(json: string): McpImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { added: 0, errors: ['Not valid JSON.'] };
  }
  const root = parsed as Record<string, unknown>;
  const entries = (root['mcpServers'] ?? root) as Record<string, unknown>;
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    return { added: 0, errors: ['No mcpServers object found.'] };
  }

  const result: McpImportResult = { added: 0, errors: [] };
  for (const [name, raw] of Object.entries(entries)) {
    const entry = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
    if (!entry) {
      result.errors.push(`${name}: not a server object.`);
      continue;
    }
    const url = ['url', 'serverUrl', 'httpUrl'].map((key) => entry[key]).find((v) => typeof v === 'string');
    if (isParallelServer({ name, url: typeof url === 'string' ? url : '' })) {
      result.errors.push(`${name}: Parallel search was removed. Web search is included.`);
      continue;
    }
    if (typeof entry['command'] === 'string') {
      saveServer({
        name,
        transport: 'stdio',
        enabled: true,
        url: '',
        headers: {},
        command: entry['command'],
        args: Array.isArray(entry['args']) ? entry['args'].map(String) : [],
        env: stringRecord(entry['env']),
      });
      result.added++;
    } else if (typeof url === 'string') {
      saveServer({
        name,
        transport: 'http',
        enabled: true,
        url,
        headers: stringRecord(entry['headers']),
        command: '',
        args: [],
        env: {},
      });
      result.added++;
    } else {
      result.errors.push(`${name}: needs a "command" (stdio) or "url" (HTTP).`);
    }
  }
  return result;
}

// --- Secret handling ----------------------------------------------------------

/** Header/env names that suggest the value is a secret worth encrypting. */
function looksLikeSecret(name: string): boolean {
  return /key|token|secret|password|auth|bearer/i.test(name);
}

function encryptValues(
  values: Record<string, string>,
  previous: Record<string, StoredValue> | undefined,
): Record<string, StoredValue> {
  const out: Record<string, StoredValue> = {};
  for (const [rawName, value] of Object.entries(values)) {
    const name = rawName.trim();
    if (!name) continue;
    if (value === MCP_SECRET_MASK) {
      // The UI sent the mask back untouched: keep whatever is stored.
      const kept = previous?.[name];
      if (kept !== undefined) out[name] = kept;
    } else if (looksLikeSecret(name) && safeStorage.isEncryptionAvailable()) {
      out[name] = { encrypted: safeStorage.encryptString(value).toString('base64') };
    } else {
      out[name] = value;
    }
  }
  return out;
}

function decrypt(value: StoredValue): string {
  return typeof value === 'string'
    ? value
    : safeStorage.decryptString(Buffer.from(value.encrypted, 'base64'));
}

function mask(value: StoredValue): string {
  return typeof value === 'string' ? value : MCP_SECRET_MASK;
}

function mapValues(
  values: Record<string, StoredValue>,
  fn: (value: StoredValue) => string,
): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, fn(value)]));
}

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}
