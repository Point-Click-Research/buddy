// Per-tool permission decisions: allow / ask / deny. Tools whose MCP
// annotations mark them read-only default to allow; everything else asks.
// Pure module: override storage lives in config.ts, the ask UI in confirm.ts.

import type { ToolPermission } from '../../shared/types';

/** The slice of MCP tool annotations that matters for permissions. */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
}

export function defaultPermission(annotations?: ToolAnnotations): ToolPermission {
  return annotations?.readOnlyHint === true ? 'allow' : 'ask';
}

/** The user's explicit setting wins; otherwise the annotation-based default. */
export function decidePermission(
  override: ToolPermission | undefined,
  annotations?: ToolAnnotations,
): ToolPermission {
  return override ?? defaultPermission(annotations);
}

/**
 * May this server be used in airplane mode? Buddy's guarantee is about what
 * Buddy itself sends: stdio talks to a local process, and an HTTP server on
 * loopback stays on this Mac, so both pass. A remote URL is Buddy sending
 * the conversation over the internet — blocked. What a local process does
 * with the internet on its own is beyond Buddy's sight.
 */
export function allowedInAirplaneMode(transport: string, url: string): boolean {
  if (transport !== 'http') return true;
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

/** Interpret a spoken confirmation answer. null = not a clear yes or no. */
export function parseYesNo(transcript: string): boolean | null {
  const first = transcript.toLowerCase().match(/[a-z']+/)?.[0] ?? '';
  if (['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'go', 'approve', 'confirm'].includes(first)) {
    return true;
  }
  if (['no', 'nope', 'nah', 'stop', 'cancel', 'deny', "don't"].includes(first)) return false;
  return null;
}
