// The drawing wire format, shared by the main process and the overlay.
//
// The model sends structured JSON; the main process validates it and emits
// these commands, which are plain geometry in overlay-local DIP with every
// path already computed. The renderer draws commands and nothing else, so
// nothing the model wrote is ever interpreted as markup or code.

/** Palette names only; the overlay maps them to theme-aware colours. */
export const COLORS = [
  'accent',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'white',
  'black',
] as const;
export type Color = (typeof COLORS)[number];

export const STROKES = ['solid', 'dashed', 'dotted', 'highlighter', 'sketch'] as const;
export type Stroke = (typeof STROKES)[number];

export const WIDTHS = ['thin', 'medium', 'thick'] as const;
export type Width = (typeof WIDTHS)[number];

export const FILLS = ['none', 'soft'] as const;
export type Fill = (typeof FILLS)[number];

export const ANIMATIONS = ['none', 'draw_on', 'fade', 'pulse'] as const;
export type Animation = (typeof ANIMATIONS)[number];

export const SIZES = ['small', 'medium', 'large'] as const;
export type Size = (typeof SIZES)[number];

/** Where on an element's box an anchor lands. */
export const ANCHOR_POINTS = [
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'top_left',
  'top_right',
  'bottom_left',
  'bottom_right',
] as const;
export type AnchorPoint = (typeof ANCHOR_POINTS)[number];

export interface Point {
  x: number;
  y: number;
}

/**
 * The closed set of primitives the overlay can draw. Most shapes arrive as a
 * path whose `d` the main process built, which keeps the renderer small and
 * keeps path syntax out of the model's hands.
 */
export type Geometry =
  | { kind: 'path'; d: string; arrowStart: boolean; arrowEnd: boolean; closed: boolean }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; radius: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotation: number }
  | { kind: 'text'; x: number; y: number; content: string; size: Size }
  | { kind: 'badge'; x: number; y: number; number: number }
  | { kind: 'callout'; x: number; y: number; content: string; leader: string }
  /**
   * A pen stroke: an outline filled with the colour, not stroked. `center`
   * is the line the pen travelled and `reveal` its thickness, so the stroke
   * can draw itself on by unmasking along that line.
   */
  | { kind: 'ink'; d: string; center: string; reveal: number }
  /**
   * Dim the display and leave a soft-edged hole. `feather` is how far the
   * edge fades, so the hole reads as a spotlight rather than a cut-out.
   */
  | { kind: 'spotlight'; hole: { x: number; y: number; width: number; height: number }; feather: number };

export interface DrawCommand {
  id: string;
  geometry: Geometry;
  color: Color;
  stroke: Stroke;
  width: Width;
  fill: Fill;
  animate: Animation;
  /** Text and where it wants to sit; the overlay nudges it clear of others. */
  label?: { text: string; x: number; y: number };
  /** Hidden until the spoken reply reaches this marker (Milestone 9c). */
  showAt?: string;
  /** When this drawing fades on its own, as an epoch-ms deadline. */
  expiresAt: number;
}

/**
 * Everything one overlay should be showing. `offset` corrects for macOS
 * occasionally parking the overlay window slightly off its display; the
 * overlay applies it once as a transform.
 */
export interface DrawingsPayload {
  commands: DrawCommand[];
  offset: Point;
}

/** Shapes waiting on show_at markers that may appear now. */
export interface DrawingReveal {
  names: string[];
  /** The response is over: everything still hidden appears. */
  all?: boolean;
}
