// The shot as pure math: where the sphere and the cursor are at second t.
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
const DISCO_PERIOD = 2.4;

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
 * seen.
 */
export interface StageClock {
  start: number | null;
  /** Where the mark sits. */
  home: Point;
  /** Viewport centre: the spiral starts here and drifts onto the mark. */
  center: Point;
  geo: StageGeometry;
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

function discoHue(t: number): number {
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

  const sinceContact = t - CONTACT;
  const burst = clamp01(sinceContact / BURST_SECONDS);
  // A breath in, then gone: the sphere swells a touch before it collapses.
  const exit = clock.exit === null ? 0 : clamp01((t - clock.exit) / EXIT_SECONDS);
  const shrink = easeInBack(exit);
  return {
    t,
    hue: (discoHue(t) + CONTACT_HUE_SPIN * easeOut(sinceContact / 1.2)) % 360,
    sphere: shotSphere,
    sphereRadius: geo.radius * entered * (1 - shrink),
    cursor: shotCursor,
    cursorOpacity: entered * (1 - clamp01(exit * 2)),
    power: easeOut(sinceContact / POWER_SECONDS),
    flare: flare(sinceContact),
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
