// The maths behind the shapes. Every path string the overlay draws is built
// here, so these are the numbers that decide whether a drawing lands on the
// thing it is pointing at.

import { describe, expect, it } from 'vitest';
import {
  arrowPath,
  boxBetween,
  moveLineTo,
  padded,
  smoothPath,
  stopAtEdge,
} from '../src/main/drawing/geometry';

/** The coordinates in a path string, in order. */
function numbersIn(d: string): number[] {
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

describe('lines through points', () => {
  it('moves to the first point and draws to the rest', () => {
    expect(moveLineTo([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toBe('M 1 2 L 3 4');
  });

  it('closes a polygon', () => {
    const d = moveLineTo([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], true);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('draws nothing from no points', () => {
    expect(moveLineTo([])).toBe('');
  });
});

describe('smooth curves', () => {
  it('passes through every point it was given', () => {
    // This is why Catmull-Rom and not a plain Bézier: the model names places
    // it wants the line to go through, so the curve has to touch them.
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 100 },
      { x: 100, y: 0 },
      { x: 150, y: 80 },
    ];
    const coordinates = numbersIn(smoothPath(points));
    for (const point of points) {
      const found = coordinates.some(
        (value, index) =>
          Math.abs(value - point.x) < 0.01 && Math.abs((coordinates[index + 1] ?? NaN) - point.y) < 0.01,
      );
      expect(found, `(${point.x}, ${point.y}) is on the curve`).toBe(true);
    }
  });

  it('starts and ends exactly where it was asked to', () => {
    const d = smoothPath([
      { x: 5, y: 7 },
      { x: 40, y: 90 },
      { x: 80, y: 20 },
    ]);
    expect(d.startsWith('M 5 7')).toBe(true);
    expect(d.trimEnd().endsWith('80 20')).toBe(true);
  });

  it('emits cubic segments, one per gap between points', () => {
    const d = smoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
      { x: 30, y: 10 },
    ]);
    expect((d.match(/C /g) ?? []).length).toBe(3);
  });

  it('falls back to a straight line when there is nothing to curve', () => {
    expect(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe('M 0 0 L 10 10');
  });

  it('joins the ends when closed', () => {
    const d = smoothPath(
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
      true,
    );
    expect(d.endsWith('Z')).toBe(true);
  });
});

describe('arrows', () => {
  it('is a straight line with no bend', () => {
    expect(arrowPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 0)).toBe('M 0 0 L 100 0');
  });

  it('bows to one side, and the other way when the bend flips', () => {
    const clockwise = numbersIn(arrowPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5));
    const anticlockwise = numbersIn(arrowPath({ x: 0, y: 0 }, { x: 100, y: 0 }, -0.5));
    // The control point's y is what bends the curve off the straight line.
    expect(clockwise[3]).toBeGreaterThan(0);
    expect(anticlockwise[3]).toBeLessThan(0);
  });

  it('keeps its endpoints wherever it bends', () => {
    const d = arrowPath({ x: 10, y: 20 }, { x: 90, y: 60 }, 0.8);
    expect(d.startsWith('M 10 20')).toBe(true);
    expect(d.endsWith('90 60')).toBe(true);
  });
});

describe('stopping at an element edge', () => {
  const box = { x: 100, y: 100, width: 40, height: 20 };

  it('pulls the head back outside the box instead of into its middle', () => {
    // An arrow pointing at a button should touch the button, not bury its
    // head in the label.
    const centre = { x: 120, y: 110 };
    const tip = stopAtEdge({ x: 0, y: 110 }, centre, box);
    expect(tip.x).toBeLessThan(centre.x - box.width / 2);
    expect(tip.y).toBeCloseTo(110);
  });

  it('leaves the point alone when there is no box', () => {
    expect(stopAtEdge({ x: 0, y: 0 }, { x: 50, y: 50 }, undefined)).toEqual({ x: 50, y: 50 });
  });

  it('survives an arrow with no length', () => {
    expect(stopAtEdge({ x: 10, y: 10 }, { x: 10, y: 10 }, box)).toEqual({ x: 10, y: 10 });
  });

  it('stops short on the vertical approach too', () => {
    const tip = stopAtEdge({ x: 120, y: 0 }, { x: 120, y: 110 }, box);
    expect(tip.y).toBeLessThan(110 - box.height / 2);
  });
});

describe('boxes', () => {
  it('grows a box by its padding', () => {
    const rect = padded({ x: 50, y: 50, width: 100, height: 20 }, 10, { width: 1000, height: 1000 });
    expect(rect).toEqual({ x: 40, y: 40, width: 120, height: 40 });
  });

  it('never grows off the display', () => {
    const rect = padded({ x: 0, y: 0, width: 100, height: 100 }, 20, { width: 110, height: 110 });
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.width).toBeLessThanOrEqual(110);
    expect(rect.height).toBeLessThanOrEqual(110);
  });

  it('reads two corners whichever way round they came', () => {
    const fromTopLeft = boxBetween({ x: 10, y: 10 }, { x: 60, y: 40 });
    const fromBottomRight = boxBetween({ x: 60, y: 40 }, { x: 10, y: 10 });
    expect(fromTopLeft).toEqual({ x: 10, y: 10, width: 50, height: 30 });
    expect(fromBottomRight).toEqual(fromTopLeft);
  });
});
