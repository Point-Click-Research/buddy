// How a provider declares input as Buddy's own before synthesizing it.
// Both drivers post real OS events, so uiohook sees them exactly like the
// user's own typing and mouse movement. Anything not claimed here reads as
// the user taking over — or, for Escape, trips the kill switch.

import { uiohookCodeFor } from './keycodes';

/** How a provider reports its activity to safety.ts. */
export interface DriverSafetyHooks {
  recordKey(keycode: number, direction: 'down' | 'up'): void;
  recordMousePosition(x: number, y: number): void;
  markTyping(durationMs: number): void;
  markMouseActivity(durationMs: number): void;
}

/** Rough per-character typing cost, generous enough for either driver. */
const PER_CHARACTER_MS = 60;
const TYPING_SLACK_MS = 1500;
/** Covers the extra events a driver may post around one key press. */
const KEY_SLACK_MS = 600;
/** Covers intermediate positions along an animated pointer path. */
const MOUSE_SLACK_MS = 2000;

/**
 * Claim one key press. Named keys are matched exactly, so the agent pressing
 * Escape never trips its own kill switch while a real Escape still does.
 */
export function claimKeys(hooks: DriverSafetyHooks, names: readonly string[]): void {
  for (const name of names) {
    const code = uiohookCodeFor(name);
    if (code === undefined) continue;
    hooks.recordKey(code, 'down');
    hooks.recordKey(code, 'up');
  }
  // A key we can't predict, or an extra event around it, would otherwise
  // look like the user starting to type.
  hooks.markTyping(KEY_SLACK_MS);
}

/** Claim raw text, which can't be enumerated key by key. */
export function claimTyping(hooks: DriverSafetyHooks, length: number): void {
  hooks.markTyping(length * PER_CHARACTER_MS + TYPING_SLACK_MS);
}

/**
 * Claim a pointer move to a screen point (global DIP).
 * `movingForMs` is how long the pointer keeps travelling after this call —
 * zero for an instant warp, the gesture duration for a drag.
 */
export function claimMouse(
  hooks: DriverSafetyHooks,
  x: number,
  y: number,
  movingForMs = 0,
): void {
  hooks.recordMousePosition(x, y);
  if (movingForMs > 0) hooks.markMouseActivity(movingForMs + MOUSE_SLACK_MS);
}
