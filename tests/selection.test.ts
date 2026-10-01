import { describe, expect, it } from 'vitest';
import { isDoubleClick, isDragSelect } from '../src/main/selection-gesture';

describe('isDragSelect', () => {
  it('requires a move of at least 8px', () => {
    const down = { x: 10, y: 10, t: 0 };
    expect(isDragSelect(down, { x: 14, y: 14, t: 100 })).toBe(false);
    expect(isDragSelect(down, { x: 20, y: 10, t: 100 })).toBe(true);
  });
});

describe('isDoubleClick', () => {
  it('matches a second click nearby and soon', () => {
    const first = { x: 50, y: 50, t: 1000 };
    expect(isDoubleClick(first, { x: 52, y: 51, t: 1300 })).toBe(true);
    expect(isDoubleClick(first, { x: 52, y: 51, t: 1600 })).toBe(false);
    expect(isDoubleClick(first, { x: 80, y: 50, t: 1100 })).toBe(false);
    expect(isDoubleClick(null, { x: 50, y: 50, t: 1000 })).toBe(false);
  });
});
