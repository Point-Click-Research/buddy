import { describe, expect, it } from 'vitest';
import { chordError, chordLabel, formatChord, modifierFromCode, parseChord, typePlaceholder } from '../src/shared/hotkeys';

describe('parseChord', () => {
  it('parses modifier-only chords in canonical order', () => {
    expect(parseChord('Alt+Control')).toEqual({ modifiers: ['Control', 'Alt'], key: null });
  });

  it('parses a chord with one ordinary key', () => {
    expect(parseChord('Control+Alt+space')).toEqual({ modifiers: ['Control', 'Alt'], key: 'space' });
    expect(parseChord('Meta+Shift+b')).toEqual({ modifiers: ['Shift', 'Meta'], key: 'b' });
  });

  it('rejects two ordinary keys, no modifiers, and unknown keys', () => {
    expect(parseChord('Control+a+b')).toBeNull();
    expect(parseChord('a')).toBeNull();
    expect(parseChord('Control+escape')).toBeNull();
    expect(parseChord('Control+enter')).toBeNull();
    expect(parseChord('')).toBeNull();
  });

  it('round-trips through formatChord', () => {
    const chord = parseChord('Shift+Control+f6')!;
    expect(formatChord(chord)).toBe('Control+Shift+f6');
  });
});

describe('chordError', () => {
  it('accepts the shipped defaults', () => {
    expect(chordError('Control+Alt')).toBeNull();
    expect(chordError('Control+Alt+Shift')).toBeNull();
  });

  it('rejects a single bare modifier but allows modifier+key', () => {
    expect(chordError('Control')).not.toBeNull();
    expect(chordError('Control+space')).toBeNull();
  });

  it('enforces requireKey for the always-on toggle', () => {
    expect(chordError('Control+Alt', { requireKey: true })).not.toBeNull();
    expect(chordError('Control+Alt+a', { requireKey: true })).toBeNull();
  });
});

describe('chordLabel', () => {
  it('renders mac symbols and key names', () => {
    expect(chordLabel('Control+Alt')).toBe('⌃⌥');
    expect(chordLabel('Control+Alt+space')).toBe('⌃⌥Space');
    expect(chordLabel('Meta+Shift+b')).toBe('⇧⌘B');
  });
});

describe('typePlaceholder', () => {
  it('names the hold-to-talk chord the same way the composer does', () => {
    expect(typePlaceholder('Control+Alt')).toBe('Hold ⌃⌥ to talk, or type…');
    expect(typePlaceholder('')).toBe('Hold to talk, or type…');
  });
});

describe('modifierFromCode', () => {
  it('names the modifier behind either side of the keyboard', () => {
    expect(modifierFromCode('ControlLeft')).toBe('Control');
    expect(modifierFromCode('AltRight')).toBe('Alt');
    expect(modifierFromCode('MetaLeft')).toBe('Meta');
  });

  it('is null for an ordinary key', () => {
    expect(modifierFromCode('KeyA')).toBeNull();
    expect(modifierFromCode('CapsLock')).toBeNull();
  });
});
