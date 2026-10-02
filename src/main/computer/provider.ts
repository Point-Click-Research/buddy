// The seam between the agent runner and whatever actually drives the
// computer. A provider publishes a descriptor of what it can really do, and
// the model is only ever shown those actions. Coding rule: there is no
// per-action fallback — an action the active provider can't perform returns
// UNSUPPORTED_ACTION rather than being routed somewhere else.

import type { Rect } from '../coords';
import type { ComputerError } from './errors';
import type { RefRow } from './tree';

/** Capability groups a provider either supports in full or not at all. */
export type ActionFamily =
  /** Screenshots and screen-coordinate input. */
  | 'screen'
  /** App and window lists, window state, window-targeted input. */
  | 'window'
  /** Accessibility tree and element-addressed actions. */
  | 'element'
  /** The system clipboard, read and written directly. */
  | 'clipboard'
  /** Recording and replaying a trajectory. */
  | 'recording'
  /** Navigation inside Buddy's own browser. */
  | 'browser';

type ProviderId = 'cua' | 'basic' | 'browser';

export interface ComputerDescriptor {
  id: ProviderId;
  /** Shown in Settings and on the plan card. */
  label: string;
  /** What this provider can do, for the UI and the plan card text. */
  families: readonly ActionFamily[];
  /**
   * The action names the model may call. Authoritative for the tool schema —
   * a provider narrows this below its families where a single action is
   * genuinely missing (Cua has no sustained mouse holds, for example).
   */
  actions: readonly string[];
  /**
   * Jev is configured: element actions take a plain-language `element` in
   * place of a ref, and wait_for a plain-language `condition`.
   */
  jev?: boolean;
}

/** Global screen coordinates in DIP, matching Electron's screen module. */
export interface Point2D {
  x: number;
  y: number;
}

/**
 * Every screenshot a model measures coordinates in is captured to fit this
 * box with its aspect ratio kept. Anthropic's guidance is 1280x800 for desktop
 * work; above about 1.15 megapixels the API shrinks the image before the
 * model sees it, and the coordinates it gives back no longer match ours.
 */
export const SCREENSHOT_BOX = { width: 1280, height: 800 };
/**
 * A local model's: Qwen spends a token per 32×32 block, about 1,000 for the
 * box above, read at a few hundred a second on every turn.
 */
export const LOCAL_SCREENSHOT_BOX = { width: 640, height: 400 };

/** How long to let the UI settle before the post-action observation. */
export const SETTLE_MS = 600;

/** A screenshot of one display, the space coordinate actions work in. */
export interface ScreenObservation {
  kind: 'screen';
  /** What a coordinate action must name to prove it measured this frame. */
  frameId: string;
  /** The delivered image size; the model's coordinates are in this space. */
  width: number;
  height: number;
  /** JPEG bytes, base64-encoded. Absent when the screen is unchanged. */
  base64?: string;
  /**
   * The pixels are identical to the frame already in the model's context, so
   * no image is sent and frameId still refers to the one it has.
   */
  unchanged?: boolean;
}

/**
 * One window's accessibility tree, the space element actions work in. It
 * carries no image: the elements are addressed by ref, and the screen frame
 * remains the only place coordinates are measured.
 */
export interface WindowObservationView {
  kind: 'window';
  /** What an element action must name alongside its ref. */
  observationId: string;
  pid: number;
  windowId: number;
  app: string;
  title: string;
  /** One line per element, already filtered and formatted. */
  tree: string;
  /** How many elements are in the tree, and how many of them are shown. */
  shown: number;
  kept: number;
  /** How many the driver walked before Buddy filtered menus and decoration. */
  total: number;
  /** Set when the driver could not resolve the window's accessibility surface. */
  degradedReason?: string;
  /**
   * The tree reads exactly as the last full read of this window did, so the
   * action before it changed nothing (the stall detector counts these).
   * Absent when the provider did not compare.
   */
  unchanged?: boolean;
}

/** One look at the computer, as the model receives it. */
export type Observation = ScreenObservation | WindowObservationView;

/**
 * What one action produced. Mutating actions always carry a fresh
 * observation, so the model never needs a separate "look again" step.
 */
export interface ActionOutcome {
  /** A plain-text result, for actions that report a value. */
  text?: string;
  observation?: Observation;
  error?: ComputerError;
}

export interface ComputerAction {
  name: string;
  input: Record<string, unknown>;
}

/** Where an action is about to land, in global screen DIP. */
export interface TargetArea extends Point2D {
  /** The element's box, when the target is an element rather than a point. */
  width: number;
  height: number;
}

/** A current window observation with its rows, for deterministic fills (fill_payment). */
export interface ResolvedObservation {
  observationId: string;
  pid: number;
  windowId: number;
  app: string;
  title: string;
  rows: readonly RefRow[];
  /** The page's URL, when the provider is a browser and knows it exactly. */
  url?: string;
}

export interface ComputerProvider {
  descriptor(): ComputerDescriptor;
  /** Observe without acting. */
  snapshot(): Promise<ScreenObservation>;
  /** `signal` aborts work that is still in progress, such as long typing. */
  act(action: ComputerAction, signal?: AbortSignal): Promise<ActionOutcome>;
  /**
   * The elements of one window observation, by the id a tool result carried.
   * Null when the id is unknown or superseded, or on a provider without the
   * element family. This is how fill_payment reads fields without the values
   * ever passing through the model.
   */
  resolveElements(observationId: unknown): ResolvedObservation | null;
  /**
   * Where this action will happen on screen, so the HUD can fly the buddy
   * there before anything moves. Null when the action has
   * no place — typing goes wherever focus already is.
   */
  locate(action: ComputerAction): TargetArea | null;
  /**
   * An element's box in global screen DIP, so a drawing can be anchored to
   * it. Null on a provider that cannot see elements, or for a stale ref.
   */
  elementBox(observationId: unknown, ref: unknown): { displayId: number; rect: Rect } | null;
  /**
   * The app (and window title) this action will land on, for the excluded-
   * apps check in Buddy's browser — where the frontmost app is the user's
   * own work and says nothing about where Buddy is acting. Null when the
   * target is unknown or the action touches nothing.
   */
  targetApp(action: ComputerAction): string | null;
  close(): Promise<void>;
}
