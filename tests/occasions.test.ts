import { describe, expect, it } from 'vitest';
import { upcomingOccasions } from '../src/shared/occasions';

describe('upcomingOccasions', () => {
  it('includes a holiday inside the window and leaves the next one out', () => {
    const lines = upcomingOccasions(new Date(2026, 8, 27), 45);
    expect(lines.some((line) => line.endsWith('Halloween'))).toBe(true);
    expect(lines.some((line) => line.endsWith('Thanksgiving'))).toBe(false);
    expect(lines.some((line) => line.endsWith('Labor Day'))).toBe(false);
  });
});
