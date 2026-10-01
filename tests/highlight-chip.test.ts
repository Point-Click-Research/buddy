import { describe, expect, it } from 'vitest';
import { highlightChipLabel } from '../src/main/highlight-chip';

describe('highlight chip label', () => {
  it('keeps a short highlight whole', () => {
    expect(highlightChipLabel('hello')).toBe('hello');
    expect(highlightChipLabel('12345678')).toBe('12345678');
  });

  it('shows the first four characters, then the last four', () => {
    expect(highlightChipLabel('benchmarks section')).toBe('benc…tion');
  });

  it('collapses newlines and surrounding space onto one line', () => {
    expect(highlightChipLabel('  abcd\nmiddle\nwxyz  ')).toBe('abcd…wxyz');
  });
});