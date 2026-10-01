// The drawing gallery: every shape, stroke style and animation on the
// current display, drawn through the exact path the model's calls take.
//
// This is a dev tool for eyes, not tests: geometry has unit tests, but
// whether a curly bracket looks like a curly bracket is something only a
// person can say. It also proves the element pipeline end to end by ringing
// a real element of the frontmost window, when one can be read.

import { screen } from 'electron';
import { observeForGuide } from '../computer/observer';
import { createLogger } from '../log';
import type { AnchorWorld } from './anchors';
import { guideElementBox } from '../computer/observer';
import { presentShapes } from './tools';
import { validateDraw } from './validate';

const log = createLogger('gallery');

/** The gallery draws in display points directly, via its own frame. */
const FRAME = 'gallery';

/** One row of the gallery grid. */
function row(index: number): number {
  return 70 + index * 120;
}

function shapes(width: number): Array<Record<string, unknown>> {
  const at = (x: number, y: number): Record<string, unknown> => ({ x, y, frameId: FRAME });
  const columns = [60, 260, 460, 660, 860, 1060].filter((x) => x < width - 140);
  const [a = 60, b = 260, c = 460, d = 660, e = 860, f = 1060] = columns;

  return [
    // Row 0: strokes and colours on the plainest shape.
    { type: 'line', points: [at(a, row(0)), at(a + 140, row(0))], stroke: 'solid', label: 'solid' },
    { type: 'line', points: [at(b, row(0)), at(b + 140, row(0))], stroke: 'dashed', color: 'blue', label: 'dashed' },
    { type: 'line', points: [at(c, row(0)), at(c + 140, row(0))], stroke: 'dotted', color: 'green', label: 'dotted' },
    { type: 'line', points: [at(d, row(0)), at(d + 140, row(0))], stroke: 'highlighter', color: 'yellow', label: 'highlighter' },
    { type: 'line', points: [at(e, row(0)), at(e + 140, row(0))], label: 'sketch (default)' },
    { type: 'freehand', points: [at(f, row(0) - 20), at(f + 50, row(0) + 20), at(f + 100, row(0) - 10), at(f + 140, row(0) + 10)], color: 'purple' },

    // Row 1: the enclosures.
    { type: 'rect', from: at(a, row(1) - 35), to: at(a + 140, row(1) + 35), color: 'red' },
    { type: 'ellipse', at: at(b + 70, row(1)), rx: 70, ry: 35, color: 'orange' },
    { type: 'regular_polygon', at: at(c + 70, row(1)), radius: 40, sides: 6, color: 'blue' },
    { type: 'arc', at: at(d + 70, row(1)), radius: 40, start_angle: 180, end_angle: 340, arrowhead: 'end', color: 'green' },
    { type: 'polygon', points: [at(e + 20, row(1) + 30), at(e + 70, row(1) - 35), at(e + 120, row(1) + 30)], fill: 'soft', color: 'purple' },
    { type: 'spotlight', from: at(f, row(1) - 35), to: at(f + 140, row(1) + 35) },

    // Row 2: arrows, connectors and annotations.
    { type: 'arrow', from: at(a, row(2)), to: at(a + 140, row(2) - 20), bend: 0.4, color: 'accent' },
    { type: 'dimension', from: at(b, row(2)), to: at(b + 140, row(2)), label: '140 pt' },
    { type: 'bracket', from: at(c, row(2) - 35), to: at(c + 60, row(2) + 35), side: 'left', style: 'curly', color: 'orange' },
    { type: 'angle', vertex: at(d + 20, row(2) + 25), a: at(d + 140, row(2) + 25), b: at(d + 60, row(2) - 40), show_degrees: true, color: 'blue' },
    { type: 'callout', target: at(e + 40, row(2)), content: 'a callout', placement: 'right' },
    { type: 'step_badge', at: at(f + 20, row(2)), number: 3, color: 'green' },

    // Row 3: text decoration and charts.
    { type: 'text', at: at(a + 40, row(3)), content: 'plain text', size: 'medium' },
    { type: 'underline', from: at(b, row(3) - 12), to: at(b + 120, row(3) + 8), style: 'wavy', color: 'red' },
    { type: 'strike', from: at(c, row(3) - 12), to: at(c + 120, row(3) + 8), color: 'red' },
    { type: 'grid', from: at(d, row(3) - 40), to: at(d + 140, row(3) + 40), spacing: 20, color: 'white', width: 'thin' },
    { type: 'axes', from: at(e, row(3) - 40), to: at(e + 140, row(3) + 40), ticks: 4 },
    { type: 'plot', from: at(f, row(3) - 40), to: at(f + 140, row(3) + 40), expression: 'sin(x) * x', x_range: [-6, 6], y_range: [-5, 5], color: 'green' },

    // Row 4: motion and a path the model might write itself.
    { type: 'ellipse', at: at(a + 70, row(4)), radius: 30, animate: 'pulse', color: 'red', label: 'pulse' },
    { type: 'svg_path', d: `M 0 0 C 40 -60 100 -60 140 0 S 240 60 280 0`, frameId: FRAME, id: 'gallery-svg-path', color: 'blue' },
  ].map((shape, index) => ({ id: `gallery-${index}`, ...shape }));
}

/** Draw the gallery on the display the cursor is on. */
export async function showDrawingGallery(): Promise<void> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

  const world: AnchorWorld = {
    // The gallery's own frame: display points, one to one.
    frame: (frameId) =>
      frameId === FRAME
        ? {
            displayId: display.id,
            imageWidth: display.bounds.width,
            imageHeight: display.bounds.height,
            bounds: display.bounds,
          }
        : null,
    element: (observationId, ref) => {
      const found = guideElementBox(observationId, ref);
      return found ? { ...found, display: display.bounds } : null;
    },
    mark: () => null,
  };

  const result = validateDraw(
    { shapes: shapes(display.bounds.width) },
    {
      world,
      displays: new Map([[display.id, display.bounds]]),
      nextId: () => `gallery-extra-${Math.random().toString(36).slice(2, 8)}`,
      now: Date.now(),
    },
  );
  for (const error of result.errors) log.warn(`gallery shape rejected: ${error}`);
  // Through the production store, so the gallery expires and dismisses like
  // anything the model draws.
  presentShapes(display.id, result.shapes.filter((shape) => shape.displayId === display.id));

  // The element pipeline, end to end: ring something real in the front
  // window. Skipped without fuss when nothing can be read.
  try {
    const outcome = await observeForGuide('get_window_state', {}, display.id);
    const observation = outcome.observation;
    if (observation?.kind === 'window') {
      const ref = /^(e\d+) \|/m.exec(observation.tree.split('\n')[1] ?? '')?.[1] ?? 'e1';
      const ringed = validateDraw(
        {
          shapes: [
            {
              id: 'gallery-element',
              type: 'ellipse',
              around: { ref, observationId: observation.observationId },
              color: 'green',
              label: `element ${ref}`,
            },
          ],
        },
        {
          world,
          displays: new Map([[display.id, display.bounds]]),
          nextId: () => 'gallery-element',
          now: Date.now(),
        },
      );
      presentShapes(display.id, ringed.shapes);
    }
  } catch (error) {
    log.warn(`gallery element example skipped: ${error instanceof Error ? error.message : error}`);
  }

  log.info('gallery drawn');
}
