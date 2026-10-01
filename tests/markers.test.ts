// Reveal markers. The stream can split anywhere — including between the two
// brackets of [[roof]] — and the caption must never show a marker, whole or
// in pieces.

import { describe, expect, it } from 'vitest';
import { createMarkerStream, markersIn, stripMarkers } from '../src/main/speech/markers';

describe('finding and removing markers', () => {
  it('finds every marker, in order', () => {
    expect(markersIn('First [[roof]] then the [[door]].')).toEqual(['roof', 'door']);
  });

  it('strips them without disturbing the words around them', () => {
    expect(stripMarkers('Look at the roof [[roof]] up here.')).toBe('Look at the roof  up here.');
  });

  it('leaves ordinary brackets alone', () => {
    for (const text of ['a[1] and b[2]', 'matrix [[1, 2], [3, 4]]', 'see [link](url)']) {
      expect(stripMarkers(text), text).toBe(text);
      expect(markersIn(text), text).toEqual([]);
    }
  });
});

describe('cleaning a stream', () => {
  it('removes a marker that arrives whole', () => {
    const stream = createMarkerStream();
    expect(stream.clean('the roof [[roof]] is here')).toEqual({
      text: 'the roof  is here',
      markers: ['roof'],
    });
  });

  it('removes a marker split anywhere, showing no piece of it', () => {
    // The same marker, cut at every possible point.
    const full = 'before [[roof]] after';
    for (let cut = 1; cut < full.length; cut++) {
      const stream = createMarkerStream();
      const first = stream.clean(full.slice(0, cut));
      const second = stream.clean(full.slice(cut));
      const shown = first.text + second.text + stream.flush();
      expect(shown, `cut at ${cut}`).toBe('before  after');
      expect([...first.markers, ...second.markers], `cut at ${cut}`).toEqual(['roof']);
    }
  });

  it('releases text that looked like a marker but was not', () => {
    const stream = createMarkerStream();
    const first = stream.clean('an array [[1');
    const second = stream.clean(', 2]] of numbers');
    expect(first.text + second.text).toBe('an array [[1, 2]] of numbers');
    expect(second.markers).toEqual([]);
  });

  it('flushes a held tail when the stream ends mid-suspicion', () => {
    const stream = createMarkerStream();
    const shown = stream.clean('it ends with [[ro');
    expect(shown.text).toBe('it ends with ');
    expect(stream.flush()).toBe('[[ro');
  });

  it('does not hold back unbounded text', () => {
    const stream = createMarkerStream();
    const result = stream.clean(`[[${'x'.repeat(300)}`);
    // Far too long to be a marker: shown rather than held forever.
    expect(result.text.length).toBeGreaterThan(200);
  });
});
