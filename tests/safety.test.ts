import { describe, expect, it } from 'vitest';
import { AgentMouseTracker, SyntheticKeyFilter } from '../src/main/agent/synthetic';

const ESCAPE = 1; // uiohook keycode

describe('SyntheticKeyFilter (kill-switch filter)', () => {
  it('ignores an observed event matching a recorded synthetic event', () => {
    const filter = new SyntheticKeyFilter();
    filter.record(ESCAPE, 'down', 1000);
    expect(filter.shouldIgnore(ESCAPE, 'down', 1050)).toBe(true);
  });

  it('consumes the recording: a second identical event is real', () => {
    const filter = new SyntheticKeyFilter();
    filter.record(ESCAPE, 'down', 1000);
    expect(filter.shouldIgnore(ESCAPE, 'down', 1050)).toBe(true);
    // The user pressing Escape right after the agent did must NOT be ignored.
    expect(filter.shouldIgnore(ESCAPE, 'down', 1100)).toBe(false);
  });

  it('matches down and up independently', () => {
    const filter = new SyntheticKeyFilter();
    filter.record(ESCAPE, 'down', 1000);
    expect(filter.shouldIgnore(ESCAPE, 'up', 1050)).toBe(false);
    expect(filter.shouldIgnore(ESCAPE, 'down', 1060)).toBe(true);
  });

  it('expires recordings outside the window', () => {
    const filter = new SyntheticKeyFilter(500);
    filter.record(ESCAPE, 'down', 1000);
    expect(filter.shouldIgnore(ESCAPE, 'down', 1600)).toBe(false);
  });

  it('does not ignore other keycodes', () => {
    const filter = new SyntheticKeyFilter();
    filter.record(30, 'down', 1000); // "a"
    expect(filter.shouldIgnore(ESCAPE, 'down', 1010)).toBe(false);
    expect(filter.shouldIgnore(30, 'down', 1020)).toBe(true);
  });

  it('handles a burst of synthetic events (a key combo) in order', () => {
    const filter = new SyntheticKeyFilter();
    for (const code of [3675, 42, 20]) filter.record(code, 'down', 1000); // cmd+shift+t
    for (const code of [3675, 42, 20]) filter.record(code, 'up', 1000);
    for (const code of [3675, 42, 20]) expect(filter.shouldIgnore(code, 'down', 1030)).toBe(true);
    for (const code of [20, 42, 3675]) expect(filter.shouldIgnore(code, 'up', 1060)).toBe(true);
    expect(filter.shouldIgnore(3675, 'down', 1080)).toBe(false); // all consumed
  });

  it('tracks the raw-typing window', () => {
    const filter = new SyntheticKeyFilter();
    filter.markTyping(2000);
    expect(filter.isTyping(1500)).toBe(true);
    expect(filter.isTyping(2500)).toBe(false);
  });

  it('reset clears recordings and the typing window', () => {
    const filter = new SyntheticKeyFilter();
    filter.record(ESCAPE, 'down', 1000);
    filter.markTyping(5000);
    filter.reset();
    expect(filter.shouldIgnore(ESCAPE, 'down', 1010)).toBe(false);
    expect(filter.isTyping(1010)).toBe(false);
  });
});

describe('AgentMouseTracker (takeover detection)', () => {
  it('flags a cursor position far from where the agent put it', () => {
    const tracker = new AgentMouseTracker(30);
    tracker.recordPosition(100, 100);
    expect(tracker.isUserMove(105, 108, 1000)).toBe(false); // wiggle
    expect(tracker.isUserMove(150, 150, 1000)).toBe(true); // grabbed
  });

  it('never flags before the agent has positioned the mouse', () => {
    const tracker = new AgentMouseTracker(30);
    expect(tracker.isUserMove(500, 500, 1000)).toBe(false);
  });

  it('excuses movement during a driver animation window', () => {
    const tracker = new AgentMouseTracker(30);
    tracker.recordPosition(100, 100);
    tracker.markActivity(2000);
    expect(tracker.isUserMove(400, 400, 1500)).toBe(false); // mid-drag
    expect(tracker.isUserMove(400, 400, 2500)).toBe(true); // window over
  });
});
