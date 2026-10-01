import { describe, expect, it } from 'vitest';
import {
  LINK_MARK_COLORS,
  linkHost,
  linkInitial,
  linkLabel,
  linkMarkColor,
} from '../src/shared/link-text';

describe('linkHost', () => {
  it('drops the scheme, www and path', () => {
    expect(linkHost('https://www.example.com/a/b?c=d')).toBe('example.com');
    expect(linkHost('http://docs.example.co.uk/page')).toBe('docs.example.co.uk');
    expect(linkHost('https://example.com')).toBe('example.com');
  });
});

describe('linkLabel', () => {
  it('keeps the path but drops the noise', () => {
    expect(linkLabel('https://www.example.com/some-article')).toBe('example.com/some-article');
    expect(linkLabel('https://example.com/')).toBe('example.com');
  });

  it('truncates to fit, counting the ellipsis', () => {
    const label = linkLabel('https://example.com/a-very-long-path-that-keeps-going-and-going', 20);
    expect(label).toHaveLength(20);
    expect(label.endsWith('…')).toBe(true);
  });

  it('leaves a label that already fits alone', () => {
    expect(linkLabel('https://example.com/a', 40)).toBe('example.com/a');
  });
});

describe('linkInitial', () => {
  it('is the first letter, upper case', () => {
    expect(linkInitial('example.com')).toBe('E');
    expect(linkInitial('')).toBe('?');
  });
});

describe('linkMarkColor', () => {
  it('always returns a colour from the palette', () => {
    for (const host of ['example.com', 'a', 'news.ycombinator.com', '']) {
      expect(LINK_MARK_COLORS).toContain(linkMarkColor(host));
    }
  });

  it('gives one site the same colour every time', () => {
    expect(linkMarkColor('example.com')).toBe(linkMarkColor('example.com'));
  });
});
