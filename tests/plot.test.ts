// Sampling a function. The asymptotes are the interesting part: tan(x) near
// pi/2 returns 1.6e16, a perfectly finite number, so "is it finite" is not
// enough to avoid drawing a vertical line straight through the blow-up.

import { describe, expect, it } from 'vitest';
import { MAX_SAMPLES, samplePlot } from '../src/main/drawing/plot';

const BOX = { x: 0, y: 0, width: 200, height: 100 };

function plot(expression: string, x: [number, number] = [-5, 5], y: [number, number] = [-5, 5]) {
  return samplePlot({ expression, xRange: x, yRange: y, samples: 101, box: BOX });
}

describe('drawing a curve', () => {
  it('samples a straight line across the box', () => {
    const result = plot('x', [-1, 1], [-1, 1]);
    if ('error' in result) throw new Error(result.error);
    expect(result.segments).toHaveLength(1);
    const [first] = result.segments;
    // y grows downward on screen, so x = -1 is the bottom-left.
    expect(first![0]).toEqual({ x: 0, y: 100 });
    expect(first!.at(-1)).toEqual({ x: 200, y: 0 });
  });

  it('handles the standard functions and constants', () => {
    for (const expression of ['sin(x)', 'cos(x) * 2', 'sqrt(abs(x))', 'exp(x)', 'x^2', 'pi * x', 'e^x']) {
      expect('error' in plot(expression), expression).toBe(false);
    }
  });
});

describe('breaking at asymptotes instead of drawing through them', () => {
  it('splits 1/x into two runs either side of zero', () => {
    const result = plot('1/x', [-2, 2], [-10, 10]);
    if ('error' in result) throw new Error(result.error);
    expect(result.segments.length).toBeGreaterThanOrEqual(2);
    // No segment may straddle the gap.
    for (const segment of result.segments) {
      const crosses = segment.some((point, i) => i > 0 && Math.sign(point.y - 50) !== Math.sign(segment[i - 1]!.y - 50));
      expect(crosses).toBe(false);
    }
  });

  it('splits tan(x), whose blow-up is a huge finite number rather than infinity', () => {
    const result = plot('tan(x)', [-3, 3], [-10, 10]);
    if ('error' in result) throw new Error(result.error);
    expect(result.segments.length).toBeGreaterThanOrEqual(2);
  });

  it('skips the undefined part of a curve and keeps the rest', () => {
    // sqrt(x) has nothing to the left of zero.
    const result = plot('sqrt(x)', [-4, 4], [0, 2]);
    if ('error' in result) throw new Error(result.error);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]![0]!.x).toBeGreaterThanOrEqual(BOX.width / 2 - 2);
  });

  it('says so when nothing in the range can be drawn', () => {
    const result = plot('sqrt(x)', [-4, -1], [0, 2]);
    expect('error' in result && result.error).toContain('no finite values');
  });
});

describe('what it will not compile', () => {
  it('refuses a name that is not maths', () => {
    for (const expression of ['process', 'require("fs")', 'global.x', 'window', 'foo(x)', 'x + secret']) {
      const result = plot(expression);
      expect('error' in result, expression).toBe(true);
    }
  });

  it('names the offending symbol so the model can fix it', () => {
    const result = plot('banana * x');
    expect('error' in result && result.error).toContain('"banana"');
  });

  it('refuses an empty or non-string expression', () => {
    for (const value of [undefined, null, '', 7, {}]) {
      const result = samplePlot({
        expression: value,
        xRange: [0, 1],
        yRange: [0, 1],
        samples: 10,
        box: BOX,
      });
      expect('error' in result, String(value)).toBe(true);
    }
  });

  it('refuses nonsense that happens to use allowed names', () => {
    expect('error' in plot('sin(')).toBe(true);
    expect('error' in plot('x +')).toBe(true);
  });
});

describe('sample counts', () => {
  it('produces at most the samples it was asked for', () => {
    const result = samplePlot({
      expression: 'x',
      xRange: [0, 1],
      yRange: [0, 1],
      samples: MAX_SAMPLES,
      box: BOX,
    });
    if ('error' in result) throw new Error(result.error);
    const total = result.segments.reduce((sum, segment) => sum + segment.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_SAMPLES);
  });
});
