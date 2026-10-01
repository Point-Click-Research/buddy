import { describe, expect, it } from 'vitest';
import { insertMarkTokens, markToken, type WordTiming } from '../src/main/marks/transcript';

const words: WordTiming[] = [
  { word: 'move', startMs: 0, endMs: 400 },
  { word: 'this', startMs: 450, endMs: 800 },
  { word: 'over', startMs: 900, endMs: 1200 },
  { word: 'there', startMs: 1300, endMs: 1700 },
];

describe('insertMarkTokens', () => {
  it('places each mark right after the word being spoken when it finished', () => {
    const result = insertMarkTokens(
      'move this over there',
      words,
      [
        { number: 1, endMs: 850 }, // finished just after "this"
        { number: 2, endMs: 1750 }, // finished after "there"
      ],
      2000,
    );
    expect(result.text).toBe('move this ⟦mark 1⟧ over there ⟦mark 2⟧');
    expect(result.approximate).toBe(false);
  });

  it('maps proportionally when corrections changed the token count', () => {
    // The transcript gained a token ("right over"), so counts differ.
    const result = insertMarkTokens('move this right over there', words, [{ number: 1, endMs: 850 }], 2000);
    expect(result.text).toContain(markToken(1));
    expect(result.approximate).toBe(false);
  });

  it('places marks proportionally by time without word timestamps', () => {
    const result = insertMarkTokens(
      'move this over there',
      null,
      [{ number: 1, endMs: 1000 }],
      2000, // halfway through a four-word recording -> after word two
    );
    expect(result.text).toBe('move this ⟦mark 1⟧ over there');
    expect(result.approximate).toBe(true);
  });

  it('turns a silent turn with marks into the "What is this?" question', () => {
    const result = insertMarkTokens('', null, [{ number: 1, endMs: 500 }, { number: 2, endMs: 900 }], 1000);
    expect(result.text).toBe('What is this? ⟦mark 1⟧ ⟦mark 2⟧');
  });

  it('leaves the transcript alone when there are no marks', () => {
    const result = insertMarkTokens('hello there', words, [], 2000);
    expect(result.text).toBe('hello there');
  });

  it('clamps marks finished after the last word to the end', () => {
    const result = insertMarkTokens('move this', null, [{ number: 1, endMs: 99_999 }], 2000);
    expect(result.text).toBe('move this ⟦mark 1⟧');
  });

  it('keeps multiple marks at the same spot in drawing order', () => {
    const result = insertMarkTokens(
      'move this over there',
      words,
      [
        { number: 2, endMs: 820 },
        { number: 1, endMs: 810 },
      ],
      2000,
    );
    expect(result.text).toBe('move this ⟦mark 1⟧ ⟦mark 2⟧ over there');
  });
});
