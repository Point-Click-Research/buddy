// Registering draw, update_drawing and erase for one request.
//
// This is the only place the drawing layer meets the rest of the app: it
// gathers what anchors can resolve against (this turn's screenshots, the
// agent's element observations), validates the call, and sends plain
// commands to the overlay of the one display each shape belongs to.

import { screen } from 'electron';
import type { DrawingReveal } from '../../shared/drawing';
import { type ToolOutcome, type ToolRegistry, toolArgs } from '../ai/tools';
import type { ScreenshotMeta } from '../capture';
import { resolveFrame } from '../computer/frame-store';
import { refreshWindowPositions } from '../computer/observer';
import type { Rect } from '../coords';
import { createLogger } from '../log';
import { broadcast, clearAllAnnotations, hasAnnotations, sendDrawings } from '../windows';
import { aimAtNamed, bindDescribed, type AnchorWorld, type DescribeElements, type ElementBox } from './anchors';
import { drawingTools } from './schema';
import { DrawingStore } from './store';
import type { StoredShape } from './types';
import { collapseRepeatedMarkPointers, validateDraw } from './validate';
import { IpcChannels } from '../../shared/ipc';

const log = createLogger('drawing');

/**
 * Where element bounds come from, when a provider can give them. The
 * provider reports global screen DIP and the display; this module adds that
 * display's bounds, which it already has.
 */
export type ElementLookup = (
  observationId: unknown,
  ref: unknown,
) => { displayId: number; rect: Rect } | null;

const store = new DrawingStore();

/**
 * Where { mark: n } anchors resolve. Injected from index.ts at startup
 * (marks.ts owns the turn's marks) so this module stays free of the
 * settings-store import chain and unit-testable.
 */
export type MarkLookup = (value: unknown) => { displayId: number; rect: Rect } | null;
let markLookup: MarkLookup = () => null;

export function setMarkLookup(lookup: MarkLookup): void {
  markLookup = lookup;
}

/** Is Buddy showing anything right now? */
export function hasDrawings(): boolean {
  return store.displays().some((displayId) => store.on(displayId).length > 0);
}

/** Everything on screen goes when a new request starts. */
function resetDrawings(): void {
  // Which displays to clear has to be read before the store forgets them.
  const displays = store.displays();
  store.clear();
  for (const displayId of displays) sendDrawings(displayId, []);
}

/**
 * Take down everything Buddy has on screen: drawings and the buddy dot's
 * pings. This is the dismiss — Escape, a scroll, a click or a new question
 * all mean what was being pointed at is done with, or has moved out from
 * under its markings. A no-op when nothing is showing, so it is cheap to
 * call on every scroll tick.
 */
export function dismissAll(): void {
  if (hasAnnotations()) clearAllAnnotations();
  resetDrawings();
}

/**
 * Register the drawing tools. `screenshots` are this turn's captures, whose
 * frameIds anchors may name; `element` resolves refs when a provider that
 * knows about elements is active.
 */
export function addDrawingTools(
  registry: ToolRegistry,
  context: {
    screenshots?: readonly ScreenshotMeta[];
    element?: ElementLookup;
    /** Binds {element: "…"} anchors to refs, where a window reader and Jev can. */
    describe?: DescribeElements;
    /** A spoken answer draws once. A task draws again on later steps. */
    oneDraw?: boolean;
  },
): void {
  const displays = new Map<number, Rect>(
    screen.getAllDisplays().map((display) => [display.id, display.bounds]),
  );

  const world: AnchorWorld = {
    frame(frameId) {
      // This turn's screenshots first, so the ids the model was just shown
      // always resolve, then the app-wide registry for agent-mode frames. A
      // point sent without one (the model put it on the shape instead) can
      // only mean the turn's screenshot when there is just the one.
      const only = frameId === undefined && context.screenshots?.length === 1 ? context.screenshots[0] : undefined;
      const shot = only ?? context.screenshots?.find((meta) => meta.frameId === frameId);
      if (shot) {
        return {
          displayId: shot.displayId,
          imageWidth: shot.imageWidth,
          imageHeight: shot.imageHeight,
          bounds: shot.bounds,
        };
      }
      const frame = resolveFrame(frameId);
      return frame
        ? {
            displayId: frame.displayId,
            imageWidth: frame.width,
            imageHeight: frame.height,
            bounds: frame.bounds,
          }
        : null;
    },
    element(observationId, ref): ElementBox | null {
      const found = context.element?.(observationId, ref);
      const display = found && displays.get(found.displayId);
      return found && display ? { displayId: found.displayId, rect: found.rect, display } : null;
    },
    // The user's marks from this turn, so { mark: n } anchors a drawing to
    // what the user themselves pointed at.
    mark(number): ElementBox | null {
      const found = markLookup(number);
      const display = found && displays.get(found.displayId);
      return found && display ? { displayId: found.displayId, rect: found.rect, display } : null;
    },
  };

  // The follower re-resolves element anchors against whatever world the
  // most recent request could see.
  lastContext = { world, displays };

  // A second draw in one spoken answer is how "what is this?" marked the
  // same thing twice. Tasks and walkthroughs draw again on later steps.
  const once = context.oneDraw ? { current: false } : null;

  for (const definition of drawingTools(Boolean(context.describe))) {
    registry.set(definition.name, {
      definition,
      // Drawings appear while Buddy is still talking, not after.
      immediate: true,
      execute: async (input) => {
        // Only where a described thing can be found does a measured ring have to say what it is on.
        const aimed = context.describe && definition.name === 'draw' ? aimAtNamed(toolArgs(input)) : { call: toolArgs(input), fallback: null };
        if ('error' in aimed) {
          log.warn(`nothing drawn: ${aimed.error}`);
          return { content: aimed.error, isError: true };
        }
        let bound = await bindDescribed(aimed.call, context.describe);
        if ('error' in bound && aimed.fallback) bound = await bindDescribed(aimed.fallback, context.describe);
        if ('error' in bound) {
          log.warn(`nothing drawn: ${bound.error}`);
          return { content: bound.error, isError: true };
        }
        return run(definition.name, bound.call, { world, displays }, once);
      },
    });
  }
}

let lastContext: RunContext | null = null;
let following = false;

/**
 * Keep element-anchored drawings on their elements. Every beat: bring the
 * observed window positions up to date (one cheap list_windows call), then
 * rebuild each anchored shape from its original call. One that moved is
 * re-sent — the overlay swaps it in place without re-drawing it — and one
 * whose ref has gone stale fades out, because a ring around where a button
 * used to be points at nothing.
 */
export async function followElements(): Promise<void> {
  if (following || !lastContext) return;
  const anchored = store.elementAnchored();
  if (anchored.length === 0) return;
  following = true;
  try {
    await refreshWindowPositions();
    const touched = new Set<number>();

    for (const { shape, displayId } of anchored) {
      const result = validateDraw(
        { shapes: [{ ...shape.call, id: shape.command.id }] },
        {
          world: lastContext.world,
          displays: lastContext.displays,
          nextId: () => shape.command.id,
          now: Date.now(),
        },
      );
      const rebuilt = result.shapes[0];
      if (!rebuilt) {
        // A failed rebuild usually means the ref is mid-rematch. While a
        // walkthrough or agent is pinning drawings, leave the last ring up
        // rather than blanking the screen between reread and retarget.
        if (!drawingsPinned()) {
          store.erase([shape.command.id]);
          touched.add(displayId);
        }
        continue;
      }
      // Following must not renew the shape's lifetime, or an anchored ring
      // would outlive every other drawing for as long as its window exists.
      rebuilt.command.expiresAt = shape.command.expiresAt;
      if (JSON.stringify(rebuilt.command) === JSON.stringify(shape.command)) continue;
      if (rebuilt.displayId !== displayId) store.erase([shape.command.id]);
      store.add(rebuilt.displayId, [rebuilt]);
      touched.add(displayId);
      touched.add(rebuilt.displayId);
    }

    for (const displayId of touched) sendDrawings(displayId, store.on(displayId));
  } finally {
    following = false;
  }
}

interface RunContext {
  world: AnchorWorld;
  displays: ReadonlyMap<number, Rect>;
}

function run(
  name: string,
  args: Record<string, unknown>,
  context: RunContext,
  once: { current: boolean } | null,
): ToolOutcome {
  switch (name) {
    case 'draw':
      return draw(args, context, once);
    case 'update_drawing':
      return update(args, context);
    default:
      return erase(args);
  }
}

function draw(
  args: Record<string, unknown>,
  context: RunContext,
  once: { current: boolean } | null,
): ToolOutcome {
  if (once?.current) {
    return {
      content:
        'Not drawn. This answer already has drawings on screen. Speak the answer now. Do not call draw again.',
    };
  }

  const result = validateDraw(args, {
    world: context.world,
    displays: context.displays,
    nextId: () => store.nextId(),
    now: Date.now(),
  });
  const collapsed = collapseRepeatedMarkPointers(result.shapes);

  if (result.replace) {
    store.clear();
    for (const displayId of context.displays.keys()) sendDrawings(displayId, []);
  }

  const touched = new Set<number>();
  for (const shape of collapsed.shapes) {
    store.add(shape.displayId, [shape]);
    touched.add(shape.displayId);
  }
  for (const displayId of touched) sendDrawings(displayId, store.on(displayId));

  if (collapsed.shapes.length === 0) {
    log.warn(`nothing drawn: ${result.errors.join(' ')}`);
    return { content: result.errors.join('\n') || 'Nothing to draw.', isError: true };
  }
  if (once) once.current = true;
  const drawn = `Drew ${collapsed.shapes.length} shape(s): ${collapsed.shapes
    .map((shape) => shape.command.id)
    .join(', ')}.`;
  const repeated =
    collapsed.dropped > 0 ? ` Dropped ${collapsed.dropped} that repeated a mark already pointed at.` : '';
  const rejected = result.errors.length > 0 ? `\nNot drawn:\n${result.errors.join('\n')}` : '';
  const pace = once ? ' On screen. Do not call draw again; say the answer if this reply has not already.' : '';
  return { content: `${drawn}${repeated}${pace}${rejected}` };
}

/**
 * Restyle or move one shape. The change is validated by rebuilding the whole
 * shape from its original call merged with the changes, so an update can
 * never produce geometry a fresh draw wouldn't accept.
 */
function update(args: Record<string, unknown>, context: RunContext): ToolOutcome {
  const id = typeof args['id'] === 'string' ? args['id'] : '';
  const changes = (args['changes'] ?? {}) as Record<string, unknown>;
  if (!id) return { content: 'update_drawing needs the id of a shape you drew.', isError: true };

  const previous = store.find(id);
  if (!previous) {
    return { content: `There is no drawing with id ${id} on screen.`, isError: true };
  }

  const result = validateDraw(
    { shapes: [{ ...previous.shape.call, ...changes, id }] },
    { world: context.world, displays: context.displays, nextId: () => id, now: Date.now() },
  );
  const shape = result.shapes[0];
  if (!shape) return { content: result.errors.join('\n'), isError: true };

  // A shape that moved to another display leaves the one it was on.
  if (shape.displayId !== previous.displayId) {
    store.erase([id]);
    sendDrawings(previous.displayId, store.on(previous.displayId));
  }
  store.add(shape.displayId, [shape]);
  sendDrawings(shape.displayId, store.on(shape.displayId));
  return { content: `Updated ${id}.` };
}

function erase(args: Record<string, unknown>): ToolOutcome {
  if (args['all'] === true) {
    const displays = store.displays();
    store.clear();
    for (const displayId of displays) sendDrawings(displayId, []);
    return { content: 'Erased everything.' };
  }
  const ids = Array.isArray(args['ids'])
    ? args['ids'].filter((id): id is string => typeof id === 'string')
    : [];
  if (ids.length === 0) return { content: 'erase needs ids, or all: true.', isError: true };
  const changed = store.erase(ids);
  for (const displayId of changed) sendDrawings(displayId, store.on(displayId));
  return { content: changed.length > 0 ? `Erased ${ids.join(', ')}.` : 'Those ids are not on screen.' };
}

/** Drop drawings whose time is up. Driven by a timer in index.ts. */
export function expireDrawings(): void {
  // A walkthrough's step drawings must stay until the step advances.
  if (drawingsPinned()) return;
  for (const displayId of store.expire(Date.now())) {
    sendDrawings(displayId, store.on(displayId));
  }
}

/**
 * After a window is re-observed, the old observationId/ref pair is stale.
 * Swap every drawing that still names the old pair onto the new one and
 * rebuild so rings stay on the control after a scroll.
 */
export function retargetAnchors(
  from: { observationId: string; ref: string },
  to: { observationId: string; ref: string },
): void {
  if (!lastContext) return;
  if (from.observationId === to.observationId && from.ref === to.ref) return;
  const touched = new Set<number>();
  for (const { shape, displayId } of store.elementAnchored()) {
    if (!namesAnchor(shape.call, from)) continue;
    const nextCall = JSON.parse(JSON.stringify(shape.call)) as Record<string, unknown>;
    rewriteAnchors(nextCall, from, to);
    const result = validateDraw(
      { shapes: [{ ...nextCall, id: shape.command.id }] },
      {
        world: lastContext.world,
        displays: lastContext.displays,
        nextId: () => shape.command.id,
        now: Date.now(),
      },
    );
    const rebuilt = result.shapes[0];
    if (!rebuilt) {
      store.erase([shape.command.id]);
      touched.add(displayId);
      continue;
    }
    rebuilt.command.expiresAt = shape.command.expiresAt;
    store.add(rebuilt.displayId, [rebuilt]);
    touched.add(displayId);
    touched.add(rebuilt.displayId);
  }
  for (const displayId of touched) sendDrawings(displayId, store.on(displayId));
}

/** True when a drawing call names this exact observation/ref pair. */
function namesAnchor(value: unknown, from: { observationId: string; ref: string }): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => namesAnchor(entry, from));
  const record = value as Record<string, unknown>;
  if (
    record.ref === from.ref &&
    (record.observationId === from.observationId || record.observation_id === from.observationId)
  ) {
    return true;
  }
  return Object.values(record).some((child) => namesAnchor(child, from));
}

function rewriteAnchors(
  value: unknown,
  from: { observationId: string; ref: string },
  to: { observationId: string; ref: string },
): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) rewriteAnchors(entry, from, to);
    return;
  }
  const record = value as Record<string, unknown>;
  if (record.observationId === from.observationId && record.ref === from.ref) {
    record.observationId = to.observationId;
    record.ref = to.ref;
  }
  if (record.observation_id === from.observationId && record.ref === from.ref) {
    record.observation_id = to.observationId;
    record.ref = to.ref;
  }
  for (const child of Object.values(record)) rewriteAnchors(child, from, to);
}

/** Injected so drawings survive while a walkthrough or agent is active. */
let drawingsPinned = (): boolean => false;
export function setDrawingsPinned(check: () => boolean): void {
  drawingsPinned = check;
}

/**
 * Put shapes on a display through the production store, so they expire, get
 * dismissed and diff like anything the model draws. The gallery is the only
 * caller; the model's own path is the draw tool.
 */
export function presentShapes(displayId: number, shapes: readonly StoredShape[]): void {
  store.add(displayId, shapes);
  sendDrawings(displayId, store.on(displayId));
}

/** The spoken reply reached these markers: their drawings appear now. */
export function revealDrawings(names: string[]): void {
  if (names.length > 0) broadcast(IpcChannels.drawingsReveal, { names } satisfies DrawingReveal);
}

/** The response is over: whatever is still waiting appears. */
export function revealAllDrawings(): void {
  broadcast(IpcChannels.drawingsReveal, { names: [], all: true } satisfies DrawingReveal);
}
