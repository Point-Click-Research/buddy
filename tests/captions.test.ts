import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCaptionPacer } from '../src/main/speech/captions';

describe('caption pacer', () => {
  let shown: string[];
  const text = (): string => shown.join('');

  beforeEach(() => {
    vi.useFakeTimers();
    shown = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const pacer = () => createCaptionPacer((chunk) => shown.push(chunk));

  it('shows the first word immediately and the rest over time', () => {
    const p = pacer();
    p.push('Hello there friend ');
    expect(text()).toBe('Hello ');
    vi.runAllTimers();
    expect(text()).toBe('Hello there friend ');
  });

  it('keeps whitespace lossless across word chunks', () => {
    const p = pacer();
    p.push('One,  two.\nThree ');
    vi.runAllTimers();
    expect(text()).toBe('One,  two.\nThree ');
  });

  it('pushing the next sentence flushes what the estimate left behind', () => {
    const p = pacer();
    p.push('A very long opening sentence ');
    p.push('Next ');
    // Everything from sentence one is up before sentence two starts.
    expect(text()).toBe('A very long opening sentence Next ');
  });

  it('flush shows the remainder at once', () => {
    const p = pacer();
    p.push('One two three ');
    p.flush();
    expect(text()).toBe('One two three ');
    vi.runAllTimers();
    expect(text()).toBe('One two three '); // nothing double-shown
  });

  it('shows a code block whole instead of pacing it word by word', () => {
    const p = pacer();
    p.push('```js\nconst x = 1;\nconst y = 2;\n``` ');
    // The voice says "code omitted", not the code — nothing to pace along to.
    expect(text()).toBe('```js\nconst x = 1;\nconst y = 2;\n``` ');
    vi.runAllTimers();
    expect(text()).toBe('```js\nconst x = 1;\nconst y = 2;\n``` '); // nothing double-shown
  });

  it('stop drops the remainder silently', () => {
    const p = pacer();
    p.push('One two three ');
    p.stop();
    vi.runAllTimers();
    expect(text()).toBe('One ');
  });
});
