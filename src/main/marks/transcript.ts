// Linking marks to words: each mark lands in the transcript right after the
// word being spoken when the mark was finished — "move this ⟦mark 1⟧ over
// there ⟦mark 2⟧". With word-level timestamps the placement is exact; without
// them marks are placed proportionally by time and the caller says so.
//
// Pure module, unit-tested.

/** One word with its position in the recording, when the ear provides them. */
export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

/** When each mark was finished, relative to the start of the recording. */
export interface MarkTiming {
  number: number;
  endMs: number;
}

export function markToken(number: number): string {
  return `⟦mark ${number}⟧`;
}

export interface MarkedTranscript {
  text: string;
  /** True when marks were placed proportionally (no word timestamps). */
  approximate: boolean;
}

/**
 * The transcript with each mark's token inserted after the word being spoken
 * when the mark was finished. A silent turn with marks becomes the question
 * "What is this?" listing every mark.
 */
export function insertMarkTokens(
  transcript: string,
  words: readonly WordTiming[] | null,
  marks: readonly MarkTiming[],
  recordingMs: number,
): MarkedTranscript {
  const ordered = [...marks].sort((a, b) => a.number - b.number);
  if (ordered.length === 0) return { text: transcript, approximate: false };

  const trimmed = transcript.trim();
  if (!trimmed) {
    return {
      text: `What is this? ${ordered.map((mark) => markToken(mark.number)).join(' ')}`,
      approximate: false,
    };
  }

  const tokens = trimmed.split(/\s+/);
  const timed = words !== null && words.length > 0;

  /** After how many transcript tokens this mark belongs. */
  const insertionIndex = (mark: MarkTiming): number => {
    if (timed) {
      const spoken = words.filter((word) => word.endMs <= mark.endMs).length;
      // Corrections can change the token count; map through the word list
      // proportionally so the index still lands in the right neighborhood.
      const index =
        words.length === tokens.length
          ? spoken
          : Math.round((spoken / words.length) * tokens.length);
      return clamp(index, 0, tokens.length);
    }
    const fraction = recordingMs > 0 ? mark.endMs / recordingMs : 1;
    return clamp(Math.round(fraction * tokens.length), 0, tokens.length);
  };

  // Group marks by insertion point, then build the sentence in one pass.
  const at = new Map<number, string[]>();
  for (const mark of ordered) {
    const index = insertionIndex(mark);
    const list = at.get(index) ?? [];
    list.push(markToken(mark.number));
    at.set(index, list);
  }

  const parts: string[] = [];
  for (let i = 0; i <= tokens.length; i++) {
    if (i > 0) parts.push(tokens[i - 1]!);
    const inserted = at.get(i);
    if (inserted) parts.push(...inserted);
  }
  return { text: parts.join(' '), approximate: !timed };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
