// Minimal markdown, parsed once and rendered twice: as React in the chat
// window (ui/Markdown.tsx) and as DOM nodes in the overlay caption
// (overlay/caption-markdown.ts). Only the shapes LLM replies actually use —
// fenced code, inline code, bold, italics, links, bullets, headings. An
// unclosed fence parses as a code block in progress, which is exactly what
// a streaming reply looks like mid-fence.

/** One inline token: a code span, bold, italics, a markdown link, or a bare URL. */
const INLINE =
  /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>\]]+)/g;
const LINK = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/;
const BARE_URL = /^https?:\/\//;

export type Inline =
  | { kind: 'text'; body: string }
  | { kind: 'code'; body: string }
  | { kind: 'bold'; parts: Inline[] }
  | { kind: 'em'; body: string }
  | { kind: 'link'; label: string; url: string };

export { withoutEmDash } from '../../shared/em-dash';

/** Headings render bold and list markers become bullets — a chat bubble is
 * too small for real heading sizes to read as anything but shouting. */
export interface Line {
  style: 'plain' | 'heading' | 'bullet';
  /** A bullet's leading whitespace, kept so nesting still reads. */
  indent: string;
  parts: Inline[];
}

export type Block = { kind: 'code'; body: string } | { kind: 'text'; lines: Line[] };

/** Split on ``` fence lines; the fence (and its language tag) is dropped. */
export function parseMarkdown(text: string): Block[] {
  const out: Block[] = [];
  let buffer: string[] = [];
  let code = false;
  const flush = (): void => {
    if (buffer.length === 0) return;
    out.push(code ? { kind: 'code', body: buffer.join('\n') } : { kind: 'text', lines: buffer.map(parseLine) });
    buffer = [];
  };
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      flush();
      code = !code;
      continue;
    }
    buffer.push(line);
  }
  flush();
  return out;
}

function parseLine(line: string): Line {
  const heading = /^#{1,6}\s+(.*)$/.exec(line);
  if (heading) return { style: 'heading', indent: '', parts: parseInline(heading[1]!) };
  const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
  if (bullet) return { style: 'bullet', indent: bullet[1]!, parts: parseInline(bullet[2]!) };
  return { style: 'plain', indent: '', parts: parseInline(line) };
}

/**
 * A bare URL match includes any trailing punctuation that stuck to it.
 * Hand that back as text. A ")" stays on the URL when it closes one the
 * URL itself opened (a Wikipedia title), and comes off otherwise.
 */
function bareUrl(token: string): Inline[] {
  const [url, rest] = splitTrailing(token);
  const link: Inline = { kind: 'link', label: url, url };
  return rest ? [link, { kind: 'text', body: rest }] : [link];
}

export type BarePart = { kind: 'text'; body: string } | { kind: 'link'; url: string };

/** Plain text split into words and bare URLs, newlines included. No other markdown. */
export function splitBareLinks(text: string): BarePart[] {
  const out: BarePart[] = [];
  const pushText = (body: string): void => {
    if (!body) return;
    const last = out[out.length - 1];
    if (last?.kind === 'text') last.body += body;
    else out.push({ kind: 'text', body });
  };
  const pattern = /https?:\/\/[^\s<>\]]+/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const [url, rest] = splitTrailing(match[0]);
    if (start > cursor) pushText(text.slice(cursor, start));
    if (url) out.push({ kind: 'link', url });
    pushText(rest);
    cursor = start + match[0].length;
  }
  if (cursor < text.length) pushText(text.slice(cursor));
  return out;
}

function splitTrailing(token: string): [url: string, rest: string] {
  let end = token.length;
  while (end > 'https://'.length && isDangling(token, end)) end -= 1;
  return [token.slice(0, end), token.slice(end)];
}

function isDangling(token: string, end: number): boolean {
  const char = token[end - 1];
  if (char === undefined || !'.,;:!?)'.includes(char)) return false;
  if (char !== ')') return true;
  let opens = 0;
  let closes = 0;
  for (let i = 0; i < end; i++) {
    if (token[i] === '(') opens += 1;
    else if (token[i] === ')') closes += 1;
  }
  return closes > opens;
}

function parseInline(line: string): Inline[] {
  // With one capture group, split alternates plain text and matched tokens.
  return line.split(INLINE).flatMap((part, i): Inline[] => {
    if (!part) return [];
    if (i % 2 === 0) return [{ kind: 'text', body: part }];
    if (part.startsWith('`')) return [{ kind: 'code', body: part.slice(1, -1) }];
    if (part.startsWith('**')) return [{ kind: 'bold', parts: parseInline(part.slice(2, -2)) }];
    if (part.startsWith('[')) {
      const [, label, url] = LINK.exec(part)!;
      return [{ kind: 'link', label: label!, url: url! }];
    }
    if (BARE_URL.test(part)) return bareUrl(part);
    return [{ kind: 'em', body: part.slice(1, -1) }];
  });
}
