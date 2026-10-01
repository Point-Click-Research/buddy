import { describe, expect, it } from 'vitest';
import { canTransition, TRANSITIONS } from '../src/main/state';
import type { AppState } from '../src/shared/types';

const ALL_STATES = Object.keys(TRANSITIONS) as AppState[];

describe('state machine transitions', () => {
  it('allows the happy path', () => {
    expect(canTransition('idle', 'listening')).toBe(true);
    expect(canTransition('listening', 'transcribing')).toBe(true);
    expect(canTransition('transcribing', 'thinking')).toBe(true);
    expect(canTransition('thinking', 'speaking')).toBe(true);
    expect(canTransition('speaking', 'idle')).toBe(true);
  });

  it('allows cancelling back to idle from every busy state', () => {
    for (const state of ['listening', 'transcribing', 'thinking', 'speaking'] as const) {
      expect(canTransition(state, 'idle')).toBe(true);
    }
  });

  it('allows every state except error to fail', () => {
    for (const state of ALL_STATES.filter((s) => s !== 'error')) {
      expect(canTransition(state, 'error')).toBe(true);
    }
  });

  it('only lets error recover to idle', () => {
    expect(TRANSITIONS.error).toEqual(['idle']);
  });

  // The Ask Buddy selection button starts a turn with no audio to hear, so
  // idle goes straight to thinking. Without this the whole turn ran as
  // "idle": no spinner on the dot, and Escape had nothing to cancel.
  it('allows a text-initiated turn to skip straight to thinking', () => {
    expect(canTransition('idle', 'thinking')).toBe(true);
  });

  it('rejects skipping states', () => {
    expect(canTransition('idle', 'speaking')).toBe(false);
    expect(canTransition('listening', 'speaking')).toBe(false);
  });
});
