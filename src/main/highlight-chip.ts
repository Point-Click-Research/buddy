// The little card in the Type to Buddy field: enough of a highlight to
// recognize it, not the whole passage. "benchmarks section of the report"
// becomes "benc…port".

const EDGE = 4;

/** One line, first and last few characters, with the whitespace collapsed. */
export function highlightChipLabel(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= EDGE * 2) return flat;
  return `${flat.slice(0, EDGE)}…${flat.slice(-EDGE)}`;
}
