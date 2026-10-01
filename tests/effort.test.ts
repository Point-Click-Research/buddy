import { describe, expect, it } from 'vitest';
import { reasoningEffort, resolveEffort } from '../src/main/ai/effort';

describe('resolveEffort', () => {
  it('uses low for a spoken answer and medium for longer work', () => {
    expect(resolveEffort('auto', 'answer')).toBe('low');
    expect(resolveEffort('auto', 'task')).toBe('medium');
  });

  it('sends an explicit choice unchanged', () => {
    expect(resolveEffort('high', 'answer')).toBe('high');
    expect(resolveEffort('max', 'task')).toBe('max');
  });
});

describe('reasoningEffort', () => {
  it("passes OpenRouter's levels through and lands max on xhigh", () => {
    expect(reasoningEffort('low')).toBe('low');
    expect(reasoningEffort('xhigh')).toBe('xhigh');
    expect(reasoningEffort('max')).toBe('xhigh');
    expect(reasoningEffort(undefined)).toBeUndefined();
  });
});
