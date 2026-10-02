// MCP server runtime: connects to configured servers on launch and whenever
// the config changes, lists their tools, reconnects with backoff, and exposes
// the tools (behind permission checks) to the model's tool registry.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolOutcome, ToolRegistry } from '../ai/tools';
import { knownContactName } from '../apple/contacts';
import { publishLinks } from '../sources';
import { createLogger } from '../log';
import { getSettings } from '../settings';
import { broadcast } from '../windows';
import { accessToken } from '../account/session';
import { managedReady } from '../account/credentials';
import { ACCOUNT } from '../account/config';
import { APP_NAME, isBlandServer, mcpServerLabel, type CallStatus, type McpServerView } from '../../shared/types';
import { isExaServer } from '../../shared/search-servers';
import { exaProxyUrl } from './builtin';
import { ensureBuiltinServers, getPermissionOverride, listServerDrafts, listServers, removeParallelServers, type McpServerConfig } from './config';
import { requestConfirmation } from './confirm';
import { buildToolNameMap } from './naming';
import { allowedInAirplaneMode, decidePermission, type ToolAnnotations } from './permissions';
import { toToolOutcome, type McpCallResult } from './results';
import { dialedPhone, exposesTool, isOutboundBlandCall, outboundCallNote, withGreetingWait, blandProxyUrl, hasOwnBlandKey } from './bland-call';
import { toolConfirmCard } from './tool-card';
import { IpcChannels } from '../../shared/ipc';
import { errorMessage } from '../../shared/errors';

const log = createLogger('mcp');

const RETRY_INITIAL_MS = 2_000;
const RETRY_MAX_MS = 60_000;

interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Tool['input_schema'];
  annotations?: ToolAnnotations;
}

interface Runtime {
  config: McpServerConfig;
  client: Client | null;
  status: 'connecting' | 'connected' | 'error';
  error: string;
  tools: McpToolInfo[];
  retryDelayMs: number;
  retryTimer: NodeJS.Timeout | null;
  /** Set during teardown so close events don't trigger reconnects. */
  closing: boolean;
}

const runtimes = new Map<string, Runtime>();
let notifyChange: () => void = () => {};

/** Registered once by ipc.ts to push fresh views to the settings window. */
export function onMcpServersChanged(cb: () => void): void {
  notifyChange = cb;
}

export function startMcp(): void {
  removeParallelServers();
  refreshManagedServers();
}

/** The managed set last applied, so a token refresh does not reconnect search and phone. */
let managedStamp = '';

/**
 * Keep Bland and Exa connected through Buddy's keys once the account is known.
 * A session refresh with the same plan does nothing.
 */
export function refreshManagedServers(): void {
  const stamp = (['bland', 'exa'] as const).filter((name) => managedReady(name)).join(',');
  const added = ensureBuiltinServers();
  if (added || stamp !== managedStamp) {
    managedStamp = stamp;
    for (const [id, runtime] of runtimes) {
      const server = runtime.config;
      const builtin = isBlandServer({ ...server, enabled: true }) || isExaServer(server);
      if (!builtin) continue;
      teardown(runtime);
      runtimes.delete(id);
    }
  }
  syncMcpServers();
}

export function stopMcp(): void {
  for (const runtime of runtimes.values()) teardown(runtime);
  runtimes.clear();
}

/** Reconcile live connections with the stored config. Safe to call any time. */
export function syncMcpServers(): void {
  const configs = new Map(listServers().map((config) => [config.id, config]));

  for (const [id, runtime] of runtimes) {
    const config = configs.get(id);
    if (!config?.enabled || JSON.stringify(config) !== JSON.stringify(runtime.config)) {
      teardown(runtime);
      runtimes.delete(id);
    }
  }
  for (const config of configs.values()) {
    if (!config.enabled || runtimes.has(config.id) || unkeyedBland(config)) continue;
    const runtime: Runtime = {
      config,
      client: null,
      status: 'connecting',
      error: '',
      tools: [],
      retryDelayMs: RETRY_INITIAL_MS,
      retryTimer: null,
      closing: false,
    };
    runtimes.set(config.id, runtime);
    void connect(runtime);
  }
  notifyChange();
}

/** Bland refuses a keyless connection, so without the account's proxy it would only retry forever. */
function unkeyedBland(config: McpServerConfig): boolean {
  return isBlandServer({ ...config, enabled: true }) && !hasOwnBlandKey(config.headers) && !managedReady('bland');
}

async function connect(runtime: Runtime): Promise<void> {
  runtime.status = 'connecting';
  runtime.error = '';
  notifyChange();
  try {
    const client = new Client({ name: APP_NAME.toLowerCase(), version: '0.2.0' });
    client.onclose = () => {
      if (!runtime.closing && runtimes.get(runtime.config.id) === runtime) {
        runtime.client = null;
        fail(runtime, 'Connection closed.');
      }
    };
    await client.connect(createTransport(runtime.config));
    const listed = await client.listTools();
    if (runtime.closing) return;

    runtime.client = client;
    const server = { ...runtime.config, enabled: true };
    runtime.tools = listed.tools.filter((tool) => exposesTool(server, tool.name)).map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema as Tool['input_schema'],
      annotations: tool.annotations as ToolAnnotations | undefined,
    }));
    runtime.status = 'connected';
    runtime.retryDelayMs = RETRY_INITIAL_MS;
    log.info(`connected to "${runtime.config.name}" (${runtime.tools.length} tools)`);
    notifyChange();
  } catch (error) {
    fail(runtime, errorMessage(error));
  }
}

function fail(runtime: Runtime, message: string): void {
  // A connect error and the client's onclose can both land here; retry once.
  if (runtime.closing || runtime.retryTimer) return;
  runtime.status = 'error';
  runtime.error = message;
  runtime.tools = [];
  log.warn(`"${runtime.config.name}": ${message} — retrying in ${runtime.retryDelayMs / 1000}s`);
  runtime.retryTimer = setTimeout(() => {
    runtime.retryTimer = null;
    void connect(runtime);
  }, runtime.retryDelayMs);
  runtime.retryDelayMs = Math.min(runtime.retryDelayMs * 2, RETRY_MAX_MS);
  notifyChange();
}

function teardown(runtime: Runtime): void {
  runtime.closing = true;
  if (runtime.retryTimer) clearTimeout(runtime.retryTimer);
  runtime.retryTimer = null;
  void runtime.client?.close().catch(() => undefined);
  runtime.client = null;
}

/** The session token, refreshed, where Bland would read an API key. */
async function fetchWithSession(url: string | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = await accessToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

function createTransport(config: McpServerConfig) {
  if (config.transport === 'http') {
    const proxy =
      blandProxyUrl(config, ACCOUNT.apiUrl, managedReady('bland')) ??
      exaProxyUrl(config, ACCOUNT.apiUrl, managedReady('exa'));
    return new StreamableHTTPClientTransport(new URL(proxy ?? config.url), {
      requestInit: { headers: proxy ? {} : config.headers },
      ...(proxy ? { fetch: fetchWithSession } : {}),
    });
  }
  return new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: { ...getDefaultEnvironment(), ...config.env },
    stderr: 'ignore',
  });
}

// --- Tools for the model -------------------------------------------------------

/** Is a server usable this turn? Airplane mode grounds the remote ones. */
function usable(runtime: Runtime): boolean {
  return !getSettings().airplaneMode || allowedInAirplaneMode(runtime.config.transport, runtime.config.url);
}

/** Exa is connected, so the prompt can treat web search as available. */
export function hasWebSearchServer(): boolean {
  return [...runtimes.values()].some(
    (runtime) =>
      runtime.status === 'connected' &&
      usable(runtime) &&
      isExaServer({ name: runtime.config.name, url: runtime.config.url }),
  );
}

/** Add every connected, usable server's tools to one request's registry. */
export function addMcpTools(registry: ToolRegistry): void {
  for (const [exposedName, ref] of currentNameMap()) {
    const runtime = runtimes.get(ref.serverId);
    const tool = runtime?.tools.find((t) => t.name === ref.toolName);
    if (!runtime || !tool || !usable(runtime)) continue;
    registry.set(exposedName, {
      definition: {
        name: exposedName,
        description: `[${mcpServerLabel(runtime.config)}] ${tool.description}${outboundCallNote(runtime.config, tool.name)}`,
        input_schema: tool.inputSchema,
      },
      execute: (input, signal) => callMcpTool(runtime, tool, input, signal),
    });
  }
}

async function callMcpTool(
  runtime: Runtime,
  tool: McpToolInfo,
  input: unknown,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const permission = decidePermission(
    getPermissionOverride(runtime.config.id, tool.name),
    tool.annotations,
  );
  if (permission === 'deny') {
    return { content: 'This tool is blocked in the user\'s settings.', isError: true };
  }
  // Outbound calls wait for the person who answered. Applied here so a task
  // that forgets the flag still doesn't talk over them.
  const args = withGreetingWait(runtime.config, tool.name, input, tool.inputSchema);
  const call = dialedCall(runtime.config, tool.name, args);
  if (permission === 'ask') {
    const phone = dialedPhone(args);
    const shown = call?.name ? { ...(args as object), [phone.key]: `${call.name} · ${call.number}` } : args;
    const approved = await requestConfirmation(toolConfirmCard(mcpServerLabel(runtime.config), tool.name, shown), signal);
    if (!approved) return { content: 'The user declined this tool call.', isError: true };
  }
  // Both paths below explain the failure in terms the model can pass on: it
  // is the one that has to tell the user why the answer is missing.
  if (!runtime.client) {
    const detail = runtime.error ? ` (${runtime.error})` : '';
    return {
      content:
        `The "${runtime.config.name}" server isn't connected${detail}. Answer without it if you ` +
        'can, and tell the user to check Settings → MCP servers.',
      isError: true,
    };
  }
  // The thread's call card: dialing now, then how it went.
  const publishCall = (state: CallStatus['state']): void => {
    if (!call) return;
    liveCall = state === 'failed' ? null : call;
    broadcast(IpcChannels.callStatus, { ...call, state } satisfies CallStatus);
  };
  try {
    publishCall('dialing');
    const result = await runtime.client.callTool(
      { name: tool.name, arguments: (args ?? {}) as Record<string, unknown> },
      undefined,
      { signal },
    );
    const outcome = toToolOutcome(result as McpCallResult, getSettings().mcpResultLimit);
    publishCall(outcome.isError ? 'failed' : 'started');
    // Offer the sources to the user: a search answer is more useful when they
    // can open what it was based on.
    publishLinks(outcome.content);
    return outcome;
  } catch (error) {
    publishCall('failed');
    const detail = errorMessage(error);
    log.warn(`"${runtime.config.name}" failed to run ${tool.name}: ${detail}`);
    return {
      content: `The "${mcpServerLabel(runtime.config)}" server couldn't run ${tool.name}: ${detail}`,
      isError: true,
    };
  }
}

/** The call last placed and not yet over, for endLiveCall. */
let liveCall: Omit<CallStatus, 'state'> | null = null;

/** Whether this exposed tool name places a phone call. */
export function placesCall(exposedName: string): boolean {
  const ref = currentNameMap().get(exposedName);
  const runtime = ref ? runtimes.get(ref.serverId) : undefined;
  return Boolean(ref && runtime && isOutboundBlandCall(runtime.config, ref.toolName));
}

/**
 * The turn that placed the call is over, so the call is: every call card
 * comes down. A spoken turn needs no telling (its idle state does it); a
 * background turn has no state, so it says so here.
 */
export function endLiveCall(): void {
  if (!liveCall) return;
  broadcast(IpcChannels.callStatus, { ...liveCall, state: 'ended' } satisfies CallStatus);
  liveCall = null;
}

/**
 * Who a Bland call tool is about to dial: the number (empty when the args
 * don't name one) and the contact it belongs to when a lookup found them.
 * Null when this tool call isn't placing a call at all. Bland's server names
 * the tool create_call; older wrappers say send_call.
 */
function dialedCall(config: McpServerConfig, toolName: string, input: unknown): Omit<CallStatus, 'state'> | null {
  if (!isOutboundBlandCall(config, toolName)) return null;
  const { number } = dialedPhone(input);
  const name = number ? knownContactName(number) : undefined;
  return { number, ...(name ? { name } : {}) };
}

// --- Settings views --------------------------------------------------------------

export function getMcpServerViews(): McpServerView[] {
  const exposedNames = new Map<string, string>(); // `${serverId}/${tool}` -> exposed
  for (const [exposed, ref] of currentNameMap()) {
    exposedNames.set(`${ref.serverId}/${ref.toolName}`, exposed);
  }
  return listServerDrafts().map((draft) => {
    const runtime = runtimes.get(draft.id);
    return {
      ...draft,
      status: !draft.enabled ? 'disabled' : (runtime?.status ?? 'connecting'),
      error: runtime?.error ?? '',
      tools: (runtime?.tools ?? []).map((tool) => ({
        name: tool.name,
        exposedName: exposedNames.get(`${draft.id}/${tool.name}`) ?? tool.name,
        description: tool.description,
        permission: decidePermission(getPermissionOverride(draft.id, tool.name), tool.annotations),
      })),
    };
  });
}

/**
 * The permission row behind one exposed tool name, for a parked approval's
 * "Always allow". Null when the name is not a connected MCP tool.
 */
export function resolveExposedTool(
  exposedName: string,
): { serverId: string; toolName: string } | null {
  const ref = currentNameMap().get(exposedName);
  return ref ? { serverId: ref.serverId, toolName: ref.toolName } : null;
}

function currentNameMap() {
  return buildToolNameMap(
    [...runtimes.values()]
      .filter((r) => r.status === 'connected')
      .map((r) => ({
        serverId: r.config.id,
        serverName: isBlandServer({ ...r.config, enabled: true }) ? 'phone' : r.config.name,
        toolNames: r.tools.map((t) => t.name),
      })),
  );
}
