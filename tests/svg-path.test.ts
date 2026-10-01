// The path parser. This is the one place the model writes something that
// looks like markup, so what it refuses matters as much as what it accepts.

import { describe, expect, it } from 'vitest';
import { MAX_COMMANDS, parseSvgPath } from '../src/main/drawing/svg-path';

/** A screenshot half the size of its display, with no offset. */
const DOUBLE = { scale: { x: 2, y: 2 }, origin: { x: 0, y: 0 } };
const PLAIN = { scale: { x: 1, y: 1 }, origin: { x: 0, y: 0 } };

function parse(d: unknown, transform = PLAIN) {
  return parseSvgPath(d, transform);
}

describe('what it accepts', () => {
  it('takes the ten commands it allows', () => {
    const result = parse('M 0 0 L 10 10 H 20 V 30 C 1 2 3 4 5 6 S 1 2 3 4 Q 1 2 3 4 T 5 6 A 5 5 0 0 1 9 9 Z');
    if ('error' in result) throw new Error(result.error);
    expect(result.commands).toBe(10);
  });

  it('takes lowercase, relative commands', () => {
    const result = parse('m 5 5 l 10 0 l 0 10 z');
    expect('error' in result).toBe(false);
  });

  it('takes several sets of arguments after one command letter', () => {
    // "L 1 1 2 2 3 3" is three line segments, which is legal SVG.
    const result = parse('M 0 0 L 1 1 2 2 3 3');
    if ('error' in result) throw new Error(result.error);
    expect(result.commands).toBe(4);
  });

  it('takes decimals, negatives and exponents', () => {
    expect('error' in parse('M -1.5 .5 L 2e2 1E-3')).toBe(false);
  });
});

describe('mapping into the display', () => {
  it('scales and moves absolute coordinates', () => {
    const result = parse('M 10 20 L 30 40', { scale: { x: 2, y: 3 }, origin: { x: 100, y: 5 } });
    if ('error' in result) throw new Error(result.error);
    expect(result.d).toBe('M 120 65 L 160 125');
  });

  it('scales a relative move but does not move it, since a delta has no origin', () => {
    const result = parse('m 10 10', { scale: { x: 2, y: 2 }, origin: { x: 500, y: 500 } });
    if ('error' in result) throw new Error(result.error);
    expect(result.d).toBe('m 20 20');
  });

  it('maps H and V against the right axis', () => {
    const result = parse('H 10 V 10', { scale: { x: 2, y: 3 }, origin: { x: 1, y: 2 } });
    if ('error' in result) throw new Error(result.error);
    expect(result.d).toBe('H 21 V 32');
  });

  it('scales arc radii and leaves its flags alone', () => {
    const result = parse('A 10 20 45 1 0 30 40', DOUBLE);
    if ('error' in result) throw new Error(result.error);
    // rx ry rotation large sweep x y — only the radii and the endpoint move.
    expect(result.d).toBe('A 20 40 45 1 0 60 80');
  });

  it('rebuilds the path from the numbers it parsed, never passing text through', () => {
    const result = parse('M0,0L10,10');
    if ('error' in result) throw new Error(result.error);
    expect(result.d).toBe('M 0 0 L 10 10');
  });
});

describe('what it refuses', () => {
  it('refuses a command it does not know', () => {
    const result = parse('M 0 0 K 5 5');
    expect('error' in result && result.error).toContain('"K" is not a path command');
  });

  it('refuses a script, which is the point of parsing at all', () => {
    for (const attempt of [
      '<script>alert(1)</script>',
      'M 0 0 L 10 10 onload=alert(1)',
      'url(javascript:alert(1))',
      'M 0 0 L 10 10"/><script/>',
    ]) {
      expect('error' in parse(attempt), attempt).toBe(true);
    }
  });

  it('refuses a command with too few numbers', () => {
    expect('error' in parse('M 0 0 C 1 2 3')).toBe(true);
    expect('error' in parse('M 0')).toBe(true);
  });

  it('refuses a path that starts with a number', () => {
    expect('error' in parse('10 10 L 20 20')).toBe(true);
  });

  it('refuses more commands than it will draw', () => {
    const long = `M 0 0 ${'L 1 1 '.repeat(MAX_COMMANDS + 5)}`;
    expect('error' in parse(long) && (parse(long) as { error: string }).error).toContain(
      `${MAX_COMMANDS} commands`,
    );
  });

  it('refuses something enormous before parsing it', () => {
    expect('error' in parse(`M 0 0 ${'L 1 1 '.repeat(4000)}`)).toBe(true);
  });

  it('refuses what is not a string, or is empty', () => {
    for (const value of [undefined, null, 42, {}, '', '   ']) {
      expect('error' in parse(value), String(value)).toBe(true);
    }
  });

  it('refuses letters where numbers belong', () => {
    expect('error' in parse('M 0 0 L x y')).toBe(true);
  });
});
