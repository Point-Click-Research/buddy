// Window observation identity. The driver issues a `snapshot_id` per window
// observation and an `element_token` per element inside it, and it replaces
// that index map on the next observation of the same window. Buddy binds to
// those handles rather than inventing its own lifetime: the observationId a
// tool result carries *is* the driver's snapshot_id.
//
// Element refs are the one thing Buddy shortens. The driver's tokens are long
// opaque strings, and a tree of up to ~300 elements has to fit in the model's
// context, so each element gets a short ref (e1, e2, …) bound one-to-one to
// its token and index. Nothing else about them is Buddy's invention.
//
// The rows are kept here too, so that expanding a subtree and locating an
// element on screen read the same binding the model was shown.
//
// Pure module: fully unit-testable.

import { computerError, type ComputerError } from './errors';
import { windowBounds, type Bounds, type RefRow, type TreeElement } from './tree';

export interface WindowObservation {
  /** The driver's snapshot_id. */
  observationId: string;
  pid: number;
  windowId: number;
  app: string;
  title: string;
  /** Where the window sat on screen when it was read, if it said. */
  bounds: RefRow['bounds'];
  /** Every filtered element, in tree order, as the model was shown them. */
  rows: RefRow[];
}

/** The same box, shifted by how far its window moved. */
function moved(box: Bounds | null, dx: number, dy: number): Bounds | null {
  return box ? { ...box, x: box.x + dx, y: box.y + dy } : null;
}

/** One window, keyed the way the driver addresses it. */
function windowKey(pid: number, windowId: number): string {
  return `${pid}:${windowId}`;
}

export class ObservationRegistry {
  private byId = new Map<string, WindowObservation>();
  /** window -> the only observation of it whose refs still mean anything. */
  private currentByWindow = new Map<string, string>();
  /** Windows Buddy tried to read and could not. */
  private unreadable = new Set<string>();
  /**
   * window -> the observation the current one replaced. Its refs are dead,
   * but its rows still say what each stale ref pointed at — the evidence a
   * Jev re-bind matches against the current rows. One per window, so memory
   * stays bounded by the number of windows ever read.
   */
  private staleByWindow = new Map<string, WindowObservation>();

  /**
   * Record a fresh observation of one window. Any earlier observation of the
   * same window is dropped: the driver has already replaced its index map, so
   * those refs now point at nothing.
   */
  record(params: {
    observationId: string;
    pid: number;
    windowId: number;
    app?: string;
    title?: string;
    elements: readonly TreeElement[];
  }): WindowObservation {
    const key = windowKey(params.pid, params.windowId);
    const superseded = this.currentByWindow.get(key);
    if (superseded) {
      const old = this.byId.get(superseded);
      if (old) this.staleByWindow.set(key, old);
      this.byId.delete(superseded);
    }

    const observation: WindowObservation = {
      observationId: params.observationId,
      pid: params.pid,
      windowId: params.windowId,
      app: params.app ?? '',
      title: params.title ?? '',
      bounds: windowBounds(params.elements),
      rows: params.elements.map((element, position) => ({ ...element, ref: `e${position + 1}` })),
    };
    this.byId.set(params.observationId, observation);
    this.currentByWindow.set(key, params.observationId);
    return observation;
  }

  /** The current observation of one window, if there is one. */
  current(pid: number, windowId: number): WindowObservation | null {
    const id = this.currentByWindow.get(windowKey(pid, windowId));
    return id ? (this.byId.get(id) ?? null) : null;
  }

  /** An observation by its id — only while it is still its window's current one. */
  observationById(observationId: unknown): WindowObservation | null {
    if (typeof observationId !== 'string' || !observationId) return null;
    const observation = this.byId.get(observationId) ?? null;
    if (!observation) return null;
    const key = windowKey(observation.pid, observation.windowId);
    return this.currentByWindow.get(key) === observationId ? observation : null;
  }

  /**
   * The windows moved: carry their observations along. The driver's tokens
   * address elements, not places, so they survive a window being dragged —
   * only the boxes need to move by the same amount. Keeping them true is
   * what lets a drawing anchored to an element follow it.
   */
  followWindows(positions: ReadonlyArray<{ pid: number; windowId: number; x: number; y: number }>): void {
    for (const id of this.currentByWindow.values()) {
      const observation = this.byId.get(id);
      if (!observation?.bounds) continue;
      const now = positions.find(
        (at) => at.pid === observation.pid && at.windowId === observation.windowId,
      );
      if (!now) continue;
      const dx = now.x - observation.bounds.x;
      const dy = now.y - observation.bounds.y;
      if (dx === 0 && dy === 0) continue;
      observation.bounds = { ...observation.bounds, x: now.x, y: now.y };
      observation.rows = observation.rows.map((row) =>
        row.bounds
          ? { ...row, bounds: moved(row.bounds, dx, dy), textBounds: moved(row.textBounds, dx, dy) }
          : row,
      );
    }
  }

  /** This window was looked at and would not give up its elements. */
  noteUnreadable(pid: number, windowId: number): void {
    this.unreadable.add(windowKey(pid, windowId));
  }

  /**
   * Whether this window has been looked at, successfully or not. A window
   * that cannot be read still counts: the look-before-you-click rule exists
   * to make Buddy look once, and a window with no elements to offer must
   * not become one it can never touch.
   */
  hasLookedAt(pid: number, windowId: number): boolean {
    const key = windowKey(pid, windowId);
    return this.currentByWindow.has(key) || this.unreadable.has(key);
  }

  /**
   * Whether a window whose elements have already been read covers this
   * screen point. Used to let a coordinate action through without asking
   * the driver which window is there.
   */
  covers(x: number, y: number): boolean {
    for (const id of this.currentByWindow.values()) {
      const bounds = this.byId.get(id)?.bounds;
      if (!bounds) continue;
      if (x >= bounds.x && y >= bounds.y && x <= bounds.x + bounds.w && y <= bounds.y + bounds.h) return true;
    }
    return false;
  }

  /**
   * A ref from the observation that record() just replaced, together with
   * that window's current observation — everything a re-bind needs. Null
   * when the id is not any window's previous observation, the ref was not
   * in it, or the window has no current observation to match against.
   */
  staleElement(
    observationId: unknown,
    ref: unknown,
  ): { element: RefRow; current: WindowObservation } | null {
    if (typeof observationId !== 'string' || typeof ref !== 'string') return null;
    for (const [key, old] of this.staleByWindow) {
      if (old.observationId !== observationId) continue;
      const element = old.rows.find((row) => row.ref === ref) ?? null;
      const currentId = this.currentByWindow.get(key);
      const current = currentId ? (this.byId.get(currentId) ?? null) : null;
      return element && current ? { element, current } : null;
    }
    return null;
  }

  /**
   * Resolve a ref the model sent against the observation it claims to come
   * from. Returns the element, or the error to hand back.
   */
  resolve(
    observationId: unknown,
    ref: unknown,
  ): { element: RefRow; observation: WindowObservation } | { error: ComputerError } {
    if (typeof observationId !== 'string' || !observationId) {
      return { error: computerError('INVALID_REQUEST', 'An element action needs the observation_id its ref came from.') };
    }
    const observation = this.byId.get(observationId);
    if (!observation) {
      return {
        error: computerError(
          'STALE_OBSERVATION',
          `Observation ${observationId} has been replaced by a newer one of that window.`,
        ),
      };
    }
    // Belt and braces: an observation is dropped when superseded, so this can
    // only differ if a window was re-observed without going through record().
    if (this.currentByWindow.get(windowKey(observation.pid, observation.windowId)) !== observationId) {
      return {
        error: computerError('STALE_OBSERVATION', `Observation ${observationId} is no longer current for that window.`),
      };
    }
    if (typeof ref !== 'string' || !ref) {
      return { error: computerError('INVALID_REQUEST', 'An element action needs a ref from the observation.') };
    }
    const element = observation.rows.find((row) => row.ref === ref);
    if (!element) {
      return {
        error: computerError('INVALID_REQUEST', `Observation ${observationId} has no element ${ref}.`),
      };
    }
    return { element, observation };
  }
}
