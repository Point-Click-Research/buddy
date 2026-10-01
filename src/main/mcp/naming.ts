// Maps MCP tools to Claude-safe tool names (`<server>__<tool>`) and back.
// Pure module: no Electron imports, fully unit-testable.

/** Claude tool names: letters, digits, `_` and `-`, at most this long. */
const MAX_NAME_LENGTH = 64;

/** Where an exposed tool name really points. */
export interface ToolRef {
  serverId: string;
  toolName: string;
}

/** Replace everything Claude's tool-name rules reject; never empty. */
export function sanitizeNamePart(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'tool';
}

/**
 * Build the exposed-name map for all connected servers. Deterministic for a
 * given input, so names are stable across requests. Collisions (same server
 * name, or names meeting at the length cap) get numeric suffixes.
 */
export function buildToolNameMap(
  servers: Array<{ serverId: string; serverName: string; toolNames: string[] }>,
): Map<string, ToolRef> {
  const map = new Map<string, ToolRef>();
  for (const server of servers) {
    for (const toolName of server.toolNames) {
      const base = `${sanitizeNamePart(server.serverName)}__${sanitizeNamePart(toolName)}`.slice(
        0,
        MAX_NAME_LENGTH,
      );
      let exposed = base;
      for (let n = 2; map.has(exposed); n++) {
        const suffix = `_${n}`;
        exposed = base.slice(0, MAX_NAME_LENGTH - suffix.length) + suffix;
      }
      map.set(exposed, { serverId: server.serverId, toolName });
    }
  }
  return map;
}
