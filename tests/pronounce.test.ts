import { describe, expect, it } from 'vitest';
import { applyPronunciations } from '../src/main/speech/pronounce';

const RULES = [
  { text: '°F', spoken: 'degrees Fahrenheit' },
  { text: 'mph', spoken: 'miles per hour' },
];

describe('pronunciations', () => {
  it('replaces a symbol form, spacing it off an adjacent number', () => {
    expect(applyPronunciations("It's 70°F outside.", RULES)).toBe(
      "It's 70 degrees Fahrenheit outside.",
    );
  });

  it('replaces a lowercase rule in any case', () => {
    expect(applyPronunciations('Doing 60mph, then 80 MPH.', RULES)).toBe(
      'Doing 60 miles per hour, then 80 miles per hour.',
    );
  });

  it('never rewrites the middle of a word', () => {
    expect(applyPronunciations('Driving through Memphis.', RULES)).toBe(
      'Driving through Memphis.',
    );
  });

  it('a rule with capitals matches exactly', () => {
    const rules = [{ text: 'US', spoken: 'United States' }];
    expect(applyPronunciations('The US said: trust us.', rules)).toBe(
      'The United States said: trust us.',
    );
  });

  it('escapes regex specials in the written form', () => {
    const rules = [{ text: 'C++', spoken: 'C plus plus' }];
    expect(applyPronunciations('Written in C++.', rules)).toBe('Written in C plus plus.');
  });

  it('ignores empty rules and leaves other text alone', () => {
    expect(applyPronunciations('Nothing to change.', [{ text: ' ', spoken: 'x' }])).toBe(
      'Nothing to change.',
    );
  });
});
