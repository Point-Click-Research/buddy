// Pure text helpers for TTS: split streaming text into complete sentences
// and clean text so it reads well out loud. No imports: fully unit-testable.

/** Words whose trailing period is not a sentence end. */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'inc', 'ltd',
  'no', 'approx', 'dept', 'est', 'min', 'max', 'fig', 'e.g', 'i.e', 'a.m', 'p.m',
  'u.s', 'u.k',
]);

export interface SentenceSplit {
  /** Complete sentences, in order. */
  sentences: string[];
  /** Trailing text that may still be growing (flush it when the stream ends). */
  rest: string;
}

/**
 * Extract complete sentences from a streaming buffer. A sentence ends at
 * . ! or ? followed by whitespace — except decimals (3.14), abbreviations
 * (Dr., e.g.), and single-letter initials (J. Smith). Punctuation at the very
 * end of the buffer stays in `rest`, because more text may still arrive.
 *
 * Fenced code is never split: a "." or "?" inside code is not a sentence
 * end, and the spoken-text cleaner can only say "code omitted" for a fence
 * it sees whole — split across sentences, raw code would be read aloud. A
 * complete block becomes its own sentence (the prose that led into it is
 * flushed first); an unfinished block waits in `rest` for its closing fence.
 */
export function extractSentences(buffer: string): SentenceSplit {
  const sentences: string[] = [];
  let tail = buffer;
  while (true) {
    const open = fenceIndex(tail, 0);
    if (open === -1) break;
    const before = extractProse(tail.slice(0, open));
    sentences.push(...before.sentences);
    const close = fenceIndex(tail, endOfLine(tail, open));
    if (close === -1) {
      // The block is still streaming: hold it, and the unfinished prose
      // before it, until the closing fence arrives.
      return { sentences, rest: before.rest + tail.slice(open) };
    }
    // The fence ends whatever sentence introduced it ("Here's the fix:").
    const lead = before.rest.trim();
    if (lead) sentences.push(lead);
    const end = endOfLine(tail, close);
    sentences.push(tail.slice(open, end).trim());
    tail = tail.slice(end);
  }
  const last = extractProse(tail);
  return { sentences: [...sentences, ...last.sentences], rest: last.rest };
}

/** The start of the first line at or after `from` that opens/closes a fence. */
function fenceIndex(text: string, from: number): number {
  for (let i = text.indexOf('```', from); i !== -1; i = text.indexOf('```', i + 3)) {
    const lineStart = text.lastIndexOf('\n', i - 1) + 1;
    if (lineStart >= from && /^[ \t]*$/.test(text.slice(lineStart, i))) return lineStart;
  }
  return -1;
}

/** The index just past the line containing `at` (or the end of the text). */
function endOfLine(text: string, at: number): number {
  const newline = text.indexOf('\n', at);
  return newline === -1 ? text.length : newline + 1;
}

/** The punctuation-based split, for text known to contain no code fence. */
function extractProse(buffer: string): SentenceSplit {
  const sentences: string[] = [];
  let start = 0;

  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i]!;
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;

    // A period between digits is a decimal point.
    if (ch === '.' && /\d/.test(buffer[i - 1] ?? '') && /\d/.test(buffer[i + 1] ?? '')) continue;

    // Include closing quotes/brackets right after the punctuation.
    let end = i + 1;
    while (end < buffer.length && /["')\]]/.test(buffer[end]!)) end++;

    // End of buffer: the sentence might not be finished yet — keep waiting.
    if (end >= buffer.length) break;
    if (!/\s/.test(buffer[end]!)) continue; // e.g. "3.x" or mid-token dots

    if (ch === '.') {
      const word = (buffer.slice(start, i).match(/([A-Za-z.]+)$/)?.[1] ?? '')
        .toLowerCase()
        .replace(/\.+$/, '');
      if (ABBREVIATIONS.has(word)) continue;
      if (/^[a-z]$/.test(word)) continue; // single-letter initial
    }

    const sentence = buffer.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
  }

  return { sentences, rest: buffer.slice(start) };
}

/** Strip anything that shouldn't be spoken aloud. */
export function toSpokenText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' code omitted ')
    // A fence never closed (a flushed tail): everything after it is code too.
    .replace(/(^|\n)[ \t]*```[\s\S]*$/, ' code omitted ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // markdown link -> its label
    .replace(/https?:\/\/\S+|www\.\S+/gi, 'a link')
    .replace(/[*_`#~]+/g, '') // markdown emphasis/heading symbols
    .replace(/^\s*[-•>]\s+/gm, '') // bullets and quote markers
    .replace(/\s+/g, ' ')
    .trim();
}
