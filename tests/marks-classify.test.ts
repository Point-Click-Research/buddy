import { describe, expect, it } from 'vitest';
import { classifyStroke, directionName, simplify, type StrokePoint } from '../src/main/marks/classify';

/** A circle of points around (cx, cy); `sweep` < 1 leaves the loop open. */
function circle(cx: number, cy: number, radius: number, sweep = 1, steps = 40): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let i = 0; i <= steps * sweep; i++) {
    const angle = (i / steps) * Math.PI * 2;
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return points;
}

function line(x1: number, y1: number, x2: number, y2: number, steps = 20): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    points.push({ x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps });
  }
  return points;
}

describe('classifyStroke', () => {
  it('a press with almost no movement is a tap at its center', () => {
    const result = classifyStroke([
      { x: 100, y: 100 },
      { x: 102, y: 101 },
      { x: 101, y: 102 },
    ]);
    expect(result.kind).toBe('tap');
    expect(result.points).toHaveLength(1);
    expect(result.points[0]!.x).toBeCloseTo(101, 0);
    expect(result.bounds.width).toBeGreaterThan(0); // a tap still has a box
  });

  it('a closed loop is a region with the loop bbox', () => {
    const result = classifyStroke(circle(300, 300, 80));
    expect(result.kind).toBe('region');
    expect(result.bounds.x).toBeCloseTo(220, 0);
    expect(result.bounds.width).toBeCloseTo(160, 0);
    // The polygon is closed: first and last points coincide.
    const first = result.points[0]!;
    const last = result.points[result.points.length - 1]!;
    expect(first).toEqual(last);
  });

  it('a nearly closed loop still counts as a region', () => {
    const result = classifyStroke(circle(300, 300, 80, 0.88));
    expect(result.kind).toBe('region');
  });

  it('a rectangle drawn as four sides is a region', () => {
    const points = [
      ...line(100, 100, 300, 100),
      ...line(300, 100, 300, 220),
      ...line(300, 220, 100, 220),
      ...line(100, 220, 100, 108), // messy: doesn't quite reach the start
    ];
    expect(classifyStroke(points).kind).toBe('region');
  });

  it('a dense scribble that shades an area is a region', () => {
    const points: StrokePoint[] = [];
    for (let pass = 0; pass < 14; pass++) {
      const y = 100 + pass * 6;
      const [from, to] = pass % 2 === 0 ? [100, 260] : [260, 100];
      points.push(...line(from, y, to, y, 30));
    }
    expect(classifyStroke(points).kind).toBe('region');
  });

  it('a mostly horizontal open stroke is an underline whose band sits above', () => {
    const result = classifyStroke(line(100, 400, 420, 406));
    expect(result.kind).toBe('underline');
    expect(result.bounds.y).toBeLessThan(400); // the band is above the stroke
    expect(result.bounds.x).toBe(100);
    expect(result.bounds.width).toBeCloseTo(320, 0);
    expect(result.bounds.height).toBeGreaterThanOrEqual(14);
    expect(result.bounds.height).toBeLessThanOrEqual(44);
  });

  it('an open diagonal stroke is a path with a start-to-end direction', () => {
    const result = classifyStroke(line(100, 100, 300, 300));
    expect(result.kind).toBe('path');
    expect(result.direction!.dx).toBeCloseTo(Math.SQRT1_2, 3);
    expect(result.direction!.dy).toBeCloseTo(Math.SQRT1_2, 3);
  });

  it('a mostly vertical open stroke is a path, not an underline', () => {
    const result = classifyStroke(line(200, 100, 210, 400));
    expect(result.kind).toBe('path');
  });
});

describe('directionName', () => {
  it('names the eight directions', () => {
    expect(directionName({ dx: 1, dy: 0 })).toBe('right');
    expect(directionName({ dx: -1, dy: 0 })).toBe('left');
    expect(directionName({ dx: 0, dy: 1 })).toBe('down');
    expect(directionName({ dx: 0, dy: -1 })).toBe('up');
    expect(directionName({ dx: Math.SQRT1_2, dy: -Math.SQRT1_2 })).toBe('up-right');
    expect(directionName({ dx: -Math.SQRT1_2, dy: Math.SQRT1_2 })).toBe('down-left');
  });
});

describe('simplify', () => {
  it('collapses collinear points and keeps corners', () => {
    const points = [...line(0, 0, 100, 0, 50), ...line(100, 0, 100, 100, 50)];
    const simplified = simplify(points, 1);
    expect(simplified.length).toBeLessThan(8);
    expect(simplified[0]).toEqual({ x: 0, y: 0 });
    expect(simplified[simplified.length - 1]).toEqual({ x: 100, y: 100 });
    // The corner survives.
    expect(simplified.some((point) => point.x === 100 && point.y === 0)).toBe(true);
  });
});
