// Turning one draw call into commands the renderer can draw.
//
// This is the boundary. Everything past it is numbers and a closed set of
// primitives; nothing the model wrote reaches the renderer as markup. A bad
// call comes back as a precise sentence the model can act on, rather than a
// silently dropped shape.
//
// The shapes themselves live in ./builders; this file owns what they have in
// common — style, labels, lifetime, ids, and the limits on one call.
//
// Pure module: the world (frames, elements, marks) is injected.

import {
  ANIMATIONS,
  COLORS,
  FILLS,
  STROKES,
  WIDTHS,
  type Animation,
  type Color,
  type DrawCommand,
  type Fill,
  type Stroke,
  type Width,
} from '../../shared/drawing';
import type { Rect } from '../coords';
import type { AnchorWorld } from './anchors';
import { BASIC_BUILDERS } from './builders/basic';
import { CHART_BUILDERS } from './builders/chart';
import { FREEFORM_BUILDERS } from './builders/freeform';
import { GEOMETRY_BUILDERS } from './builders/geometry';
import type { BuildContext, ShapeBuilder } from './build';
import { text } from './read';
import { penDrawn } from './pen';
import {
  DEFAULT_LIFETIME_MS,
  MAX_LABEL,
  MAX_LIFETIME_MS,
  MAX_POINTS_PER_CALL,
  type StoredShape,
} from './types';

/** Every shape Buddy can draw, by name. */
const BUILDERS: Record<string, ShapeBuilder> = {
  ...BASIC_BUILDERS,
  ...GEOMETRY_BUILDERS,
  ...FREEFORM_BUILDERS,
  ...CHART_BUILDERS,
};

const SHAPE_NAMES = Object.keys(BUILDERS).sort();

interface ValidatedShape extends StoredShape {
  displayId: number;
}

export interface DrawInput {
  shapes?: unknown;
  replace?: unknown;
}

export interface ValidationResult {
  shapes: ValidatedShape[];
  /** One sentence per rejected shape, naming its index. */
  errors: string[];
  replace: boolean;
}

export interface ValidateOptions {
  world: AnchorWorld;
  /** Display bounds by id, for clamping and padding. */
  displays: ReadonlyMap<number, Rect>;
  /** Makes an id for a shape that didn't name one. */
  nextId(): string;
  now: number;
}

export function validateDraw(input: DrawInput, options: ValidateOptions): ValidationResult {
  const list = Array.isArray(input.shapes) ? input.shapes : null;
  if (!list || list.length === 0) {
    return { shapes: [], errors: ['draw needs shapes: a list of at least one shape.'], replace: false };
  }

  const context: BuildContext = { world: options.world, displays: options.displays };
  const shapes: ValidatedShape[] = [];
  const errors: string[] = [];
  let points = 0;

  for (const [index, raw] of list.entries()) {
    const result = oneShape(raw, context, options);
    if ('error' in result) {
      errors.push(`shape ${index + 1}: ${result.error}`);
      continue;
    }
    points += result.points;
    if (points > MAX_POINTS_PER_CALL) {
      errors.push(`shape ${index + 1}: this call is over the ${MAX_POINTS_PER_CALL}-point limit.`);
      break;
    }
    shapes.push({
      displayId: result.displayId,
      command: result.command,
      call: raw as Record<string, unknown>,
    });
  }

  return { shapes, errors, replace: input.replace === true };
}

/**
 * Several pointer shapes on one user mark are the same point drawn twice
 * (two labels and a spotlight was a real answer). Keep the first.
 */
const MARK_POINTER_TYPES = new Set(['spotlight', 'callout', 'text', 'ellipse', 'rect']);

export function collapseRepeatedMarkPointers<T extends { call: Record<string, unknown> }>(
  shapes: readonly T[],
): { shapes: T[]; dropped: number } {
  const seen = new Set<number>();
  const kept: T[] = [];
  let dropped = 0;

  for (const shape of shapes) {
    const mark = pointerMark(shape.call);
    if (mark === null) {
      kept.push(shape);
      continue;
    }
    if (seen.has(mark)) {
      dropped++;
      continue;
    }
    seen.add(mark);
    kept.push(shape);
  }

  return { shapes: kept, dropped };
}

function pointerMark(call: Record<string, unknown>): number | null {
  const type = call['type'];
  if (typeof type !== 'string' || !MARK_POINTER_TYPES.has(type)) return null;
  return (
    markNumber(call['around']) ??
    markNumber(call['at']) ??
    markNumber(call['target']) ??
    sameMark(call['from'], call['to'])
  );
}

function markNumber(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const mark = (value as Record<string, unknown>)['mark'];
  const number = typeof mark === 'number' ? mark : typeof mark === 'string' ? Number(mark) : NaN;
  return Number.isInteger(number) && number > 0 ? number : null;
}

/** A box drawn from a mark to itself is still that mark. */
function sameMark(from: unknown, to: unknown): number | null {
  const start = markNumber(from);
  return start !== null && start === markNumber(to) ? start : null;
}

type ShapeResult = { displayId: number; command: DrawCommand; points: number } | { error: string };

function oneShape(raw: unknown, context: BuildContext, options: ValidateOptions): ShapeResult {
  if (typeof raw !== 'object' || raw === null) return { error: 'a shape must be an object.' };
  const shape = raw as Record<string, unknown>;

  const type = text(shape['type'], 40);
  const builder = BUILDERS[type];
  if (!builder) return { error: `type must be one of: ${SHAPE_NAMES.join(', ')}.` };

  const style = readStyle(shape, type);
  if ('error' in style) return { error: style.error };

  const built = builder(shape, context);
  if ('error' in built) return { error: built.error };

  const id = text(shape['id'], 60) || options.nextId();
  // `sketch` is a stroke style rather than a shape, so it redraws whatever
  // outline the builder produced with the pen. The shape's id seeds it, so the
  // same shape always comes out the same way instead of jittering on every
  // redraw. Ink is an outline with no inside, so a soft fill keeps the plain shape.
  const penned = style.style.stroke === 'sketch' && style.style.fill !== 'soft';
  const geometry = penned ? penDrawn(built.geometry, style.style.width, id) : built.geometry;

  const label = text(shape['label'], MAX_LABEL) || built.labelText || '';
  const showAt = text(shape['show_at'], 40);
  const lifetime = shape['persist'] === true ? MAX_LIFETIME_MS : DEFAULT_LIFETIME_MS;

  return {
    displayId: built.displayId,
    points: built.points,
    command: {
      id,
      geometry,
      ...style.style,
      ...(label ? { label: { text: label, x: built.labelAt.x, y: built.labelAt.y } } : {}),
      ...(showAt ? { showAt } : {}),
      expiresAt: options.now + lifetime,
    },
  };
}

interface Style {
  color: Color;
  stroke: Stroke;
  width: Width;
  fill: Fill;
  animate: Animation;
}

/**
 * Shapes whose whole point is precision. A wobbly ring has charm; a wobbly
 * measurement or plotted curve is misinformation.
 */
const PRECISE_SHAPES = new Set(['plot', 'grid', 'axes', 'dimension', 'angle']);

function readStyle(
  shape: Record<string, unknown>,
  type: string,
): { style: Style } | { error: string } {
  const fields = [
    ['color', shape['color'], COLORS, 'accent'],
    // Buddy draws by hand unless the shape is a measurement or the model
    // asks for a clean line.
    ['stroke', shape['stroke'], STROKES, PRECISE_SHAPES.has(type) ? 'solid' : 'sketch'],
    ['width', shape['width'], WIDTHS, 'medium'],
    ['fill', shape['fill'], FILLS, 'none'],
    ['animate', shape['animate'], ANIMATIONS, 'draw_on'],
  ] as const;

  const chosen: Record<string, string> = {};
  for (const [name, value, allowed, fallback] of fields) {
    if (value === undefined) {
      chosen[name] = fallback;
      continue;
    }
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      return { error: `${name} must be one of: ${allowed.join(', ')}.` };
    }
    chosen[name] = value;
  }
  return { style: chosen as unknown as Style };
}
