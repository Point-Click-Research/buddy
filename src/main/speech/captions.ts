// The caption pacer: turns each spoken sentence into a stream of words,
// released roughly at the pace the voice reads them, so the bubble types
// along with the speech instead of popping a whole sentence at once.
//
// The pace is an estimate, so it self-corrects at every boundary: pushing the
// next sentence (its clip just started) flushes whatever the estimate left
// behind, and the caller flushes when the voice finishes. The text can never
// trail the voice by more than the current sentence.

/** ≈ a TTS voice's reading pace; a hair quick, so text leads, never lags. */
const MS_PER_CHAR = 50;
const MIN_WORD_MS = 90;
const MAX_WORD_MS = 500;

export interface CaptionPacer {
  /** A sentence just started playing: flush the last one, start pacing this one. */
  push(sentence: string): void;
  /** Show everything still scheduled, now (the voice finished). */
  flush(): void;
  /** Drop everything unshown, silently (the turn was cancelled). */
  stop(): void;
}

export function createCaptionPacer(emit: (text: string) => void): CaptionPacer {
  let queue: string[] = [];
  let timer: NodeJS.Timeout | null = null;

  const clearTimer = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const emitNext = (): void => {
    timer = null;
    const word = queue.shift();
    if (word === undefined) return;
    emit(word);
    if (queue.length > 0) timer = setTimeout(emitNext, readMs(word));
  };

  const flush = (): void => {
    clearTimer();
    if (queue.length > 0) emit(queue.join(''));
    queue = [];
  };

  return {
    push(sentence) {
      flush();
      // A fenced code block is not read word by word — the voice says "code
      // omitted" — so pacing it would keep typing code long after the voice
      // has moved on. It appears whole, like the block it is.
      if (sentence.includes('```')) {
        emit(sentence);
        return;
      }
      // Split keeping each word's trailing whitespace, so joins are lossless.
      queue = sentence.match(/\S+\s*/g) ?? [];
      emitNext();
    },
    flush,
    stop() {
      clearTimer();
      queue = [];
    },
  };
}

/** How long the voice roughly spends on one word. */
function readMs(word: string): number {
  return Math.min(MAX_WORD_MS, Math.max(MIN_WORD_MS, word.trim().length * MS_PER_CHAR));
}
