// Keeping labels readable.
//
// A label wants to sit next to its shape, but several shapes in one
// explanation often land close together, and two overlapping bubbles are
// worse than one slightly misplaced. Each is nudged down until it clears the
// ones already placed, and kept on screen.

const NUDGE = 6;
const EDGE = 8;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  );
}

/**
 * Nudge every bubble clear of the ones placed before it. Bubbles are already
 * sized and positioned; this only moves them vertically, which keeps a label
 * beside the thing it names rather than sending it across the screen.
 */
export function placeLabels(root: SVGGElement): void {
  const placed: Box[] = [];

  for (const group of root.querySelectorAll<SVGGElement>('g.draw-bubble')) {
    const rect = group.querySelector<SVGRectElement>('rect.draw-bubble-bg');
    const text = group.querySelector<SVGTextElement>('text.draw-bubble-text');
    if (!rect || !text) continue;

    const box: Box = {
      x: Number(rect.getAttribute('x') ?? 0),
      y: Number(rect.getAttribute('y') ?? 0),
      width: Number(rect.getAttribute('width') ?? 0),
      height: Number(rect.getAttribute('height') ?? 0),
    };
    if (box.width === 0) continue;

    let shift = 0;
    const limit = window.innerHeight - box.height - EDGE;
    while (
      placed.some((other) => overlaps({ ...box, y: box.y + shift }, other)) &&
      box.y + shift < limit
    ) {
      shift += box.height + NUDGE;
    }
    if (shift > 0) {
      const y = Math.min(box.y + shift, limit);
      const moved = y - box.y;
      rect.setAttribute('y', String(y));
      text.setAttribute('y', String(Number(text.getAttribute('y') ?? 0) + moved));
      box.y = y;
    }
    placed.push(box);
  }
}
