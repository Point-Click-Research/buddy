// How Buddy says the hard-to-read bits: user-defined written → spoken
// replacements ("°F" → "degrees Fahrenheit"), applied to the text sent for
// synthesis and never to the caption — the screen keeps the written form
// while the voice reads the spoken one. Pure module: fully unit-testable.

import type { Pronunciation } from '../../shared/types';

export function applyPronunciations(text: string, rules: Pronunciation[]): string {
  let result = text;
  for (const rule of rules) {
    const written = rule.text.trim();
    const spoken = rule.spoken.trim();
    if (!written || !spoken) continue;
    // Space-padded so "70°F" reads "70 degrees Fahrenheit", not "70degrees…";
    // the collapse below tidies any doubles this creates.
    result = result.replace(unitMatcher(written), ` ${spoken} `);
  }
  // Collapse the padding's doubles, and close the gap it leaves before
  // punctuation ("miles per hour ." reads as a pause).
  return result
    .replace(/\s+/g, ' ')
    .replace(/ ([.,;:!?)\]])/g, '$1')
    .trim();
}

/**
 * A matcher that finds the written form as a unit: no letter may touch
 * either lettered edge, so "mph" never rewrites Memphis — while "60mph"
 * still counts, digits being how these forms usually arrive. Lowercase
 * forms match any case ("mph" catches MPH); one with capitals is exact,
 * unless `ignoreCase` forces looseness. Shared with transcript corrections.
 */
export function unitMatcher(written: string, ignoreCase = false): RegExp {
  const escaped = written.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const left = /^\p{L}/u.test(written) ? '(?<!\\p{L})' : '';
  const right = /\p{L}$/u.test(written) ? '(?!\\p{L})' : '';
  const flags = ignoreCase || !/\p{Lu}/u.test(written) ? 'giu' : 'gu';
  return new RegExp(`${left}${escaped}${right}`, flags);
}
