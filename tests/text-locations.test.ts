// Located text: normalized OCR boxes become screen DIP, refs resolve until
// enough newer locations push them out, and malformed script output is kept
// out of the registry.

import { describe, expect, it } from 'vitest';
import { TextLocationRegistry } from '../src/main/computer/text-locations';
import { parseMatches } from '../src/main/reader/ocr';

// A second display to the right of a 1512-wide primary, so a wrong conversion
// that ignores the display origin is caught.
const display = { id: 202, bounds: { x: 1512, y: 0, width: 1920, height: 1080 } };

const match = { line: 'const total = useState(0);', x: 0.25, y: 0.5, w: 0.1, h: 0.02 };

describe('TextLocationRegistry', () => {
  it('converts a normalized match to global screen DIP on its display', () => {
    const registry = new TextLocationRegistry();
    const { observationId, matches } = registry.record([match], display);

    expect(matches).toHaveLength(1);
    expect(matches[0]!.ref).toBe('t1');
    expect(matches[0]!.rect).toEqual({ x: 1512 + 480, y: 540, width: 192, height: 21.6 });
    expect(registry.box(observationId, 't1')).toEqual({
      displayId: 202,
      rect: matches[0]!.rect,
    });
  });

  it('refs count up per observation and unknown ids resolve to null', () => {
    const registry = new TextLocationRegistry();
    const { observationId } = registry.record([match, { ...match, y: 0.6 }], display);

    expect(registry.box(observationId, 't2')).not.toBeNull();
    expect(registry.box(observationId, 't3')).toBeNull();
    expect(registry.box('someone-elses-observation', 't1')).toBeNull();
    expect(registry.box(undefined, 't1')).toBeNull();
  });

  it('lets the oldest observation go once enough newer ones arrive', () => {
    const registry = new TextLocationRegistry();
    const first = registry.record([match], display);
    for (let i = 0; i < 8; i++) registry.record([match], display);

    expect(registry.box(first.observationId, 't1')).toBeNull();
  });
});

describe('parseMatches', () => {
  it('keeps well-formed matches and drops the rest', () => {
    const stdout = JSON.stringify([
      match,
      { line: 'missing a coordinate', x: 0.1, y: 0.2, w: 0.3 },
      { line: 42, x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      'not an object',
    ]);
    expect(parseMatches(stdout)).toEqual([match]);
  });

  it('returns nothing for output that is not a JSON array', () => {
    expect(parseMatches('')).toEqual([]);
    expect(parseMatches('osascript groaned')).toEqual([]);
    expect(parseMatches('{"line":"x"}')).toEqual([]);
  });
});
