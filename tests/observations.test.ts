import { describe, expect, it } from 'vitest';
import { ObservationRegistry } from '../src/main/computer/observations';
import type { TreeElement } from '../src/main/computer/tree';

const PID = 501;
const WINDOW = 9001;

function element(partial: Partial<TreeElement> & Pick<TreeElement, 'index'>): TreeElement {
  return {
    token: null,
    role: 'button',
    name: '',
    value: '',
    enabled: true,
    selected: false,
    bounds: null,
    textBounds: null,
    depth: 1,
    actions: [],
    ...partial,
  };
}

/** The shape the driver returns: an index per element, plus its opaque token. */
function elements(count: number, prefix = 'tok'): TreeElement[] {
  return Array.from({ length: count }, (_, i) => element({ index: i * 10, token: `${prefix}-${i}` }));
}

describe('recording an observation', () => {
  it('uses the driver snapshot_id as the observationId', () => {
    const registry = new ObservationRegistry();
    const observation = registry.record({
      observationId: 'snap-abc',
      pid: PID,
      windowId: WINDOW,
      elements: elements(2),
    });
    expect(observation.observationId).toBe('snap-abc');
  });

  it('binds each short ref to the driver token and index', () => {
    const registry = new ObservationRegistry();
    registry.record({ observationId: 'snap-1', pid: PID, windowId: WINDOW, elements: elements(3) });

    const resolved = registry.resolve('snap-1', 'e2');
    expect('element' in resolved).toBe(true);
    if (!('element' in resolved)) return;
    // e2 is the second element the driver listed.
    expect(resolved.element.token).toBe('tok-1');
    expect(resolved.element.index).toBe(10);
  });

  it('tolerates an element the driver gave no token for', () => {
    const registry = new ObservationRegistry();
    registry.record({
      observationId: 'snap-1',
      pid: PID,
      windowId: WINDOW,
      elements: [element({ index: 4 })],
    });
    const resolved = registry.resolve('snap-1', 'e1');
    if (!('element' in resolved)) throw new Error('expected an element');
    expect(resolved.element.token).toBeNull();
    expect(resolved.element.index).toBe(4);
  });

  it('exposes the current observation of a window', () => {
    const registry = new ObservationRegistry();
    registry.record({ observationId: 'snap-1', pid: PID, windowId: WINDOW, elements: elements(1) });
    expect(registry.current(PID, WINDOW)?.observationId).toBe('snap-1');
    expect(registry.current(PID, 1234)).toBeNull();
  });
});

describe('invalidating refs when a window is observed again', () => {
  it('refuses refs from the superseded observation', () => {
    // The driver replaces its index map on every observation, so the old refs
    // now point at whatever happens to sit in those slots.
    const registry = new ObservationRegistry();
    registry.record({ observationId: 'snap-1', pid: PID, windowId: WINDOW, elements: elements(3) });
    registry.record({ observationId: 'snap-2', pid: PID, windowId: WINDOW, elements: elements(3, 'new') });

    const stale = registry.resolve('snap-1', 'e1');
    expect('error' in stale && stale.error.code).toBe('STALE_OBSERVATION');
  });

  it('resolves the same ref against the newest observation', () => {
    const registry = new ObservationRegistry();
    registry.record({ observationId: 'snap-1', pid: PID, windowId: WINDOW, elements: elements(3) });
    registry.record({ observationId: 'snap-2', pid: PID, windowId: WINDOW, elements: elements(3, 'new') });

    const fresh = registry.resolve('snap-2', 'e1');
    if (!('element' in fresh)) throw new Error('expected an element');
    expect(fresh.element.token).toBe('new-0');
  });

  it('leaves the observations of other windows alone', () => {
    const registry = new ObservationRegistry();
    registry.record({ observationId: 'snap-a', pid: PID, windowId: WINDOW, elements: elements(2) });
    registry.record({ observationId: 'snap-b', pid: PID, windowId: 7777, elements: elements(2) });
    // Re-observing one window must not invalidate the other.
    registry.record({ observationId: 'snap-c', pid: PID, windowId: 7777, elements: elements(2) });

    expect('element' in registry.resolve('snap-a', 'e1')).toBe(true);
    expect('error' in registry.resolve('snap-b', 'e1')).toBe(true);
    expect('element' in registry.resolve('snap-c', 'e1')).toBe(true);
  });

  it('treats the same window id in a different process as a different window', () => {
    const registry = new ObservationRegistry();
    registry.record({ observationId: 'snap-1', pid: PID, windowId: WINDOW, elements: elements(1) });
    registry.record({ observationId: 'snap-2', pid: 777, windowId: WINDOW, elements: elements(1) });
    expect('element' in registry.resolve('snap-1', 'e1')).toBe(true);
  });
});

// A stale ref's refusal is not always the end: what the ref pointed at is
// remembered, so a Jev re-bind can match it against the current rows.
describe('remembering what a superseded observation held', () => {
  it('hands back a stale element with the window\'s current observation', () => {
    const registry = new ObservationRegistry();
    registry.record({ observationId: 'snap-1', pid: PID, windowId: WINDOW, elements: elements(3, 'old') });
    registry.record({ observationId: 'snap-2', pid: PID, windowId: WINDOW, elements: elements(3, 'new') });

    const stale = registry.staleElement('snap-1', 'e2');
    expect(stale?.element.token).toBe('old-1');
    expect(stale?.current.observationId).toBe('snap-2');
  });

  it('knows nothing of a current id, an unknown id, or a ref that never was', () => {
    const registry = new ObservationRegistry();
    registry.record({ observationId: 'snap-1', pid: PID, windowId: WINDOW, elements: elements(2) });
    expect(registry.staleElement('snap-1', 'e1')).toBeNull();
    registry.record({ observationId: 'snap-2', pid: PID, windowId: WINDOW, elements: elements(2) });
    expect(registry.staleElement('snap-1', 'e99')).toBeNull();
    expect(registry.staleElement('snap-made-up', 'e1')).toBeNull();
    expect(registry.staleElement(undefined, 'e1')).toBeNull();
  });

  it('keeps only the previous observation, not the whole history', () => {
    const registry = new ObservationRegistry();
    registry.record({ observationId: 'snap-1', pid: PID, windowId: WINDOW, elements: elements(1) });
    registry.record({ observationId: 'snap-2', pid: PID, windowId: WINDOW, elements: elements(1) });
    registry.record({ observationId: 'snap-3', pid: PID, windowId: WINDOW, elements: elements(1) });
    expect(registry.staleElement('snap-1', 'e1')).toBeNull();
    expect(registry.staleElement('snap-2', 'e1')?.current.observationId).toBe('snap-3');
  });
});

describe('rejecting refs Buddy never issued', () => {
  it('refuses an unknown observationId with STALE_OBSERVATION', () => {
    const registry = new ObservationRegistry();
    registry.record({ observationId: 'snap-1', pid: PID, windowId: WINDOW, elements: elements(1) });
    const guessed = registry.resolve('snap-made-up', 'e1');
    expect('error' in guessed && guessed.error.code).toBe('STALE_OBSERVATION');
  });

  it('refuses a missing observationId as INVALID_REQUEST', () => {
    const registry = new ObservationRegistry();
    registry.record({ observationId: 'snap-1', pid: PID, windowId: WINDOW, elements: elements(1) });
    for (const value of [undefined, null, '', 7]) {
      const result = registry.resolve(value, 'e1');
      expect('error' in result && result.error.code, String(value)).toBe('INVALID_REQUEST');
    }
  });

  it('refuses a ref the observation does not contain', () => {
    const registry = new ObservationRegistry();
    registry.record({ observationId: 'snap-1', pid: PID, windowId: WINDOW, elements: elements(2) });
    const result = registry.resolve('snap-1', 'e99');
    expect('error' in result && result.error.code).toBe('INVALID_REQUEST');
    expect('error' in result && result.error.detail).toContain('e99');
  });

  it('refuses a malformed ref', () => {
    const registry = new ObservationRegistry();
    registry.record({ observationId: 'snap-1', pid: PID, windowId: WINDOW, elements: elements(2) });
    for (const value of [undefined, null, '', 3]) {
      const result = registry.resolve('snap-1', value);
      expect('error' in result && result.error.code, String(value)).toBe('INVALID_REQUEST');
    }
  });
});
