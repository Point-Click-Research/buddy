// The shot as pure math: where the sphere and the cursor are at second t,
// and, once it is over, where the dot is as it trails the visitor's pointer.
// Both the 3D scene and the DOM read one clock through sceneAt, so they
// never drift. Screen px, +y down.

export type Point = { x: number; y: number };

/**
 * The whole shot is one inward spiral: no phases, no blends, so nothing
 * changes speed abruptly. Buddy starts talking when it ends.
 */
export const LAND = 2.8;

/** How long the landed sphere holds while the burst spreads, before it moves on. */
export const HOLD = 0.5;

/** One turn of the disco hue, matching the desktop overlay. */
export const DISCO_PERIOD = 2.4;

/**
 * The desktop buddy dot (src/renderer/overlay): 14px, its
 * top-left 20px right and below the pointer, closing 16% of the remaining
 * distance each frame.
 */
export const DESKTOP_DOT = { size: 14, offset: { x: 20, y: 20 }, easing: 0.16 } as const;

/** How long the mark takes to become the dot. */
const DETACH_SECONDS = 1.1;

/** How long the sphere takes to scale away once `exit` comes round. */
const EXIT_SECONDS = 0.6;

export interface StageGeometry {
  /** Sphere radius in px. */
  radius: number;
  /** How far each of them starts from the centre. */
  spread: number;
}

/**
 * The one clock both renderers read. `start` is null until the model has
 * loaded and the mark has been measured, so nothing moves before it can be
 * seen. `follow` begins when the dot leaves the mark for the pointer:
 * `trail` is the dot's top-left, eased toward the pointer by trailPointer.
 */
export interface StageClock {
  start: number | null;
  /** Where the mark sits. */
  home: Point;
  /** Viewport centre: the spiral starts here and drifts onto the mark. */
  center: Point;
  geo: StageGeometry;
  follow: { at: number | null; pointer: Point; trail: Point };
  /** The shot second the sphere starts to scale away; null to stay on the mark. */
  exit: number | null;
}

/** The first second everything is at rest: landed, or landed and gone. */
export function restTime(clock: StageClock): number {
  return clock.exit === null ? LAND : clock.exit + EXIT_SECONDS;
}

/** Everything on screen this frame, in viewport px. */
export interface SceneFrame {
  t: number;
  hue: number;
  /** Sphere centre and radius. */
  sphere: Point;
  sphereRadius: number;
  /** Cursor box top-left. */
  cursor: Point;
  cursorOpacity: number;
  /** 0 until the cursor touches the dot, then 1: the disco is on. */
  power: number;
  /** The jolt of that touch: peaks just after contact, gone within a second. */
  flare: number;
  /** The touch's shockwave: how far it has spread (0 to 1) and how bright it still is. */
  burst: number;
  burstOpacity: number;
  /** 0 until the exit, 1 once the sphere has scaled away. */
  gone: number;
}

/** How far round each other they go, in turns. */
const TURNS = 0.7;
const ENTER_SECONDS = 0.4;
/** Where in the spiral the cursor tip meets the sphere; the rest is the settle. */
const CONTACT = 0.73 * LAND;
const POWER_SECONDS = 0.3;
const BURST_SECONDS = 1.7;
/** Extra hue the disco whips through at contact before settling into its spin. */
const CONTACT_HUE_SPIN = 540;

export function stageGeometry(radius: number, vw: number, vh: number): StageGeometry {
  return { radius, spread: clamp(Math.min(vw, vh) * 0.26, 120, 240) };
}

/**
 * The cursor's box when it sits on the sphere, traced from the app icon:
 * the tip pokes out above the sphere, the body lies over its upper-left.
 */
export function cursorPose(radius: number): { offset: Point; height: number } {
  return { offset: { x: -0.685 * radius, y: -1.25 * radius }, height: 1.94 * radius };
}

export function discoHue(t: number): number {
  return ((t / DISCO_PERIOD) * 360) % 360;
}

export function sceneAt(clock: StageClock, nowMs: number): SceneFrame | null {
  if (clock.start === null) return null;
  const { geo } = clock;
  const t = (nowMs - clock.start) / 1000;
  const u = clamp01(t / LAND);

  // Each spirals onto its own resting spot: the sphere onto the centre, the
  // cursor's box onto its pose. Angle leads (they are circling the moment
  // they appear) and eases out; the radius holds, then closes. Speed only
  // ever falls, reaching zero at the end, so the landing is a glide.
  const phi = Math.PI + TURNS * 2 * Math.PI * easeOutCubic(u);
  const closing = easeInOutCubic(u);
  const r = geo.spread * (1 - closing);
  const origin = mix(clock.center, clock.home, closing);
  const entered = easeOut(t / ENTER_SECONDS);
  const pose = cursorPose(geo.radius).offset;
  const orbit = { x: r * Math.cos(phi), y: r * Math.sin(phi) };
  const shotSphere = { x: origin.x + orbit.x, y: origin.y + orbit.y };
  const shotCursor = { x: origin.x + pose.x - orbit.x, y: origin.y + pose.y - orbit.y };

  // 0 as the landed mark, 1 as the desktop dot trailing the pointer. The
  // trail starts at the mark, so the sphere's path is the trail's own easing;
  // this only shapes how the size and the cursor give way.
  const dot = clock.follow.at === null ? 0 : easeOut((nowMs - clock.follow.at) / 1000 / DETACH_SECONDS);
  const half = DESKTOP_DOT.size / 2;
  const trailCentre = { x: clock.follow.trail.x + half, y: clock.follow.trail.y + half };
  const sinceContact = t - CONTACT;
  const burst = clamp01(sinceContact / BURST_SECONDS);
  // The disco rides the big sphere. It leaves as the sphere becomes the dot.
  const disco = 1 - dot;
  // A breath in, then gone: the sphere swells a touch before it collapses.
  const exit = clock.exit === null ? 0 : clamp01((t - clock.exit) / EXIT_SECONDS);
  const shrink = easeInBack(exit);
  return {
    t,
    hue: (discoHue(t) + CONTACT_HUE_SPIN * easeOut(sinceContact / 1.2)) % 360,
    sphere: mix(shotSphere, trailCentre, dot),
    sphereRadius: lerp(geo.radius * entered, half, dot) * (1 - shrink),
    cursor: shotCursor,
    cursorOpacity: entered * (1 - Math.min(1, dot * 2.5)) * (1 - clamp01(exit * 2)),
    power: easeOut(sinceContact / POWER_SECONDS) * disco,
    flare: flare(sinceContact) * disco,
    // Out past the screen's edges almost at once, then a long fade to nothing.
    burst: easeOut(burst),
    burstOpacity: burst === 0 || burst === 1 ? 0 : Math.min(1, burst * 20) * (1 - burst) ** 1.6,
    gone: exit,
  };
}

/** A fast rise and a quarter-second decay, normalised to peak at 1 (~90ms in). */
function flare(seconds: number): number {
  if (seconds <= 0) return 0;
  return (Math.exp(-4 * seconds) - Math.exp(-24 * seconds)) / 0.583;
}

/** A screen rectangle; a DOMRect is one. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The space a bubble keeps from the viewport's edges, the dot, and `avoid`. */
const BUBBLE_GAP = 12;

/** A side of the dot the bubble can sit on. */
export type BubbleSpot = 'right-above' | 'right-below' | 'left-above' | 'left-below';

/**
 * How much clearer a better spot must be before the bubble leaves a spot
 * that still works. Without it, a bubble at the edge of `avoid` (or growing
 * as words arrive) flips sides every few frames.
 */
const SETTLE_MARGIN = 40;
/** Above/below follows the dot's half of the screen, with a band in the middle that keeps the side it has. */
const HALF_BAND = 0.08;

/**
 * Where a bubble sits while the dot trails the pointer: above-right of the
 * dot, as the desktop overlay places its caption, or below-right while the
 * dot is in the top half, so a tall bubble never covers it. If that would
 * cover `avoid`, the other side of the dot, then its left, whichever is clear
 * first. `current` stays while it is clear, and gives way only to a better
 * spot that is clear by SETTLE_MARGIN. Kept inside the viewport.
 */
export function followBubbleAt(
  clock: StageClock,
  width: number,
  height: number,
  avoid?: Box,
  current?: BubbleSpot,
): { at: Point; spot: BubbleSpot } {
  const { trail } = clock.follow;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const above = Math.max(BUBBLE_GAP, trail.y - height - BUBBLE_GAP);
  const below = Math.max(BUBBLE_GAP, Math.min(trail.y + DESKTOP_DOT.size + BUBBLE_GAP, vh - height - BUBBLE_GAP));
  const right = clamp(trail.x + 24, BUBBLE_GAP, vw - width - BUBBLE_GAP);
  const left = clamp(trail.x - width - BUBBLE_GAP, BUBBLE_GAP, vw - width - BUBBLE_GAP);
  const places: Record<BubbleSpot, Point> = {
    'right-above': { x: right, y: above },
    'right-below': { x: right, y: below },
    'left-above': { x: left, y: above },
    'left-below': { x: left, y: below },
  };
  const half = trail.y / vh;
  const keepsSide = current && Math.abs(half - 0.5) < HALF_BAND;
  const belowFirst = keepsSide ? current.endsWith('below') : half < 0.5;
  const order: BubbleSpot[] = belowFirst
    ? ['right-below', 'right-above', 'left-below', 'left-above']
    : ['right-above', 'right-below', 'left-above', 'left-below'];
  const clear = (spot: BubbleSpot, gap: number): boolean => !avoid || !covers(places[spot], width, height, avoid, gap);
  const settled = current && clear(current, BUBBLE_GAP) ? current : null;
  const better = order.find((spot) => clear(spot, BUBBLE_GAP + SETTLE_MARGIN));
  const spot =
    settled && (!better || order.indexOf(better) >= order.indexOf(settled))
      ? settled
      : (better ?? order.find((candidate) => clear(candidate, BUBBLE_GAP)) ?? order[0]);
  return { at: places[spot], spot };
}

/** How long a dodge takes to mostly settle: about 90% of the way in three of these. */
const BUBBLE_GLIDE_S = 0.18;

/**
 * The bubble's offset from the dot, eased from `offset` toward the one that
 * puts it at `at` over `dtS` seconds. Easing the offset rather than the
 * position keeps the bubble locked to the dot as it trails, so only a dodge
 * glides; the easing is by elapsed time, so it is as smooth at 60Hz as 120Hz.
 */
export function glideBubble(clock: StageClock, offset: Point | null, at: Point, dtS: number): Point {
  const { trail } = clock.follow;
  const next = { x: at.x - trail.x, y: at.y - trail.y };
  return offset ? mix(offset, next, 1 - Math.exp(-dtS / BUBBLE_GLIDE_S)) : next;
}

function covers(at: Point, width: number, height: number, box: Box, gap = BUBBLE_GAP): boolean {
  return at.x < box.right + gap && at.x + width > box.left - gap && at.y < box.bottom + gap && at.y + height > box.top - gap;
}

/** The pointer that parks the trailing dot's top-left on `spot`. */
export function pointerFor(spot: Point): Point {
  return { x: spot.x - DESKTOP_DOT.offset.x, y: spot.y - DESKTOP_DOT.offset.y };
}

/**
 * The dot leaves the mark: start trailing from where the mark is, or, when
 * `instant`, start already shrunk and beside the pointer.
 */
export function detach(clock: StageClock, pointer: Point, nowMs: number, instant = false): void {
  const half = DESKTOP_DOT.size / 2;
  clock.follow = instant
    ? {
        at: nowMs - DETACH_SECONDS * 1000,
        pointer,
        trail: { x: pointer.x + DESKTOP_DOT.offset.x, y: pointer.y + DESKTOP_DOT.offset.y },
      }
    : { at: nowMs, pointer, trail: { x: clock.home.x - half, y: clock.home.y - half } };
}

/**
 * Close on the pointer by the desktop's fraction. Call once per frame. The
 * first stretch from the mark is a long one, so the easing ramps up to the
 * desktop's over the detach instead of snapping across.
 */
export function trailPointer(clock: StageClock, nowMs: number): void {
  const { at, pointer, trail } = clock.follow;
  if (at === null) return;
  const easing = lerp(0.035, DESKTOP_DOT.easing, easeOut((nowMs - at) / 1000 / DETACH_SECONDS));
  trail.x += (pointer.x + DESKTOP_DOT.offset.x - trail.x) * easing;
  trail.y += (pointer.y + DESKTOP_DOT.offset.y - trail.y) * easing;
}

function mix(a: Point, b: Point, m: number): Point {
  return { x: lerp(a.x, b.x, m), y: lerp(a.y, b.y, m) };
}

function lerp(a: number, b: number, m: number): number {
  return a + (b - a) * m;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** Quintic ease-out, clamped: fast to leave, long to settle. */
function easeOut(u: number): number {
  return 1 - Math.pow(1 - clamp01(u), 5);
}

function easeOutCubic(u: number): number {
  return 1 - Math.pow(1 - u, 3);
}

/** Pulls back past 0 before it goes, so what follows it swells first. */
function easeInBack(u: number): number {
  const c = 1.4;
  return (c + 1) * u * u * u - c * u * u;
}

function easeInOutCubic(u: number): number {
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}
