import { describe, expect, it } from 'vitest';
import {
  DISCO_COLOR,
  DISCO_PREVIEW,
  isDiscoColor,
  isOverlayColor,
  overlayCssColor,
  solidHexColor,
} from '../src/shared/color';

describe('isOverlayColor', () => {
  it('accepts a 6-digit hex or disco', () => {
    expect(isOverlayColor('#3d7bfd')).toBe(true);
    expect(isOverlayColor('#000000')).toBe(true);
    expect(isOverlayColor(DISCO_COLOR)).toBe(true);
  });

  it('rejects junk', () => {
    expect(isOverlayColor('#fff')).toBe(false);
    expect(isOverlayColor('red')).toBe(false);
    expect(isOverlayColor('')).toBe(false);
  });
});

describe('overlayCssColor', () => {
  it('passes a hex through', () => {
    expect(overlayCssColor('#209d55')).toBe('#209d55');
  });

  it('binds disco to the shared hue, with an optional offset', () => {
    expect(overlayCssColor(DISCO_COLOR)).toBe('hsl(var(--disco-hue) 88% 56%)');
    expect(overlayCssColor(DISCO_COLOR, 90)).toBe('hsl(calc(var(--disco-hue) + 90) 88% 56%)');
  });
});

describe('solidHexColor', () => {
  it('keeps a hex and substitutes disco', () => {
    expect(solidHexColor('#bfbfbf')).toBe('#bfbfbf');
    expect(solidHexColor(DISCO_COLOR)).toBe(DISCO_PREVIEW);
  });
});

describe('isDiscoColor', () => {
  it('is only the sentinel', () => {
    expect(isDiscoColor(DISCO_COLOR)).toBe(true);
    expect(isDiscoColor('#ff2d78')).toBe(false);
  });
});
