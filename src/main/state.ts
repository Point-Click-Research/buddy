// The app state machine: one source of truth for what Buddy is doing.
// Kept free of Electron imports so the transition logic is unit-testable.

import type { AppState } from '../shared/types';
import { createLogger } from './log';

const log = createLogger('state');

/**
 * Allowed transitions. The happy path is
 * idle -> listening -> transcribing -> thinking -> speaking -> idle.
 * A text-initiated turn (the Ask Buddy selection button) has no audio to
 * hear, so idle goes straight to thinking. Every busy state can also go
 * straight back to idle (cancel) or to error. thinking <-> listening is a
 * card answered by voice mid-turn (a plan, a confirmation): the mic opens
 * with the chime and the dot, and the turn's own state comes back after.
 */
export const TRANSITIONS: Record<AppState, readonly AppState[]> = {
  idle: ['listening', 'thinking', 'error'],
  listening: ['transcribing', 'thinking', 'idle', 'error'],
  transcribing: ['thinking', 'idle', 'error'],
  thinking: ['speaking', 'listening', 'idle', 'error'],
  speaking: ['idle', 'error'],
  error: ['idle'],
};

export function canTransition(from: AppState, to: AppState): boolean {
  return TRANSITIONS[from].includes(to);
}

type StateListener = (state: AppState) => void;

let current: AppState = 'idle';
const listeners = new Set<StateListener>();

export function getState(): AppState {
  return current;
}

/** Transition to a new state. Invalid transitions are logged and ignored. */
export function setState(to: AppState): void {
  if (to === current) return;
  if (!canTransition(current, to)) {
    log.warn(`ignoring invalid transition ${current} -> ${to}`);
    return;
  }
  current = to;
  log.info(`state -> ${to}`);
  for (const listener of listeners) listener(current);
}

export function onStateChange(listener: StateListener): void {
  listeners.add(listener);
}

// --- Always-on mode flag ---------------------------------------------------
// Tracked separately from the state machine: while on, `idle` means
// "waiting for speech". Only the always-on hotkey (or idle timeout) changes it.

type AlwaysOnListener = (on: boolean) => void;

let alwaysOn = false;
const alwaysOnListeners = new Set<AlwaysOnListener>();

export function getAlwaysOn(): boolean {
  return alwaysOn;
}

export function toggleAlwaysOn(): boolean {
  alwaysOn = !alwaysOn;
  log.info(`always-on -> ${alwaysOn}`);
  for (const listener of alwaysOnListeners) listener(alwaysOn);
  return alwaysOn;
}

export function onAlwaysOnChange(listener: AlwaysOnListener): void {
  alwaysOnListeners.add(listener);
}
