import { describe, expect, it } from 'vitest';
import {
  autoRunCap,
  pickRandomHour,
  RANDOM_HOURS,
  slotHours,
  suggestionTimeFor,
  suggestionTimesFor,
  suggestionsDue,
} from '../src/shared/suggestions';

const at = (hour: number, minute = 0, day = 28): Date => new Date(2026, 8, day, hour, minute);
const yesterday = at(9, 5, 27).getTime();

describe('when suggestions are due', () => {
  it('runs once the hour passes, and once per slot', () => {
    expect(suggestionsDue([9], yesterday, at(8, 59))).toBe(false);
    expect(suggestionsDue([9], yesterday, at(9))).toBe(true);
    expect(suggestionsDue([9], at(9, 1).getTime(), at(15))).toBe(false);
  });

  it('catches a slot the Mac slept through, once', () => {
    expect(suggestionsDue([9], yesterday, at(19))).toBe(true);
    expect(suggestionsDue([9], at(19).getTime(), at(19, 1))).toBe(false);
  });

  it('twice a day is two slots; a late catch-up covers both', () => {
    const twice = [9, 18];
    expect(suggestionsDue(twice, at(9, 1).getTime(), at(12))).toBe(false);
    expect(suggestionsDue(twice, at(9, 1).getTime(), at(18))).toBe(true);
    expect(suggestionsDue(twice, yesterday, at(19))).toBe(true);
    expect(suggestionsDue(twice, at(19).getTime(), at(19, 1))).toBe(false);
  });

  it('a change of When applies to the next slot not yet run', () => {
    // Ran the morning, then switched to afternoon at 2 PM.
    expect(suggestionsDue([16], at(9, 1).getTime(), at(14))).toBe(false);
    expect(suggestionsDue([16], at(9, 1).getTime(), at(16))).toBe(true);
  });
});

describe('the random slot', () => {
  it('lands in the waking day', () => {
    expect(pickRandomHour(() => 0)).toBe(RANDOM_HOURS.min);
    expect(pickRandomHour(() => 0.999)).toBe(RANDOM_HOURS.max);
  });

  it('is asked for only when random is the choice', () => {
    let asked = 0;
    const random = (): number => {
      asked += 1;
      return 13;
    };
    expect(slotHours('twice', random)).toEqual([9, 18]);
    expect(asked).toBe(0);
    expect(slotHours('random', random)).toEqual([13]);
    expect(asked).toBe(1);
  });
});

describe('what the plan allows', () => {
  it('free has one pass a day; a saved twice runs the morning and stays saved', () => {
    expect(suggestionTimesFor('free').map((time) => time.id)).not.toContain('twice');
    expect(suggestionTimesFor('early').map((time) => time.id)).toContain('twice');
    expect(suggestionTimesFor(null).map((time) => time.id)).toContain('twice');
    expect(suggestionTimeFor('twice', 'free')).toBe('morning');
    expect(suggestionTimeFor('evening', 'free')).toBe('evening');
    expect(suggestionTimeFor('twice', 'pro')).toBe('twice');
  });

  it('runs no safe idea on free, the first on a paid plan billing Buddy, all otherwise', () => {
    expect(autoRunCap('free', false)).toBe(0);
    expect(autoRunCap('pro', false)).toBe(1);
    expect(autoRunCap('max', false)).toBe(1);
    expect(autoRunCap('pro', true)).toBe(Infinity);
    expect(autoRunCap('free', true)).toBe(Infinity);
    expect(autoRunCap('early', false)).toBe(Infinity);
    expect(autoRunCap('waitlist', false)).toBe(Infinity);
    expect(autoRunCap(null, false)).toBe(Infinity);
  });
});
