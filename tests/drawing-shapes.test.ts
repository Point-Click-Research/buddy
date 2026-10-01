// The shapes stage (b) added, through the validator the model actually hits.

import { describe, expect, it } from 'vitest';
import type { AnchorWorld } from '../src/main/drawing/anchors';
import { validateDraw, type ValidateOptions } from '../src/main/drawing/validate';

const DISPLAY = { x: 0, y: 0, width: 1440, height: 900 };

const world: AnchorWorld = {
  frame: (frameId) =>
    frameId === 'f1' ? { displayId: 1, imageWidth: 1440, imageHeight: 900, bounds: DISPLAY } : null,
  element: (observationId, ref) =>
    observationId === 's1' && ref === 'e4'
      ? { displayId: 1, rect: { x: 200, y: 300, width: 80, height: 24 }, display: DISPLAY }
      : null,
  mark: () => null,
};

function options(): ValidateOptions {
  let counter = 0;
  return {
    world,
    displays: new Map([[1, DISPLAY]]),
    nextId: () => `d${++counter}`,
    now: 0,
  };
}

const point = (x: number, y: number) => ({ x, y, frameId: 'f1' });
const ELEMENT = { ref: 'e4', observationId: 's1' };

/**
 * Build one shape and return its command, failing loudly on rejection.
 * Geometry assertions ask for a clean line, since the hand-drawn default
 * deliberately rewrites the outline (covered by its own tests below).
 */
function one(shape: Record<string, unknown>) {
  const result = validateDraw({ shapes: [{ stroke: 'solid', ...shape }] }, options());
  if (result.shapes.length === 0) throw new Error(result.errors.join(' '));
  return result.shapes[0]!.command;
}

function rejects(shape: Record<string, unknown>): string {
  const result = validateDraw({ shapes: [shape] }, options());
  expect(result.shapes).toEqual([]);
  return result.errors[0] ?? '';
}

describe('geometry for explaining', () => {
  it('draws an arc over the span it was given', () => {
    const command = one({ type: 'arc', at: point(200, 200), radius: 50, start_angle: 0, end_angle: 90 });
    expect(command.geometry.kind).toBe('path');
    // 0 degrees is to the right, 90 clockwise is straight down.
    const d = (command.geometry as { d: string }).d;
    expect(d.startsWith('M 250 200')).toBe(true);
    expect(d.trimEnd().endsWith('200 250')).toBe(true);
  });

  it('refuses an arc that goes round more than once', () => {
    expect(rejects({ type: 'arc', at: point(10, 10), radius: 5, start_angle: 0, end_angle: 400 })).toContain(
      '360 degrees',
    );
  });

  it('closes a regular polygon with one point per side', () => {
    const command = one({ type: 'regular_polygon', at: point(300, 300), radius: 60, sides: 6 });
    const d = (command.geometry as { d: string }).d;
    expect((d.match(/L /g) ?? []).length).toBe(5);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('holds a polygon to between three and twelve sides', () => {
    for (const sides of [2, 13, 0, -3]) {
      expect(rejects({ type: 'regular_polygon', at: point(10, 10), radius: 5, sides })).toContain('3 to 12');
    }
  });

  it('measures an angle and labels it in degrees', () => {
    // A right angle: one leg to the right, one straight down.
    const command = one({
      type: 'angle',
      vertex: point(100, 100),
      a: point(200, 100),
      b: point(100, 200),
      show_degrees: true,
    });
    expect(command.label?.text).toBe('90°');
  });

  it('leaves an angle unlabelled unless asked', () => {
    const command = one({ type: 'angle', vertex: point(100, 100), a: point(200, 100), b: point(100, 200) });
    expect(command.label).toBeUndefined();
  });

  it('refuses an angle whose legs sit on its vertex', () => {
    expect(rejects({ type: 'angle', vertex: point(10, 10), a: point(10, 10), b: point(90, 10) })).toContain(
      'on top of its vertex',
    );
  });

  it('gives a dimension line ticks at both ends and arrowheads', () => {
    const command = one({ type: 'dimension', from: point(100, 500), to: point(300, 500) });
    const geometry = command.geometry as { d: string; arrowStart: boolean; arrowEnd: boolean };
    expect(geometry.arrowStart && geometry.arrowEnd).toBe(true);
    // The span plus one tick at each end.
    expect((geometry.d.match(/M /g) ?? []).length).toBe(3);
  });

  it('brackets a side of something, square or curly', () => {
    const square = one({ type: 'bracket', around: ELEMENT, side: 'left' });
    expect((square.geometry as { d: string }).d).toContain('L ');
    const curly = one({ type: 'bracket', around: ELEMENT, side: 'left', style: 'curly' });
    expect((curly.geometry as { d: string }).d).toContain('Q ');
  });

  it('underlines below something and strikes through its middle', () => {
    const under = one({ type: 'underline', around: ELEMENT });
    const through = one({ type: 'strike', around: ELEMENT });
    const lowest = Number((under.geometry as { d: string }).d.match(/M [\d.]+ ([\d.]+)/)![1]);
    const middle = Number((through.geometry as { d: string }).d.match(/M [\d.]+ ([\d.]+)/)![1]);
    expect(lowest).toBeGreaterThan(middle);
  });

  it('waves an underline when asked', () => {
    expect((one({ type: 'underline', around: ELEMENT, style: 'wavy' }).geometry as { d: string }).d).toContain(
      'Q ',
    );
  });

  it('rules a grid across a region at the spacing given', () => {
    const command = one({ type: 'grid', from: point(0, 0), to: point(100, 100), spacing: 25 });
    // Five verticals and five horizontals across a hundred points.
    expect(((command.geometry as { d: string }).d.match(/M /g) ?? []).length).toBe(10);
  });

  it('refuses a grid spacing that would draw thousands of lines', () => {
    expect(rejects({ type: 'grid', from: point(0, 0), to: point(500, 500), spacing: 0.5 })).toContain(
      'spacing',
    );
  });

  it('draws axes with ticks along both', () => {
    const command = one({ type: 'axes', from: point(0, 0), to: point(200, 100), ticks: 4 });
    // Two axes plus four ticks on each.
    expect(((command.geometry as { d: string }).d.match(/M /g) ?? []).length).toBe(10);
  });
});

describe('plotting', () => {
  it('draws a function inside the box it was given', () => {
    const command = one({
      type: 'plot',
      from: point(0, 0),
      to: point(200, 100),
      expression: 'sin(x)',
      x_range: [-3, 3],
      y_range: [-1, 1],
    });
    expect((command.geometry as { d: string }).d.startsWith('M ')).toBe(true);
  });

  it('breaks the curve at an asymptote rather than drawing through it', () => {
    const command = one({
      type: 'plot',
      from: point(0, 0),
      to: point(200, 100),
      expression: '1/x',
      x_range: [-2, 2],
      y_range: [-10, 10],
    });
    // More than one subpath means the line was lifted at the break.
    expect(((command.geometry as { d: string }).d.match(/M /g) ?? []).length).toBeGreaterThan(1);
  });

  it('needs both ranges', () => {
    expect(
      rejects({ type: 'plot', from: point(0, 0), to: point(9, 9), expression: 'x', x_range: [0, 1] }),
    ).toContain('x_range and y_range');
  });

  it('refuses a range that runs backwards', () => {
    expect(
      rejects({
        type: 'plot',
        from: point(0, 0),
        to: point(9, 9),
        expression: 'x',
        x_range: [1, 0],
        y_range: [0, 1],
      }),
    ).toContain('high above low');
  });
});

describe('freeform', () => {
  it('parses a path the model wrote and maps it onto the display', () => {
    const command = one({ type: 'svg_path', d: 'M 10 10 L 20 20', frameId: 'f1' });
    expect((command.geometry as { d: string }).d).toBe('M 10 10 L 20 20');
  });

  it('refuses a path with anything but the commands it allows', () => {
    expect(rejects({ type: 'svg_path', d: 'M 0 0 <script>', frameId: 'f1' })).toBeTruthy();
  });

  it('needs to know which screenshot a path was measured in', () => {
    expect(rejects({ type: 'svg_path', d: 'M 0 0 L 1 1' })).toContain('frameId');
  });

  it('makes a pen stroke into a filled outline, not a stroked line', () => {
    const command = one({ type: 'freehand', points: [point(10, 10), point(40, 30), point(80, 20)] });
    expect(command.geometry.kind).toBe('ink');
    expect((command.geometry as { d: string }).d.endsWith('Z')).toBe(true);
  });

  it('bows a connector away from the straight line between two things', () => {
    const connector = one({ type: 'connector', from: ELEMENT, to: point(900, 320) });
    // A quadratic control point is what makes it bow.
    expect((connector.geometry as { d: string }).d).toContain('Q ');
  });

  it('dims the screen around a spotlight', () => {
    const command = one({ type: 'spotlight', around: ELEMENT });
    expect(command.geometry).toMatchObject({ kind: 'spotlight', hole: { x: 192, y: 292 } });
  });

  it('keeps a spotlight feather within reason', () => {
    const command = one({ type: 'spotlight', around: ELEMENT, feather: 9_000 });
    expect((command.geometry as { feather: number }).feather).toBe(200);
  });

  it('softens a small spotlight less, so the glow is not bigger than the target', () => {
    // A tab is about 28 points tall. A fixed fade around it lit an area
    // twice its size, which points at the wrong thing.
    const tab = one({ type: 'spotlight', around: ELEMENT });
    const page = one({ type: 'spotlight', from: point(0, 0), to: point(800, 600) });
    const tabFeather = (tab.geometry as { feather: number }).feather;
    const pageFeather = (page.geometry as { feather: number }).feather;
    expect(tabFeather).toBeLessThan(20);
    expect(pageFeather).toBeGreaterThan(tabFeather);
  });
});

describe('the sketch stroke style', () => {
  const center = (command: { geometry: unknown }): string => (command.geometry as { center: string }).center;

  it('redraws an outline with the pen the user marks with', () => {
    const plain = one({ type: 'rect', from: point(0, 0), to: point(100, 50) });
    const sketched = one({ type: 'rect', from: point(0, 0), to: point(100, 50), stroke: 'sketch' });
    expect(plain.geometry.kind).toBe('rect');
    // A pen-drawn box is ink: a filled outline, not a stroked rectangle.
    expect(sketched.geometry.kind).toBe('ink');
    expect((sketched.geometry as { d: string }).d.endsWith('Z')).toBe(true);
  });

  it('rings with one loop that runs on past where it started', () => {
    const ring = one({ type: 'ellipse', at: point(200, 200), radius: 40, id: 'ring', stroke: 'sketch' });
    expect(ring.geometry.kind).toBe('ink');
    const path = center(ring);
    expect(path.match(/M /g)).toHaveLength(1);
    const numbers = path.match(/-?[\d.]+/g)!.map(Number);
    const [startX, startY] = numbers;
    const [endX, endY] = numbers.slice(-2);
    // The overshoot carries it round and a little wider, so the ends don't meet.
    expect(Math.hypot(endX! - startX!, endY! - startY!)).toBeGreaterThan(5);
  });

  it('draws an arrowhead as a second quick stroke at the tip', () => {
    const arrow = one({ type: 'arrow', from: point(0, 0), to: point(200, 0), stroke: 'sketch' });
    expect(arrow.geometry.kind).toBe('ink');
    expect(center(arrow).match(/M /g)).toHaveLength(2);
  });

  it('keeps a soft fill on the plain shape, since ink has no inside to fill', () => {
    const filled = one({ type: 'rect', from: point(0, 0), to: point(100, 50), fill: 'soft', stroke: 'sketch' });
    expect(filled.geometry.kind).toBe('rect');
  });

  it('is the default for expressive shapes, and not for measurements', () => {
    // Buddy draws by hand; a wobbly ring has charm. A wobbly plotted curve
    // or dimension line is misinformation, so those stay clean.
    const byHand = validateDraw(
      { shapes: [{ type: 'rect', from: point(0, 0), to: point(100, 50) }] },
      options(),
    ).shapes[0]!;
    expect(byHand.command.stroke).toBe('sketch');
    expect(byHand.command.geometry.kind).toBe('ink');

    const precise = validateDraw(
      { shapes: [{ type: 'dimension', from: point(0, 0), to: point(100, 0) }] },
      options(),
    ).shapes[0]!;
    expect(precise.command.stroke).toBe('solid');
  });

  it('comes out the same way every time, so a redraw does not jitter', () => {
    const first = one({ type: 'rect', from: point(0, 0), to: point(100, 50), stroke: 'sketch', id: 'box' });
    const again = one({ type: 'rect', from: point(0, 0), to: point(100, 50), stroke: 'sketch', id: 'box' });
    expect((first.geometry as { d: string }).d).toBe((again.geometry as { d: string }).d);
  });

  it('leaves alone the shapes that have no outline to sketch', () => {
    const text = one({ type: 'text', at: point(10, 10), content: 'hello', stroke: 'sketch' });
    expect(text.geometry.kind).toBe('text');
  });
});
