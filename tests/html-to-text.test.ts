import { describe, expect, it } from 'vitest';
import { htmlToText } from '../src/main/reader/web';

describe('htmlToText', () => {
  it('strips tags and scripts, keeps readable text', () => {
    const html = `
      <html><head><style>p{color:red}</style><script>alert(1)</script></head>
      <body>
        <h1>Title</h1>
        <p>Hello&nbsp;world.</p>
        <ul><li>One</li><li>Two</li></ul>
      </body></html>
    `;
    const text = htmlToText(html);
    expect(text).toContain('Title');
    expect(text).toContain('Hello world.');
    expect(text).toContain('• One');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
  });

  it('decodes numeric entities', () => {
    expect(htmlToText('&#39;quoted&#x21;')).toBe("'quoted!");
  });
});
