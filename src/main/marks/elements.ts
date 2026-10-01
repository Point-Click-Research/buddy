// Which accessibility elements a mark touched. Pure module: it takes the
// rows of a window observation and a mark's box (both in global screen DIP)
// and returns the elements under or inside the mark, most specific first.

import { visibleBounds, type RefRow } from '../computer/tree';
import type { Rect } from './classify';

/** At most this many elements are named per mark in the model's context. */
export const MAX_ELEMENTS_PER_MARK = 15;

/** The rows whose boxes intersect the mark, smallest (most specific) first. */
export function elementsUnderMark(rows: readonly RefRow[], mark: Rect): RefRow[] {
  return rows
    .filter((row) => {
      const box = visibleBounds(row);
      return (
        box !== null &&
        box.x < mark.x + mark.width &&
        box.x + box.w > mark.x &&
        box.y < mark.y + mark.height &&
        box.y + box.h > mark.y
      );
    })
    .sort((a, b) => area(a) - area(b))
    .slice(0, MAX_ELEMENTS_PER_MARK);
}

function area(row: RefRow): number {
  const box = visibleBounds(row);
  return box ? box.w * box.h : Infinity;
}
