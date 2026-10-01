import { describe, expect, it } from 'vitest';
import { createTapCounter, type TapEvent } from '../src/main/tap-counter';

/** Build a quick tap (down+up) of Control at the given start time. */
function tap(start: number, holdMs = 80): TapEvent[] {
  return [
    { type: 'down', isControl: true, time: start },
    { type: 'up', isControl: true, time: start + holdMs },
  ];
}

/** The count each event completes; a double-tap shows as a 2 on the second tap-up. */
function feed(events: TapEvent[]): number[] {
  const counter = createTapCounter();
  return events.map((e) => counter.handle(e));
}

describe('tap counter', () => {
  it('counts a fast double-tap on the second key-up', () => {
    expect(feed([...tap(0), ...tap(200)])).toEqual([0, 1, 0, 2]);
  });

  it('starts over when taps are too far apart', () => {
    // A 500ms gap between tap end and next tap start exceeds the 400ms limit.
    expect(feed([...tap(0), ...tap(580)])).toEqual([0, 1, 0, 1]);
  });

  it('reset makes the next tap the first again', () => {
    const counter = createTapCounter();
    const results = [...tap(0), ...tap(200)].map((e) => counter.handle(e));
    expect(results[3]).toBe(2);
    counter.reset();
    expect(tap(400).map((e) => counter.handle(e))).toEqual([0, 1]);
  });

  it('resets when another key interrupts the sequence', () => {
    const results = feed([
      ...tap(0),
      { type: 'down', isControl: false, time: 150 },
      { type: 'up', isControl: false, time: 200 },
      ...tap(250), // would be tap 2, but the sequence was reset
    ]);
    expect(results).not.toContain(2);
  });

  it('does not count Control held too long as a tap', () => {
    const results = feed([
      ...tap(0),
      { type: 'down', isControl: true, time: 200 },
      { type: 'up', isControl: true, time: 600 }, // 400ms hold > 250ms limit
    ]);
    expect(results).not.toContain(2);
  });

  it('never counts the hold-to-talk chord as taps', () => {
    // Control down, then Alt joins (the chord), hold, release both. Repeated
    // quickly — still no double-tap.
    const chord = (start: number): TapEvent[] => [
      { type: 'down', isControl: true, time: start },
      { type: 'down', isControl: false, time: start + 20 },
      { type: 'up', isControl: false, time: start + 100 },
      { type: 'up', isControl: true, time: start + 120 },
    ];
    expect(feed([...chord(0), ...chord(300)])).not.toContain(2);
  });

  it('ignores modifiers already held when Control goes down', () => {
    // Alt is held the whole time (e.g. user Alt-tabbing with Control taps
    // mixed in); the OS flags on each Control event say so.
    const withAlt = (events: TapEvent[]): TapEvent[] =>
      events.map((event) => ({ ...event, otherModifierDown: true }));
    const results = feed([
      { type: 'down', isControl: false, time: 0 },
      ...withAlt(tap(100)),
      ...withAlt(tap(300)),
    ]);
    expect(results.every((count) => count === 0)).toBe(true);
  });

  it('survives a missed key-up: a ghost held key must not disable taps forever', () => {
    // uiohook drops events under synthetic typing. A keydown whose keyup was
    // lost (flags clear by the time the taps happen) must not poison every
    // later sequence.
    const results = feed([
      { type: 'down', isControl: false, time: 0 }, // its keyup never arrives
      ...tap(1000),
      ...tap(1200),
    ]);
    expect(results[4]).toBe(2);
  });
});
