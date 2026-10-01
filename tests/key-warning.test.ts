import { describe, expect, it } from 'vitest';
import type { Settings } from '../src/shared/types';
import { keyWarningDisplay, pagesWithKeyWarning } from '../src/shared/key-warning';

/** Minimal settings slice for key-warning tests. */
const base = { ttsProvider: 'system', brainProvider: 'openrouter' } as Pick<Settings, 'ttsProvider' | 'brainProvider'>;

describe('keyWarningDisplay', () => {
  it('names Voice when ElevenLabs is the voice', () => {
    const settings = { ...base, ttsProvider: 'elevenlabs' as const } as Settings;
    const text = keyWarningDisplay(settings, 'elevenlabs', 'Out of credits.');
    expect(text).toContain('under Voice');
  });

  it('still points ElevenLabs at Voice when the Mac voice is picked', () => {
    const text = keyWarningDisplay(base as Settings, 'elevenlabs', 'This key was refused.');
    expect(text).toContain('under Voice');
  });
});

describe('pagesWithKeyWarning', () => {
  it('is empty with no warnings', () => {
    const settings = { ...base, keyWarnings: {} } as Settings;
    expect(pagesWithKeyWarning(settings).size).toBe(0);
  });

  it('marks Providers plus every page using the warned provider', () => {
    const settings = {
      ...base,
      ttsProvider: 'elevenlabs' as const,
      keyWarnings: { elevenlabs: 'Out of credits.' },
    } as Settings;
    expect(pagesWithKeyWarning(settings)).toEqual(new Set(['providers', 'voice']));
  });

  it('marks Brain when the warned key is OpenRouter and the brain is on the cloud', () => {
    const settings = { ...base, keyWarnings: { openrouter: 'This key was refused.' } } as Settings;
    expect(pagesWithKeyWarning(settings)).toEqual(new Set(['providers', 'brain']));
    const local = { ...base, brainProvider: 'ollama' as const, keyWarnings: { openrouter: 'x' } } as Settings;
    expect(pagesWithKeyWarning(local)).toEqual(new Set(['providers']));
  });
});
