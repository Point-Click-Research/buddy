// Pure Control-tap counting for the Type to Buddy double-tap. Feed it
// timestamped key events; every completed tap reports how many consecutive
// taps it makes. No Electron or uiohook imports, so it's fully unit-testable.

/** A tap is Control held no longer than this. */
const TAP_MAX_HOLD_MS = 250;
/** The next tap must start within this long after the previous tap ended. */
const TAP_MAX_GAP_MS = 400;

export interface TapEvent {
  type: 'down' | 'up';
  /** True for either Control key; false for every other key. */
  isControl: boolean;
  /** Another modifier (Alt/Shift/Meta) is down, per the OS flags on this event. */
  otherModifierDown?: boolean;
  /** Timestamp in ms (any monotonic-enough clock). */
  time: number;
}

export interface TapCounter {
  /** Process one key event. Returns the consecutive tap count the event just completed (0 = none). */
  handle(event: TapEvent): number;
  /** Consume the sequence: the next tap counts as the first again. */
  reset(): void;
}

export function createTapCounter(): TapCounter {
  let tapCount = 0;
  let lastTapEnd = -Infinity;
  let controlDownAt: number | null = null;
  // True when another key is involved in the current Control hold — that
  // makes it a shortcut/chord (e.g. hold-to-talk), never a tap. Held
  // modifiers come from the OS flags on the event itself, never from
  // counting other keys' downs and ups: uiohook drops events under the
  // agent's synthetic typing, and one missed key-up used to leave a ghost
  // "held" key that disabled the tap gestures until the app was restarted.
  let dirty = false;

  return {
    handle(event: TapEvent): number {
      if (!event.isControl) {
        if (event.type === 'down') {
          if (controlDownAt !== null) dirty = true;
          tapCount = 0; // any other key press resets the sequence
        }
        return 0;
      }

      if (event.type === 'down') {
        // Too long since the last tap ended: start a fresh sequence.
        if (event.time - lastTapEnd > TAP_MAX_GAP_MS) tapCount = 0;
        controlDownAt = event.time;
        dirty = Boolean(event.otherModifierDown);
        return 0;
      }
      if (event.otherModifierDown) dirty = true;

      // Control key-up. Ignore an up without a matching down.
      if (controlDownAt === null) return 0;
      const heldMs = event.time - controlDownAt;
      controlDownAt = null;

      if (dirty || heldMs > TAP_MAX_HOLD_MS) {
        // A chord or a long hold is not a tap and breaks the sequence.
        dirty = false;
        tapCount = 0;
        return 0;
      }

      tapCount++;
      lastTapEnd = event.time;
      return tapCount;
    },
    reset(): void {
      tapCount = 0;
    },
  };
}
