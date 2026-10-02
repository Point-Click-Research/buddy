// Pure cursor-shake detection for the Type to Buddy trigger. Feed it
// timestamped cursor positions (the ~60fps poller); it returns true exactly
// when a horizontal shake completes — the same wiggle macOS uses to find the
// cursor. No Electron imports, so it's fully unit-testable.

/** All the reversals of a shake must land inside this window. */
const SHAKE_WINDOW_MS = 600;
/** Each leg (one sweep before turning back) must cover at least this. */
const SHAKE_MIN_LEG_PX = 40;
/** Direction reversals needed: left-right-left-right. */
const SHAKE_REVERSALS = 3;
/** One shake opens the box once; ignore wiggles for this long after. */
const SHAKE_COOLDOWN_MS = 1_000;

/** The cursor stopped for this long: whatever was building is over. */
const PAUSE_MS = 200;

export interface ShakeSample {
  x: number;
  y: number;
  /** Timestamp in ms (any monotonic-enough clock). */
  time: number;
}

export interface ShakeDetector {
  /** Process one cursor sample. Returns true when a shake just completed. */
  handle(sample: ShakeSample): boolean;
  /** Forget everything (e.g. a drag began: those moves are not a gesture). */
  reset(): void;
}

export function createShakeDetector(): ShakeDetector {
  let last: ShakeSample | null = null;
  /** Direction (-1 left, +1 right) and length of the current horizontal leg. */
  let legDir = 0;
  let legLen = 0;
  /** When each completed long-enough leg turned back. */
  let reversals: number[] = [];
  let firedAt = -Infinity;

  const clear = (): void => {
    legDir = 0;
    legLen = 0;
    reversals = [];
  };

  return {
    handle(sample: ShakeSample): boolean {
      const prev = last;
      last = sample;
      if (!prev) return false;
      if (sample.time - prev.time > PAUSE_MS) clear();

      const dx = sample.x - prev.x;
      if (dx !== 0) {
        const dir = dx > 0 ? 1 : -1;
        if (dir === legDir) {
          legLen += Math.abs(dx);
        } else {
          // The sweep turned back. It only counts once it was a real sweep,
          // not jitter — otherwise slow diagonal moves rack up reversals.
          if (legDir !== 0 && legLen >= SHAKE_MIN_LEG_PX) reversals.push(sample.time);
          legDir = dir;
          legLen = Math.abs(dx);
        }
      }

      reversals = reversals.filter((time) => sample.time - time <= SHAKE_WINDOW_MS);
      if (reversals.length >= SHAKE_REVERSALS && sample.time - firedAt > SHAKE_COOLDOWN_MS) {
        firedAt = sample.time;
        clear();
        return true;
      }
      return false;
    },
    reset(): void {
      last = null;
      clear();
    },
  };
}
