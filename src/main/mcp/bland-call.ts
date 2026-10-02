// Outbound Bland calls. Bland's default is to talk the instant the line
// connects, which talks over the person who just picked up. The wait flag
// holds the agent until they speak; Bland's own silence timeout starts it
// if they don't. Their MCP server names the flag in snake_case or camelCase
// depending on the tool, so the name comes from that tool's schema.

import { isBlandServer } from '../../shared/types';

/** create_call on Bland's server; older wrappers say send_call or make_call. */
const CALL_TOOL = /(create|send|make).?call/i;
/** Following a placed call: waiting it out, its outcome, hanging up. */
const FOLLOW_TOOL = /^(wait_for_call|get_call_log|stop_call)$/;

const WAIT_SNAKE = 'wait_for_greeting';
const WAIT_CAMEL = 'waitForGreeting';

type CallSchema = {
  properties?: unknown;
  additionalProperties?: unknown;
};

export function isOutboundBlandCall(
  server: { enabled: boolean; name: string; url: string },
  toolName: string,
): boolean {
  return isBlandServer(server) && CALL_TOOL.test(toolName);
}

/**
 * Bland's server is its whole developer platform (agents, deploys, evals,
 * buying credits and numbers); Buddy only places calls. Every exposed tool
 * rides in every request, so the rest stay out. Other servers keep all theirs.
 */
export function exposesTool(server: { enabled: boolean; name: string; url: string }, toolName: string): boolean {
  return !isBlandServer(server) || CALL_TOOL.test(toolName) || FOLLOW_TOOL.test(toolName);
}

export function hasOwnBlandKey(headers: Record<string, string>): boolean {
  return Object.entries(headers).some(
    ([name, value]) => name.toLowerCase() === 'authorization' && value.trim().length > 0,
  );
}

/**
 * Where a Bland server with no key of its own connects: the API, which holds
 * Buddy's key. A pasted Authorization header stays on Bland directly.
 */
export function blandProxyUrl(
  server: { name: string; url: string; headers: Record<string, string> },
  apiUrl: string,
  managed: boolean,
): string | null {
  if (!managed || !apiUrl) return null;
  if (!isBlandServer({ ...server, enabled: true })) return null;
  if (hasOwnBlandKey(server.headers)) return null;
  const target = new URL(server.url);
  return `${apiUrl.replace(/\/$/, '')}/v1/bland${target.pathname}${target.search}`;
}

/**
 * One sentence on the call tool, so every mode that can dial writes a task
 * for an agent that does not open over the person who answered.
 */
export function outboundCallNote(
  server: { enabled: boolean; name: string; url: string },
  toolName: string,
): string {
  if (!isOutboundBlandCall(server, toolName)) return '';
  return (
    ' The agent waits until the person who answered speaks, and starts after a short silence if they do not.' +
    ' That wait is set for you; do not tell the agent to speak the moment the line connects.'
  );
}

/** The number field this call used, and the number itself. */
export function dialedPhone(input: unknown): { key: string; number: string } {
  const record = plain(input);
  const key =
    typeof record?.phoneNumber === 'string' && typeof record.phone_number !== 'string'
      ? 'phoneNumber'
      : 'phone_number';
  const raw = record?.[key];
  return { key, number: typeof raw === 'string' ? raw.trim() : '' };
}

/** The arguments actually sent for a tool call. Non-call tools pass through. */
export function withGreetingWait(
  server: { enabled: boolean; name: string; url: string },
  toolName: string,
  input: unknown,
  schema?: CallSchema,
): unknown {
  if (!isOutboundBlandCall(server, toolName)) return input;
  const record = plain(input);
  if (!record) return input;
  const field = greetingField(record, schema);
  if (!field) return input;
  return { ...record, [field]: true };
}

/**
 * Which argument holds the wait. A closed schema that doesn't list it is left
 * alone, so a call isn't rejected for an unknown field.
 */
function greetingField(input: Record<string, unknown>, schema?: CallSchema): string | null {
  const props = schema?.properties;
  const fields = props && typeof props === 'object' ? props : null;
  if (fields) {
    if (WAIT_SNAKE in fields) return WAIT_SNAKE;
    if (WAIT_CAMEL in fields) return WAIT_CAMEL;
    if (schema?.additionalProperties === false) return null;
  }
  if ((fields && 'phoneNumber' in fields) || 'phoneNumber' in input) return WAIT_CAMEL;
  return WAIT_SNAKE;
}

function plain(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}
