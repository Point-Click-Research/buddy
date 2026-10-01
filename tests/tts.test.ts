import { describe, expect, it } from 'vitest';
import { extractSentences, toSpokenText } from '../src/main/speech/sentences';

describe('extractSentences', () => {
  it('extracts complete sentences and keeps the growing tail', () => {
    const { sentences, rest } = extractSentences('First one. Second one! And a third');
    expect(sentences).toEqual(['First one.', 'Second one!']);
    expect(rest).toBe(' And a third');
  });

  it('holds punctuation at the end of the buffer (more text may arrive)', () => {
    const { sentences, rest } = extractSentences('Wait for it.');
    expect(sentences).toEqual([]);
    expect(rest).toBe('Wait for it.');
  });

  it('does not split on abbreviations', () => {
    const { sentences } = extractSentences('Ask Dr. Smith about it. Then come back. ');
    expect(sentences).toEqual(['Ask Dr. Smith about it.', 'Then come back.']);
  });

  it('does not split decimals or versions', () => {
    const { sentences, rest } = extractSentences('Pi is 3.14 which is neat. Also v2.5 exists ');
    expect(sentences).toEqual(['Pi is 3.14 which is neat.']);
    expect(rest).toBe(' Also v2.5 exists ');
  });

  it('does not split single-letter initials', () => {
    const { sentences } = extractSentences('Meet J. Smith today. Bye. ');
    expect(sentences).toEqual(['Meet J. Smith today.', 'Bye.']);
  });

  it('keeps closing quotes with the sentence', () => {
    const { sentences } = extractSentences('He said "stop." Then left. '); 
    expect(sentences[0]).toBe('He said "stop."');
  });

  it('handles question marks and exclamations', () => {
    const { sentences } = extractSentences('Ready? Go! Now then ');
    expect(sentences).toEqual(['Ready?', 'Go!']);
  });

  it('never splits inside a code fence, whatever punctuation the code has', () => {
    const block = '```js\nconst x = ok ? a.b : c; // done. Really.\n```\n';
    const { sentences, rest } = extractSentences(`Here is the fix:\n${block}Then retry. `);
    expect(sentences).toEqual(['Here is the fix:', block.trim(), 'Then retry.']);
    expect(rest).toBe(' ');
  });

  it('holds an unfinished code block in rest until the closing fence', () => {
    const { sentences, rest } = extractSentences('One done. Now:\n```py\nprint("hi. bye?")\n');
    expect(sentences).toEqual(['One done.']);
    expect(rest).toBe(' Now:\n```py\nprint("hi. bye?")\n');
  });

  it('a complete code block becomes its own sentence', () => {
    const { sentences } = extractSentences('```\nfoo()\n```\nAnd after. ');
    expect(sentences).toEqual(['```\nfoo()\n```', 'And after.']);
  });

  it('triple backticks mid-line are not a fence', () => {
    const { sentences } = extractSentences('Use ``` to fence code. Simple. ');
    expect(sentences).toEqual(['Use ``` to fence code.', 'Simple.']);
  });
});

describe('toSpokenText', () => {
  it('strips markdown symbols', () => {
    expect(toSpokenText('This is **bold** and `code` and _italic_')).toBe(
      'This is bold and code and italic',
    );
  });

  it('shortens URLs to "a link"', () => {
    expect(toSpokenText('See https://example.com/docs?q=1 for info')).toBe(
      'See a link for info',
    );
  });

  it('keeps markdown link labels', () => {
    expect(toSpokenText('Open [the settings page](https://example.com)')).toBe(
      'Open the settings page',
    );
  });

  it('drops bullets and collapses whitespace', () => {
    expect(toSpokenText('- first\n- second\n\n  third')).toBe('first second third');
  });

  it('replaces code blocks', () => {
    expect(toSpokenText('Run this: ```npm install``` then retry')).toBe(
      'Run this: code omitted then retry',
    );
  });
});
