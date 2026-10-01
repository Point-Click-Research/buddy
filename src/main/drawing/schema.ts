// The draw, update_drawing and erase tool definitions.
//
// One tool draws a whole explanation, because an explanation is usually
// several shapes that belong together — circle this, arrow to that, number
// the steps. The model never sends SVG or code: only these fields.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { ANCHOR_POINTS, ANIMATIONS, COLORS, FILLS, SIZES, STROKES, WIDTHS } from '../../shared/drawing';
import { MAX_LABEL } from './types';

const ANCHOR_DESCRIPTION =
  'Where this goes. One of: {"x": number, "y": number, "frameId": "f7"} — a point in the ' +
  'screenshot you measured, and you must name the frame; {"ref": "e4", "observationId": "s0000001a", ' +
  `"at": one of ${ANCHOR_POINTS.join('|')}, "offset": {"x","y"}} — a place on an element you read; ` +
  'or {"mark": 1} — one of the user\'s own marks.';

const DESCRIBED_ANCHOR =
  ' Or {"element": "the Reload button", "at", "offset"} — anything named in words: a control, a ' +
  'file or icon by its label, or a thing in a picture ("the grey rock at the bottom left"). It is ' +
  'found in the front window (add "pid" and "window_id" from list_windows for another), by its ' +
  'label, or in the picture, and lands exactly, with no read_window call first. Prefer it to coordinates.';

const SHARED = {
  id: { type: 'string', description: 'Your name for this shape, so you can update or erase it later.' },
  color: { type: 'string', enum: [...COLORS], description: 'Palette name. Default accent.' },
  stroke: {
    type: 'string',
    enum: [...STROKES],
    description:
      'Line style. Buddy draws hand-sketched by default; use solid for a clean line. ' +
      'highlighter is wide and translucent.',
  },
  width: { type: 'string', enum: [...WIDTHS] },
  fill: { type: 'string', enum: [...FILLS], description: 'soft adds a translucent fill of the same colour.' },
  animate: {
    type: 'string',
    enum: [...ANIMATIONS],
    description: 'How it appears. draw_on traces the stroke along its path; the default.',
  },
  label: {
    type: 'string',
    description:
      `Rarely needed: a few words (max ${MAX_LABEL} chars) for information the drawing cannot ` +
      'carry, like a value or a name. Most shapes need no label.',
  },
  show_at: {
    type: 'string',
    description: 'Keep hidden until your spoken reply reaches the marker [[name]]. Use the same name here.',
  },
  persist: { type: 'boolean', description: 'Keep until erased rather than fading after 5 seconds.' },
} as const;

const SHAPE_TYPES = {
  path:
    'A line through every point, straight between them unless you set curve: smooth | smooth_closed. ' +
    'Takes points and arrowhead.',
  line: 'A straight line between two points. Takes points.',
  polyline: 'Straight segments through several points. Takes points.',
  polygon: 'A closed shape through several points. Takes points.',
  arrow: 'An arrow from one place to another. Takes from, to, bend (-1 to 1) and arrowhead.',
  rect:
    'A rectangle. Say where three ways: around an element, or from and to as opposite corners, ' +
    'or at plus rx and ry. Takes padding and corner_radius.',
  ellipse:
    'An ellipse or circle — the usual way to ring something. Say where three ways: around an ' +
    'element (best, it follows the real control), or from and to as opposite corners, or at plus ' +
    'radius. Takes padding and rotation.',
  text: 'Words on screen. Takes at, content and size.',
  callout: 'A label bubble with a curved leader line. Takes target, content and placement.',
  step_badge: 'A numbered circle for multi-step instructions. Takes at and number.',
  connector:
    'Like arrow, but it routes around the two things it joins instead of straight through them. ' +
    'Takes from and to.',
  freehand: 'A natural pen stroke through points, thick in the middle like ink. Takes points.',
  svg_path:
    'A path you write yourself, for a shape none of the others make. Takes d (only M L H V C S Q T A Z, ' +
    'numbers only, 300 commands max) and frameId — the screenshot its coordinates are measured in.',
  arc: 'Part of a circle. Takes the box (around / from+to / at+radius), start_angle, end_angle in degrees (0 is right, clockwise), and arrowhead.',
  regular_polygon: 'A triangle, pentagon, hexagon and so on. Takes the box, sides (3 to 12) and rotation.',
  angle: 'The angle at vertex between a and b, with its measuring arc. show_degrees: true labels the measurement.',
  dimension: 'An engineering measurement line with ticks at both ends. Takes from, to and label.',
  bracket: 'A bracket down one side of something. Takes the box, side and style (square | curly).',
  underline: 'A line under something. Takes the box and style (straight | wavy).',
  strike: 'A line through something. Takes the box and style (straight | wavy).',
  grid: 'Graph paper over a region. Takes the box and spacing in points.',
  axes: 'x and y axes across a region, with ticks. Takes the box and ticks.',
  plot:
    'A function of x drawn inside a region. Takes the box, expression (e.g. "sin(x) * x^2"), x_range, ' +
    'y_range as [low, high], and samples. It breaks at asymptotes instead of drawing through them.',
  spotlight: 'Dim everything except one thing. Takes the box and feather.',
} as const;

const WHAT = {
  type: 'string',
  description:
    'What an ellipse, rect or spotlight is on, in words: "the person\'s smile", "the grey rock". ' +
    'Required when you place one by coordinates: Buddy finds that thing and fits the shape to it.',
} as const;

/**
 * One shape's fields. The anchor spec is stated once, in the draw tool's
 * description: repeated on each of the nine anchor fields it was a third of
 * the schema, and the schema is sent with every turn.
 */
function shapeSchema(describes: boolean) {
  const anchor = { type: 'object', description: 'An anchor; see the tool description.' } as const;
  return {
    type: 'object',
    properties: {
      type: { type: 'string', enum: Object.keys(SHAPE_TYPES) },
      points: { type: 'array', items: anchor, description: 'Anchors, for path, line, polyline and polygon.' },
      from: anchor,
      to: anchor,
      at: anchor,
      target: anchor,
      around: { ...anchor, description: 'The element or mark to enclose: an anchor.' },
      radius: {
        type: 'number',
        description: 'Half the width of a circle around at, in the pixels of the screenshot at was measured in.',
      },
      rx: { type: 'number', description: 'Half-width, in that screenshot\'s pixels.' },
      ry: { type: 'number', description: 'Half-height, in that screenshot\'s pixels.' },
      curve: { type: 'string', enum: ['straight', 'smooth', 'smooth_closed'] },
      arrowhead: { type: 'string', enum: ['none', 'start', 'end', 'both'] },
      bend: { type: 'number', description: 'Sideways bow, -1 to 1. Use it when a straight line would cross content.' },
      padding: { type: 'number', description: 'Extra room around the thing enclosed, in points.' },
      corner_radius: { type: 'number' },
      rotation: { type: 'number', description: 'Degrees.' },
      content: { type: 'string', description: `The words, for text and callout (max ${MAX_LABEL} chars).` },
      size: { type: 'string', enum: [...SIZES] },
      placement: { type: 'string', enum: ['auto', 'above', 'below', 'left', 'right'] },
      number: { type: 'integer', description: 'The step number, for step_badge.' },
      vertex: anchor,
      a: anchor,
      b: anchor,
      show_degrees: { type: 'boolean', description: 'Label an angle with its measurement.' },
      d: { type: 'string', description: 'The path, for svg_path. Only M L H V C S Q T A Z, numbers only.' },
      frameId: { type: 'string', description: 'The screenshot an svg_path\'s coordinates were measured in.' },
      start_angle: { type: 'number', description: 'Degrees; 0 is to the right and angles run clockwise.' },
      end_angle: { type: 'number' },
      sides: { type: 'integer', description: '3 to 12, for regular_polygon.' },
      side: { type: 'string', enum: ['left', 'right', 'top', 'bottom'], description: 'Which side, for bracket.' },
      style: {
        type: 'string',
        enum: ['square', 'curly', 'straight', 'wavy'],
        description: 'square | curly for bracket; straight | wavy for underline and strike.',
      },
      spacing: { type: 'number', description: 'Points between grid lines.' },
      ticks: { type: 'integer', description: 'Tick marks per axis, 2 to 20.' },
      expression: { type: 'string', description: 'A formula in x, for plot. Standard maths functions, pi and e.' },
      x_range: { type: 'array', items: { type: 'number' }, description: '[low, high] for plot.' },
      y_range: { type: 'array', items: { type: 'number' }, description: '[low, high] for plot.' },
      samples: { type: 'integer', description: 'Points to sample for plot, up to 400.' },
      feather: { type: 'number', description: 'How far a spotlight\'s edge fades, in points.' },
      ...(describes ? { what: WHAT } : {}),
      ...SHARED,
    },
    required: ['type'],
  } as const;
}

export function drawingTools(describes = false): Tool[] {
  const shape = shapeSchema(describes);
  const shapeList = Object.entries(SHAPE_TYPES)
    .map(([name, description]) => `- ${name}: ${description}`)
    .join('\n');
  const where = describes ? ANCHOR_DESCRIPTION + DESCRIBED_ANCHOR : ANCHOR_DESCRIPTION;

  return [
    {
      name: 'draw',
      description:
        'Draw on the user\'s screen. One call can hold a whole explanation; the shapes appear ' +
        'together. Do not use it to label, ring, or spotlight something the user already marked. ' +
        'Set replace: true to clear your previous drawings first.\nShapes:\n' +
        shapeList +
        `\nAnchors (points, from, to, at, target, around, vertex, a, b): ${where}`,
      input_schema: {
        type: 'object',
        properties: {
          shapes: { type: 'array', items: shape },
          replace: { type: 'boolean', description: 'Clear your current drawings before adding these.' },
        },
        required: ['shapes'],
      },
    },
    {
      name: 'update_drawing',
      description:
        'Change a shape already on screen by its id — move it, restyle it, relabel it, animate it ' +
        'again. Use this to shift attention instead of redrawing everything.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          changes: {
            type: 'object',
            description:
              "The fields to change, named as in draw's shapes: the shared ones (color, stroke, width, " +
              'fill, animate, label, show_at, persist) and the position fields for its type.',
          },
        },
        required: ['id', 'changes'],
      },
    },
    {
      name: 'erase',
      description: 'Remove drawings that are no longer relevant.',
      input_schema: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
          all: { type: 'boolean', description: 'Erase everything you have drawn.' },
        },
      },
    },
  ] as Tool[];
}
