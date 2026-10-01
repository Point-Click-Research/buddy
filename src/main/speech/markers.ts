// Reveal markers: how a drawing waits for its moment.
//
// A shape drawn with show_at: "roof" stays hidden until Buddy's reply
// reaches the marker [[roof]]. The marker itself is stage direction — it is
// never spoken and never shown in the caption.
//
// Markers arrive in a stream that can split anywhere, including between the
// two brackets, so the caption cleaner holds back a suspicious tail until it
// can tell whether it was a marker or just text that mentions brackets.
//
// Pure module: no imports, fully unit-testable.

const MARKER = /\[\[([a-zA-Z0-9_-]{1,40})\]\]/g;

/** How much text may be held back as a possible partial marker. */
const MAX_PARTIAL = 44;

/** The marker names in a piece of text, in order. */
export function markersIn(text: string): string[] {
  return [...text.matchAll(MARKER)].map((match) => match[1]!);
}

/** The text with its markers removed. */
export function stripMarkers(text: string): string {
  return text.replace(MARKER, '');
}

export interface MarkerStream {
  /**
   * Clean one streamed delta for display. Returns the text safe to show now
   * and the marker names that just completed.
   */
  clean(delta: string): { text: string; markers: string[] };
  /** The stream ended: whatever was held back was just text after all. */
  flush(): string;
}

/**
 * A cleaner for streamed text. Anything after an unfinished "[[" is held
 * until it either completes into a marker (removed, reported) or turns out
 * to be ordinary text (released).
 */
export function createMarkerStream(): MarkerStream {
  let held = '';

  return {
    clean(delta) {
      let text = held + delta;
      held = '';

      const markers = markersIn(text);
      text = stripMarkers(text);

      // A trailing "[[name", "[[name]" or lone "[" may still become a
      // marker once the next delta lands; hold it.
      const partial = /\[\[[a-zA-Z0-9_-]{0,40}\]?$|\[$/.exec(text);
      if (partial && text.length - partial.index <= MAX_PARTIAL) {
        held = text.slice(partial.index);
        text = text.slice(0, partial.index);
      }
      return { text, markers };
    },

    flush() {
      const tail = held;
      held = '';
      return tail;
    },
  };
}
