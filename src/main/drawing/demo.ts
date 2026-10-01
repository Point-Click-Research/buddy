// The walk's drawing step: Buddy picks something real on screen, rings it,
// and names it, with nothing asked of the user. The element comes from the
// window reader, so the ring sits on the box macOS reports rather than on a
// guess measured from a downscaled screenshot.

import { screen } from 'electron';
import { guideElementBox, listGuideWindows, rereadWindow } from '../computer/observer';
import { inView, visibleBounds, windowBounds, type RefRow } from '../computer/tree';
import type { WindowRecord } from '../computer/window-list';
import type { Point, Rect } from '../coords';
import { createLogger } from '../log';
import { homeWindowBounds } from '../windows';
import { presentShapes } from './tools';
import { validateDraw } from './validate';
import { errorMessage } from '../../shared/errors';

const log = createLogger('drawing-demo');

/** The roles worth ringing, and what Buddy calls each out loud. */
const ROLE_WORDS: Record<string, string> = {
  button: 'button',
  link: 'link',
  tab: 'tab',
  checkbox: 'checkbox',
  radiobutton: 'option',
  popupbutton: 'menu',
  menubutton: 'menu',
  searchfield: 'search field',
  textfield: 'text field',
};

/** Other apps' windows read before falling back to Buddy's own: each read walks a whole tree. */
const MAX_READS = 3;
const MAX_NAME = 40;

function contains(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height;
}

function sameRect(a: Rect, b: Rect): boolean {
  return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 && Math.abs(a.width - b.width) < 2;
}

/** Named, control-sized elements whose middle nothing in front of them covers. */
function candidates(rows: readonly RefRow[], covering: readonly Rect[]): RefRow[] {
  const view = windowBounds(rows);
  return rows.filter((row) => {
    const box = visibleBounds(row);
    if (!ROLE_WORDS[row.role] || !row.name || row.name.length > MAX_NAME || !box) return false;
    if (box.w < 12 || box.h < 12 || box.w > 480 || box.h > 160 || !inView(box, view)) return false;
    const middle = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    return !covering.some((rect) => contains(rect, middle));
  });
}

/** The ref a ring around a whole window (no element read) anchors to. */
const WINDOW_REF = { ref: 'window', observationId: 'walk' };

/**
 * Ring one element (`around` names it) or, with `box`, a whole window, on the
 * display it sits on. False when the ring could not be built or is no longer wanted.
 */
function ring(around: { ref: unknown; observationId: unknown }, label: string | undefined, wanted: () => boolean, box?: Rect): boolean {
  const displays = new Map(screen.getAllDisplays().map((display) => [display.id, display.bounds]));
  const result = validateDraw(
    { shapes: [{ type: 'ellipse', around, padding: box ? 16 : 8, label }] },
    {
      world: {
        frame: () => null,
        element: (observationId, ref) => {
          const found = box
            ? { displayId: screen.getDisplayMatching(box).id, rect: box }
            : guideElementBox(observationId, ref);
          const bounds = found && displays.get(found.displayId);
          return found && bounds ? { ...found, display: bounds } : null;
        },
        mark: () => null,
      },
      displays,
      nextId: () => 'walk-drawing',
      now: Date.now(),
    },
  );
  const shape = result.shapes[0];
  if (!shape || !wanted()) return false;
  presentShapes(shape.displayId, [shape]);
  return true;
}

/**
 * Ring one thing on screen and return how to say it (`the "Reload" button in
 * Safari`). Another app's window is preferred, front first; an element in
 * Buddy's own window comes next, and the chat window itself is the last
 * resort, so the step always has a ring. Null only when nothing is wanted
 * any more or no window could be drawn on. Reading takes a moment, so
 * `wanted` is asked again before anything is drawn.
 */
export async function circleSomething(wanted: () => boolean): Promise<string | null> {
  const home = homeWindowBounds();
  try {
    const displayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
    const windows = await listGuideWindows(displayId);
    const ownHome = home ? windows.find((window) => window.pid === process.pid && sameRect(window.bounds, home)) : undefined;
    const others = windows.filter((window) => window.pid !== process.pid);
    const order: WindowRecord[] = [...others.slice(0, MAX_READS), ...(ownHome ? [ownHome] : [])];

    for (const window of order) {
      const own = window === ownHome;
      const inFront = own ? [] : others.slice(0, others.indexOf(window)).map((other) => other.bounds);
      const observation = await rereadWindow(window.pid, window.windowId, displayId);
      if (!observation) continue;
      const found = candidates(observation.rows, own || !home ? inFront : [...inFront, home]);
      const row = found[Math.floor(Math.random() * found.length)];
      if (!row) continue;
      if (!wanted()) return null;
      if (!ring({ ref: row.ref, observationId: observation.observationId }, row.name, wanted)) continue;
      const where = own ? ', right here' : ` in ${observation.app || window.app}`;
      return `the "${row.name}" ${ROLE_WORDS[row.role]}${where}`;
    }
  } catch (error) {
    log.warn(`nothing to circle: ${errorMessage(error)}`);
  }
  if (home && wanted() && ring(WINDOW_REF, undefined, wanted, home)) return 'my own window';
  return null;
}
