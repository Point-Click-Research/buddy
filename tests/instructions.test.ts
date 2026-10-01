import { describe, expect, it } from 'vitest';
import {
  hasBlanks,
  instructionsForModel,
  parseInstructions,
  refToken,
  toolRefs,
} from '../src/shared/instructions';

describe('job instructions', () => {
  const text = 'Check [Gmail](app:gmail) for [store], then text me with [Messages](tool:messages).';

  it('splits references, blanks, and text, and joins back to the same string', () => {
    const parts = parseInstructions(text);
    expect(parts.map((part) => part.kind)).toEqual(['text', 'ref', 'text', 'blank', 'text', 'ref', 'text']);
    expect(parts[1]).toMatchObject({ source: 'app', id: 'gmail', label: 'Gmail' });
    expect(parts[3]).toMatchObject({ hint: 'store' });
    const joined = parts.map((part) => (part.kind === 'text' ? part.text : part.raw)).join('');
    expect(joined).toBe(text);
  });

  it('leaves an ordinary markdown link as a blank plus text, never a reference', () => {
    const parts = parseInstructions('see [docs](https://example.com)');
    expect(parts.some((part) => part.kind === 'ref')).toBe(false);
  });

  it('builds tokens the parser reads back, stripping brackets from labels', () => {
    const token = refToken('mcp', 'bland', 'Bland [phone]');
    expect(token).toBe('[Bland phone](mcp:bland)');
    expect(parseInstructions(token)[0]).toMatchObject({ kind: 'ref', source: 'mcp', id: 'bland' });
  });

  it('finds the Mac tools named and whether blanks remain', () => {
    expect(toolRefs(text)).toEqual(['messages']);
    expect(hasBlanks(text)).toBe(true);
    expect(hasBlanks('Check [Gmail](app:gmail).')).toBe(false);
  });

  it('writes references out in words for the model', () => {
    expect(instructionsForModel(text)).toBe(
      'Check Gmail (the connected app "gmail") for [store], then text me with Messages.',
    );
    expect(instructionsForModel('Book [Resy](site:resy.com) for [date].')).toBe(
      "Book Resy (in Buddy's browser at resy.com) for [date].",
    );
  });
});
