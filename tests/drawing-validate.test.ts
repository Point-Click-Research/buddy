// The validator: the boundary between what the model sends and what the
// overlay draws. A bad call must come back as a sentence the model can act
// on, and nothing it wrote may reach the renderer as markup.

import { describe, expect, it } from 'vitest';
import {
  aimAtNamed,
  bindDescribed,
  resolveAnchor,
  sameDisplay,
  type AnchorWorld,
  type DescribeElements,
} from '../src/main/drawing/anchors';
import { DrawingStore } from '../src/main/drawing/store';
import { validateDraw, collapseRepeatedMarkPointers, type ValidateOptions } from '../src/main/drawing/validate';
import { MAX_POINTS_PER_SHAPE, MAX_VISIBLE_SHAPES } from '../src/main/drawing/types';

const DISPLAY = { x: 0, y: 0, width: 1440, height: 900 };
const SECOND_DISPLAY = { x: 1440, y: 0, width: 1000, height: 800 };

/** One screenshot on each of two displays, plus one element. */
const world: AnchorWorld = {
  frame: (frameId) =>
    frameId === 'f1'
      ? { displayId: 1, imageWidth: 1440, imageHeight: 900, bounds: DISPLAY }
      : frameId === 'f2'
        ? { displayId: 2, imageWidth: 1000, imageHeight: 800, bounds: SECOND_DISPLAY }
        : null,
  element: (observationId, ref) =>
    observationId === 's1' && ref === 'e4'
      ? { displayId: 1, rect: { x: 200, y: 300, width: 80, height: 24 }, display: DISPLAY }
      : null,
  mark: () => null,
};

function options(overrides: Partial<ValidateOptions> = {}): ValidateOptions {
  let counter = 0;
  return {
    world,
    displays: new Map([
      [1, DISPLAY],
      [2, SECOND_DISPLAY],
    ]),
    nextId: () => `d${++counter}`,
    now: 1_000,
    ...overrides,
  };
}

const point = (x: number, y: number, frameId = 'f1') => ({ x, y, frameId });

describe('anchors', () => {
  it('maps a screenshot point onto its display', () => {
    const result = resolveAnchor(point(720, 450), world);
    if ('error' in result) throw new Error(result.error);
    expect(result.displayId).toBe(1);
    expect(result.point).toEqual({ x: 720, y: 450 });
  });

  it('gives an element anchor a box, so shapes can enclose it', () => {
    const result = resolveAnchor({ ref: 'e4', observationId: 's1' }, world);
    if ('error' in result) throw new Error(result.error);
    expect(result.point).toEqual({ x: 240, y: 312 });
    expect(result.box).toEqual({ x: 200, y: 300, width: 80, height: 24 });
  });

  it('lands on the side of an element that was asked for', () => {
    const right = resolveAnchor({ ref: 'e4', observationId: 's1', at: 'right' }, world);
    if ('error' in right) throw new Error(right.error);
    expect(right.point).toEqual({ x: 280, y: 312 });
  });

  it('applies an offset', () => {
    const nudged = resolveAnchor({ ref: 'e4', observationId: 's1', offset: { x: 10, y: -5 } }, world);
    if ('error' in nudged) throw new Error(nudged.error);
    expect(nudged.point).toEqual({ x: 250, y: 307 });
  });
  it('says what to do about a stale ref rather than drawing nothing', () => {
    const stale = resolveAnchor({ ref: 'e9', observationId: 'old' }, world);
    expect('error' in stale && stale.error).toContain('Read the window again');
  });

  it('refuses an unknown frameId', () => {
    const result = resolveAnchor(point(10, 10, 'f99'), world);
    expect('error' in result && result.error).toContain('f99');
  });

  it('tells the model there are no marks yet, instead of ignoring the anchor', () => {
    const result = resolveAnchor({ mark: 1 }, world);
    expect('error' in result && result.error).toContain('no mark 1');
  });

  it('refuses a shape whose anchors are on different screens', () => {
    const first = resolveAnchor(point(10, 10), world);
    const second = resolveAnchor(point(10, 10, 'f2'), world);
    if ('error' in first || 'error' in second) throw new Error('expected anchors');
    expect(sameDisplay([first, second])).toEqual({
      error: expect.stringContaining('cannot span two displays'),
    });
  });
});

describe('described anchors', () => {
  /** Finds "reload" and "back" in any window; each call is one window read. */
  function finder(): { describe: DescribeElements; reads: Array<{ window: unknown; wanted: readonly string[] }> } {
    const reads: Array<{ window: unknown; wanted: readonly string[] }> = [];
    const refs: Record<string, string> = { reload: 'e4', back: 'e5' };
    return {
      reads,
      describe: async (window, wanted) => {
        reads.push({ window, wanted });
        return wanted.map((w) => (refs[w] ? { observationId: 's1', ref: refs[w]! } : { error: `no ${w}` }));
      },
    };
  }

  it('binds a description to the ref it names, keeping at and offset, without touching the call', async () => {
    const { describe } = finder();
    const call = { shapes: [{ type: 'ellipse', around: { element: 'reload', at: 'right', offset: { x: 2, y: 0 } } }] };
    const bound = await bindDescribed(call, describe);
    if ('error' in bound) throw new Error(bound.error);
    expect(bound.call).toEqual({
      shapes: [{ type: 'ellipse', around: { ref: 'e4', observationId: 's1', at: 'right', offset: { x: 2, y: 0 } } }],
    });
    expect(call.shapes[0]!.around).toEqual({ element: 'reload', at: 'right', offset: { x: 2, y: 0 } });
  });

  it('reads each window once for all of its descriptions, so the first refs stay live', async () => {
    const { describe, reads } = finder();
    const bound = await bindDescribed(
      {
        shapes: [
          { type: 'arrow', from: { element: 'back' }, to: { element: 'reload' } },
          { type: 'ellipse', around: { element: 'reload', pid: 9, window_id: 3 } },
        ],
      },
      describe,
    );
    expect('error' in bound).toBe(false);
    expect(reads).toEqual([
      { window: { pid: undefined, windowId: undefined }, wanted: ['back', 'reload'] },
      { window: { pid: 9, windowId: 3 }, wanted: ['reload'] },
    ]);
  });

  it('refuses the whole call when any description is not found', async () => {
    const { describe } = finder();
    const bound = await bindDescribed({ shapes: [{ type: 'ellipse', around: { element: 'forward' } }] }, describe);
    expect(bound).toEqual({ error: 'no forward' });
  });

  it('passes a call with no descriptions straight through, and refuses one where nothing can bind it', async () => {
    const call = { shapes: [{ type: 'ellipse', around: { ref: 'e4', observationId: 's1' } }] };
    expect(await bindDescribed(call, undefined)).toEqual({ call });
    const refused = await bindDescribed({ shapes: [{ type: 'ellipse', around: { element: 'reload' } }] }, undefined);
    expect('error' in refused && refused.error).toMatch(/Anchor to a ref or to coordinates/);
  });

  // Haiku ringed "the smile of the person" by measuring {x: 617, y: 540} itself, and missed.
  it('aims a measured ring at what it says it is on, keeping the measurement as the fallback', () => {
    const call = { shapes: [{ type: 'ellipse', at: point(617, 540), radius: 55, what: "the person's smile" }] };
    const aimed = aimAtNamed(call);
    if ('error' in aimed) throw new Error(aimed.error);
    expect(aimed.call.shapes).toEqual([{ ...call.shapes[0], around: { element: "the person's smile" } }]);
    expect(aimed.fallback).toBe(call);
  });

  it('refuses a measured ring that does not say what it is on', () => {
    const aimed = aimAtNamed({ shapes: [{ type: 'ellipse', at: point(617, 540), radius: 55 }] });
    expect('error' in aimed && aimed.error).toMatch(/"what": "the person's smile"/);
  });

  it('leaves alone rings on elements and marks, and shapes that enclose nothing', () => {
    const call = {
      shapes: [
        { type: 'ellipse', around: { ref: 'e4', observationId: 's1' } },
        { type: 'rect', around: { mark: 1 } },
        { type: 'arrow', from: point(0, 0), to: point(10, 10) },
      ],
    };
    expect(aimAtNamed(call)).toEqual({ call, fallback: null });
  });

  it('never reads an unbound description as coordinates', () => {
    const result = resolveAnchor({ element: 'reload' }, world);
    expect('error' in result && result.error).toMatch(/Anchor to a ref or to coordinates/);
  });
});

describe('drawing shapes', () => {
  it('builds an arrow that stops at the element it points to', () => {
    const result = validateDraw(
      { shapes: [{ type: 'arrow', from: point(100, 312), to: { ref: 'e4', observationId: 's1' }, stroke: 'solid' }] },
      options(),
    );
    expect(result.errors).toEqual([]);
    const geometry = result.shapes[0]!.command.geometry;
    if (geometry.kind !== 'path') throw new Error('expected a path');
    // The head stops short of the element's centre at x=240.
    expect(geometry.d).not.toContain('240 312');
    expect(geometry.arrowEnd).toBe(true);
  });

  it('draws a box around an element with room to spare', () => {
    const result = validateDraw(
      { shapes: [{ type: 'rect', around: { ref: 'e4', observationId: 's1' }, padding: 6, stroke: 'solid' }] },
      options(),
    );
    const geometry = result.shapes[0]!.command.geometry;
    expect(geometry).toMatchObject({ kind: 'rect', x: 194, y: 294, width: 92, height: 36 });
  });

  it('rings a spot from a centre and a radius, the way anyone would say it', () => {
    // The commonest drawing there is. Requiring two corners for it sent the
    // model round in circles, so a centre and a size is accepted, measured
    // in the pixels of the screenshot the centre came from.
    const result = validateDraw(
      { shapes: [{ type: 'ellipse', at: point(400, 200), radius: 50, stroke: 'solid' }] },
      options(),
    );
    expect(result.errors).toEqual([]);
    expect(result.shapes[0]!.command.geometry).toMatchObject({
      kind: 'ellipse',
      cx: 400,
      cy: 200,
      rx: 50,
      ry: 50,
    });
  });

  it('scales a radius the same way it scales the position', () => {
    // A screenshot is downscaled, so a radius measured in it has to travel
    // through the same mapping as the point it is centred on.
    const half: AnchorWorld = {
      ...world,
      frame: () => ({ displayId: 1, imageWidth: 720, imageHeight: 450, bounds: DISPLAY }),
    };
    const result = validateDraw(
      { shapes: [{ type: 'ellipse', at: point(360, 225), radius: 40, stroke: 'solid' }] },
      options({ world: half }),
    );
    expect(result.shapes[0]!.command.geometry).toMatchObject({ cx: 720, cy: 450, rx: 80, ry: 80 });
  });

  it('takes rx and ry for an oval', () => {
    const result = validateDraw(
      { shapes: [{ type: 'ellipse', at: point(100, 100), rx: 60, ry: 20, stroke: 'solid' }] },
      options(),
    );
    expect(result.shapes[0]!.command.geometry).toMatchObject({ rx: 60, ry: 20 });
  });

  it('lists every way of saying where, when none was given', () => {
    const result = validateDraw({ shapes: [{ type: 'ellipse' }] }, options());
    expect(result.errors[0]).toContain('around');
    expect(result.errors[0]).toContain('from and to');
    expect(result.errors[0]).toContain('radius');
  });

  it('says to use around when a size is put on an element anchor', () => {
    const result = validateDraw(
      { shapes: [{ type: 'ellipse', at: { ref: 'e4', observationId: 's1' }, radius: 20 }] },
      options(),
    );
    expect(result.errors[0]).toContain('use around instead');
  });

  it('refuses to enclose a bare point, which has no box', () => {
    const result = validateDraw({ shapes: [{ type: 'ellipse', around: point(10, 10) }] }, options());
    expect(result.shapes).toEqual([]);
    expect(result.errors[0]).toContain('a bare point has none');
  });

  it('keeps points straight unless curving was asked for', () => {
    // Three points meant as a roof are a roof, not an arch.
    const result = validateDraw(
      {
        shapes: [
          { type: 'path', points: [point(0, 0), point(50, 80), point(100, 0)], stroke: 'solid' },
          { type: 'path', points: [point(0, 0), point(50, 80), point(100, 0)], curve: 'smooth', stroke: 'solid' },
        ],
      },
      options(),
    );
    const [straight, curved] = result.shapes.map((shape) => shape.command.geometry);
    expect((straight as { d: string }).d).not.toContain('C ');
    expect((curved as { d: string }).d).toContain('C ');
  });

  it('closes a polygon', () => {
    const result = validateDraw(
      { shapes: [{ type: 'polygon', points: [point(0, 0), point(50, 0), point(25, 40)], stroke: 'solid' }] },
      options(),
    );
    expect(result.shapes[0]!.command.geometry).toMatchObject({ closed: true });
  });

  it('numbers a step badge and refuses one without a number', () => {
    const good = validateDraw({ shapes: [{ type: 'step_badge', at: point(10, 10), number: 2 }] }, options());
    expect(good.shapes[0]!.command.geometry).toMatchObject({ kind: 'badge', number: 2 });
    const bad = validateDraw({ shapes: [{ type: 'step_badge', at: point(10, 10) }] }, options());
    expect(bad.errors[0]).toContain('number');
  });

  it('places a callout clear of its target and joins them with a leader', () => {
    const result = validateDraw(
      { shapes: [{ type: 'callout', target: { ref: 'e4', observationId: 's1' }, content: 'Click here' }] },
      options(),
    );
    const geometry = result.shapes[0]!.command.geometry;
    if (geometry.kind !== 'callout') throw new Error('expected a callout');
    expect(geometry.content).toBe('Click here');
    expect(geometry.leader.startsWith('M ')).toBe(true);
    expect(geometry.y).not.toBe(312);
  });
});

describe('refusing what it should refuse', () => {
  it('names the shape that was wrong and keeps the rest', () => {
    const result = validateDraw(
      {
        shapes: [
          { type: 'rect', around: { ref: 'e4', observationId: 's1' } },
          { type: 'nonsense' },
          { type: 'line', points: [point(0, 0), point(10, 10)] },
        ],
      },
      options(),
    );
    expect(result.shapes).toHaveLength(2);
    expect(result.errors[0]).toContain('shape 2');
  });

  it('rejects an unknown style value rather than guessing', () => {
    const result = validateDraw(
      { shapes: [{ type: 'line', points: [point(0, 0), point(9, 9)], color: 'chartreuse' }] },
      options(),
    );
    expect(result.errors[0]).toContain('color must be one of');
  });

  it('holds a shape to its point limit', () => {
    const many = Array.from({ length: MAX_POINTS_PER_SHAPE + 1 }, (_, i) => point(i, i));
    const result = validateDraw({ shapes: [{ type: 'path', points: many }] }, options());
    expect(result.errors[0]).toContain(`${MAX_POINTS_PER_SHAPE}-point limit`);
  });

  it('holds a whole call to its point limit', () => {
    const shape = { type: 'path', points: Array.from({ length: 500 }, (_, i) => point(i, i)) };
    const result = validateDraw({ shapes: Array.from({ length: 6 }, () => shape) }, options());
    expect(result.errors.some((error) => error.includes('2000-point limit'))).toBe(true);
  });

  it('asks for shapes when there are none', () => {
    expect(validateDraw({}, options()).errors[0]).toContain('needs shapes');
    expect(validateDraw({ shapes: [] }, options()).errors[0]).toContain('needs shapes');
  });

  it('refuses a bend outside its range', () => {
    const result = validateDraw(
      { shapes: [{ type: 'arrow', from: point(0, 0), to: point(50, 0), bend: 4 }] },
      options(),
    );
    expect(result.errors[0]).toContain('between -1 and 1');
  });

  it('trims a label to its limit instead of dropping the shape', () => {
    const result = validateDraw(
      { shapes: [{ type: 'line', points: [point(0, 0), point(9, 9)], label: 'x'.repeat(300) }] },
      options(),
    );
    expect(result.shapes[0]!.command.label?.text).toHaveLength(80);
  });
});

describe('lifetimes and ids', () => {
  it('fades after five seconds, or five minutes when told to persist', () => {
    const result = validateDraw(
      {
        shapes: [
          { type: 'line', points: [point(0, 0), point(1, 1)] },
          { type: 'line', points: [point(0, 0), point(2, 2)], persist: true },
        ],
      },
      options({ now: 0 }),
    );
    expect(result.shapes[0]!.command.expiresAt).toBe(5_000);
    expect(result.shapes[1]!.command.expiresAt).toBe(300_000);
  });

  it('keeps the id the model chose, so it can come back to the shape', () => {
    const result = validateDraw(
      { shapes: [{ type: 'line', points: [point(0, 0), point(1, 1)], id: 'the-button' }] },
      options(),
    );
    expect(result.shapes[0]!.command.id).toBe('the-button');
  });
});

describe('what is on screen', () => {
  const shape = (id: string) => ({
    command: {
      id,
      geometry: { kind: 'rect' as const, x: 0, y: 0, width: 10, height: 10, radius: 0 },
      color: 'accent' as const,
      stroke: 'solid' as const,
      width: 'medium' as const,
      fill: 'none' as const,
      animate: 'none' as const,
      expiresAt: 10_000,
    },
    call: {},
  });

  it('replaces a shape that reuses an id, rather than stacking them up', () => {
    const store = new DrawingStore();
    store.add(1, [shape('a')]);
    store.add(1, [shape('a')]);
    expect(store.on(1)).toHaveLength(1);
  });

  it('drops the oldest past the per-display ceiling', () => {
    const store = new DrawingStore();
    for (let i = 0; i < MAX_VISIBLE_SHAPES + 5; i++) store.add(1, [shape(`s${i}`)]);
    const ids = store.on(1).map((command) => command.id);
    expect(ids).toHaveLength(MAX_VISIBLE_SHAPES);
    expect(ids).not.toContain('s0');
    expect(ids).toContain(`s${MAX_VISIBLE_SHAPES + 4}`);
  });

  it('finds a shape with the call that drew it, so an update can be revalidated', () => {
    const store = new DrawingStore();
    store.add(3, [{ ...shape('a'), call: { type: 'rect', padding: 4 } }]);
    expect(store.find('a')).toMatchObject({ displayId: 3, shape: { call: { padding: 4 } } });
    expect(store.find('nope')).toBeNull();
  });

  it('erases by id and reports which displays changed', () => {
    const store = new DrawingStore();
    store.add(1, [shape('a')]);
    store.add(2, [shape('b')]);
    expect(store.erase(['b'])).toEqual([2]);
    expect(store.on(2)).toEqual([]);
    expect(store.on(1)).toHaveLength(1);
  });

  it('expires only what is past its time', () => {
    const store = new DrawingStore();
    store.add(1, [shape('a'), { ...shape('b'), command: { ...shape('b').command, expiresAt: 50_000 } }]);
    expect(store.expire(20_000)).toEqual([1]);
    expect(store.on(1).map((command) => command.id)).toEqual(['b']);
    // Nothing left to expire, so no display needs redrawing.
    expect(store.expire(20_000)).toEqual([]);
  });
});

describe('collapseRepeatedMarkPointers', () => {
  const shape = (call: Record<string, unknown>) => ({ call });

  it('keeps the first pointer per mark and drops the rest', () => {
    const spotlight = shape({ type: 'spotlight', around: { mark: 1 } });
    const label = shape({ type: 'callout', target: { mark: 1 }, content: 'Send' });
    const again = shape({ type: 'text', at: { mark: 1 }, content: 'Send' });
    const arrow = shape({ type: 'arrow', from: { mark: 1 }, to: { mark: 2 } });

    const result = collapseRepeatedMarkPointers([spotlight, label, again, arrow]);

    expect(result.dropped).toBe(2);
    expect(result.shapes).toEqual([spotlight, arrow]);
  });

  it('leaves shapes that are not restating the same mark', () => {
    const a = shape({ type: 'ellipse', around: { mark: 1 } });
    const b = shape({ type: 'rect', around: { mark: 2 } });
    const result = collapseRepeatedMarkPointers([a, b]);
    expect(result.dropped).toBe(0);
    expect(result.shapes).toEqual([a, b]);
  });
});
