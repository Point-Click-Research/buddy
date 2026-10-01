import { describe, expect, it } from 'vitest';
import { parseMarkdown, splitBareLinks } from '../src/renderer/shared/markdown';

function parts(text: string) {
  const block = parseMarkdown(text)[0];
  if (!block || block.kind !== 'text') throw new Error('expected text');
  return block.lines.map((line) => line.parts);
}

describe('parseMarkdown links', () => {
  it('keeps a markdown link', () => {
    expect(parts('See [the sheet](https://docs.google.com/spreadsheets/d/abc)')).toEqual([
      [
        { kind: 'text', body: 'See ' },
        { kind: 'link', label: 'the sheet', url: 'https://docs.google.com/spreadsheets/d/abc' },
      ],
    ]);
  });

  it('treats a bare URL as a link', () => {
    const url = 'https://docs.google.com/spreadsheets/d/1X-FmtfC/edit';
    expect(parts(`Here it is:\n${url}`)).toEqual([
      [{ kind: 'text', body: 'Here it is:' }],
      [{ kind: 'link', label: url, url }],
    ]);
  });

  it('leaves punctuation after the URL as text', () => {
    expect(parts('Go to https://example.com/a.')).toEqual([
      [
        { kind: 'text', body: 'Go to ' },
        { kind: 'link', label: 'https://example.com/a', url: 'https://example.com/a' },
        { kind: 'text', body: '.' },
      ],
    ]);
  });

  it('keeps a parenthesis the URL itself opened', () => {
    const url = 'https://en.wikipedia.org/wiki/Buddy_(software)';
    expect(parts(url)).toEqual([[{ kind: 'link', label: url, url }]]);
  });

  it('splits bare URLs out of plain text', () => {
    expect(splitBareLinks('See https://example.com/a, then https://example.com/b.')).toEqual([
      { kind: 'text', body: 'See ' },
      { kind: 'link', url: 'https://example.com/a' },
      { kind: 'text', body: ', then ' },
      { kind: 'link', url: 'https://example.com/b' },
      { kind: 'text', body: '.' },
    ]);
  });

  it('does not link a URL inside code', () => {
    expect(parts('Run `https://example.com` now')).toEqual([
      [
        { kind: 'text', body: 'Run ' },
        { kind: 'code', body: 'https://example.com' },
        { kind: 'text', body: ' now' },
      ],
    ]);
  });
});
