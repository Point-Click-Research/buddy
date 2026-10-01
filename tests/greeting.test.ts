import { describe, expect, it } from 'vitest';
import { dayPart, GREET_AFTER_MS, withHello } from '../src/shared/greeting';

const at = (hour: number): Date => new Date(2026, 8, 30, hour);

describe('dayPart', () => {
  it('splits the day at noon and six', () => {
    expect(dayPart(at(9))).toBe('morning');
    expect(dayPart(at(12))).toBe('afternoon');
    expect(dayPart(at(18))).toBe('evening');
  });
});

describe('withHello', () => {
  it('opens with a hello after a quiet stretch, by the time of day', () => {
    expect(withHello('Nothing needs a reply.', GREET_AFTER_MS, at(9))).toBe('Morning! Nothing needs a reply.');
    expect(withHello('Nothing needs a reply.', GREET_AFTER_MS, at(15))).toBe('Hey! Nothing needs a reply.');
  });

  it('carries on plainly while the exchange is live', () => {
    expect(withHello('Done, that went through.', GREET_AFTER_MS - 1, at(9))).toBe('Done, that went through.');
  });
});
