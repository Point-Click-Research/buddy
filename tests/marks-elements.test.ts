import { describe, expect, it } from 'vitest';
import { elementsUnderMark, MAX_ELEMENTS_PER_MARK } from '../src/main/marks/elements';
import type { RefRow } from '../src/main/computer/tree';

function row(ref: string, x: number, y: number, w: number, h: number, role = 'button'): RefRow {
  return {
    ref,
    index: Number(ref.slice(1)),
    token: null,
    role,
    name: ref,
    value: '',
    enabled: true,
    selected: false,
    bounds: { x, y, w, h },
    textBounds: null,
    depth: 1,
    actions: [],
  };
}

describe('elementsUnderMark', () => {
  it('returns only elements intersecting the mark, most specific first', () => {
    const rows = [
      row('e1', 0, 0, 1512, 982, 'window'), // the whole window
      row('e2', 100, 100, 200, 40), // inside the mark
      row('e3', 500, 500, 80, 30), // outside
      row('e4', 240, 110, 30, 20), // small, inside
    ];
    const found = elementsUnderMark(rows, { x: 90, y: 90, width: 250, height: 80 });
    expect(found.map((r) => r.ref)).toEqual(['e4', 'e2', 'e1']); // smallest first
  });

  it('treats touching-but-not-overlapping boxes as outside', () => {
    const rows = [row('e1', 300, 100, 50, 20)];
    // The mark ends exactly where the element starts.
    expect(elementsUnderMark(rows, { x: 200, y: 100, width: 100, height: 20 })).toHaveLength(0);
  });

  it('ignores elements without bounds', () => {
    const bare = { ...row('e1', 0, 0, 10, 10), bounds: null };
    expect(elementsUnderMark([bare], { x: 0, y: 0, width: 100, height: 100 })).toHaveLength(0);
  });

  it('caps the list at the per-mark maximum', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`e${i + 1}`, 10 + i, 10, 20, 20));
    const found = elementsUnderMark(rows, { x: 0, y: 0, width: 200, height: 200 });
    expect(found).toHaveLength(MAX_ELEMENTS_PER_MARK);
  });
});
