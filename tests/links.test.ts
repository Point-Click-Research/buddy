import { describe, expect, it } from 'vitest';
import { extractLinks, isAllowedMailto, isOpenableUrl } from '../src/main/links';

describe('isOpenableUrl', () => {
  it('allows http and https', () => {
    expect(isOpenableUrl('https://example.com')).toBe(true);
    expect(isOpenableUrl('http://example.com/a?b=c#d')).toBe(true);
  });

  it('refuses anything else, however it is dressed up', () => {
    // Tool results are untrusted, so this is the whole security boundary.
    for (const url of [
      'file:///Users/me/.ssh/id_rsa',
      'javascript:alert(1)',
      'data:text/html,<script>x</script>',
      'mailto:someone@example.com',
      'buddy://settings',
      'not a url at all',
      '',
    ]) {
      expect(isOpenableUrl(url), url).toBe(false);
    }
  });
});

describe('isAllowedMailto', () => {
  it('allows feedback mail with optional subject and body', () => {
    expect(isAllowedMailto('mailto:feedback@thebuddyassistant.com')).toBe(true);
    expect(
      isAllowedMailto('mailto:feedback@thebuddyassistant.com?subject=Buddy%20feedback&body=Hi'),
    ).toBe(true);
  });

  it('refuses other recipients and non-mailto schemes', () => {
    expect(isAllowedMailto('mailto:support@thebuddyassistant.com')).toBe(false);
    expect(isAllowedMailto('mailto:feedback@evil.com')).toBe(false);
    expect(isAllowedMailto('https://thebuddyassistant.com')).toBe(false);
  });
});

describe('extractLinks', () => {
  it('finds links in plain text results', () => {
    const links = extractLinks('See https://example.com/a and http://other.org/b for more.');
    expect(links).toEqual(['https://example.com/a', 'http://other.org/b']);
  });

  it('reads the text blocks of a mixed result and ignores images', () => {
    const links = extractLinks([
      { type: 'text', text: 'Source: https://example.com/one' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
      { type: 'text', text: 'Also https://example.com/two' },
    ]);
    expect(links).toEqual(['https://example.com/one', 'https://example.com/two']);
  });

  it('drops sentence punctuation that is not part of the URL', () => {
    expect(extractLinks('Read https://example.com/page.')).toEqual(['https://example.com/page']);
    expect(extractLinks('(see https://example.com/page)')).toEqual(['https://example.com/page']);
    expect(extractLinks('"https://example.com/page",')).toEqual(['https://example.com/page']);
    // A trailing slash or a real path segment is left alone.
    expect(extractLinks('https://example.com/a/b')).toEqual(['https://example.com/a/b']);
  });

  it('keeps each link once, in the order it first appears', () => {
    const links = extractLinks('https://b.com then https://a.com then https://b.com again');
    expect(links).toEqual(['https://b.com', 'https://a.com']);
  });

  it('caps how many links one result can contribute', () => {
    const text = Array.from({ length: 30 }, (_, i) => `https://example.com/${i}`).join(' ');
    expect(extractLinks(text).length).toBe(12);
    expect(extractLinks(text, 3)).toEqual([
      'https://example.com/0',
      'https://example.com/1',
      'https://example.com/2',
    ]);
  });

  it('returns nothing for a result with no links', () => {
    expect(extractLinks('The answer is 42.')).toEqual([]);
    expect(extractLinks('Try file:///etc/passwd')).toEqual([]);
  });
});
