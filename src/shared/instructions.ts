// A job's instructions as the editor draws them and the runner reads them.
// Stored as plain text: a reference to an app, site, MCP server, or Mac tool
// is a markdown-style link, `[Gmail](app:gmail)` or `[Resy](site:resy.com)`,
// and a blank for the user to fill is a bare `[product URL]`. Pure: the
// editor, the runner, and tests.

export type RefSource = 'app' | 'site' | 'mcp' | 'tool';

export type InstructionPart =
  | { kind: 'text'; text: string }
  | { kind: 'ref'; source: RefSource; id: string; label: string; raw: string }
  | { kind: 'blank'; hint: string; raw: string };

/** A reference first, so `[Gmail](app:gmail)` is never read as the blank `[Gmail]`. */
const TOKEN = /\[([^\]\n]+)\]\((app|site|mcp|tool):([\w.-]+)\)|\[([^\]\n]+)\]/g;

export function parseInstructions(text: string): InstructionPart[] {
  const parts: InstructionPart[] = [];
  let at = 0;
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > at) parts.push({ kind: 'text', text: text.slice(at, index) });
    const [raw, label, source, id, hint] = match;
    parts.push(
      label !== undefined
        ? { kind: 'ref', source: source as RefSource, id: id!, label, raw }
        : { kind: 'blank', hint: hint!, raw },
    );
    at = index + raw.length;
  }
  if (at < text.length) parts.push({ kind: 'text', text: text.slice(at) });
  return parts;
}

export function refToken(source: RefSource, id: string, label: string): string {
  return `[${label.replace(/[[\]\n]/g, '')}](${source}:${id})`;
}

/** The Mac tools the instructions name, so the job can be granted them. */
export function toolRefs(text: string): string[] {
  return parseInstructions(text).flatMap((part) => (part.kind === 'ref' && part.source === 'tool' ? [part.id] : []));
}

/** Whether any blank is still waiting to be filled in. */
export function hasBlanks(text: string): boolean {
  return parseInstructions(text).some((part) => part.kind === 'blank');
}

/**
 * The instructions in words for the model: a reference names what it is and
 * how to reach it (a connected app goes through use_app by its slug).
 */
export function instructionsForModel(text: string): string {
  return parseInstructions(text)
    .map((part) => {
      if (part.kind !== 'ref') return part.kind === 'text' ? part.text : part.raw;
      if (part.source === 'app') return `${part.label} (the connected app "${part.id}")`;
      if (part.source === 'site') return `${part.label} (in Buddy's browser at ${part.id})`;
      if (part.source === 'mcp') return `${part.label} (the ${part.id} MCP tools)`;
      return part.label;
    })
    .join('');
}
