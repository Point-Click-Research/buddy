import { describe, expect, it } from 'vitest';
import type { Jev } from '../src/main/ai/jev';
import {
  classifyWalkSpeech,
  clickHitsBox,
  identityOf,
  matchIdentity,
  matchIdentityFuzzy,
  stepComplete,
} from '../src/main/followalong/watcher';

const button = {
  role: 'button',
  name: 'Save',
  value: '',
  selected: false,
  bounds: { x: 100, y: 80, w: 60, h: 24 },
  ref: 'e3',
};

const field = {
  role: 'textfield',
  name: 'Email',
  value: '',
  selected: false,
  bounds: { x: 10, y: 10, w: 200, h: 20 },
  ref: 'e1',
};

describe('matchIdentity', () => {
  it('prefers exact role and name after refs change', () => {
    const next = { ...button, ref: 'e9' };
    expect(matchIdentity([{ ...field, ref: 'e1' }, next], identityOf(button))?.ref).toBe('e9');
  });

  it('falls back to name when the role label drifts', () => {
    expect(matchIdentity([{ ...button, role: 'AXButton', ref: 'e2' }], identityOf(button))?.ref).toBe('e2');
  });

  it('does not match a longer name that only contains the original', () => {
    expect(
      matchIdentity(
        [{ ...button, name: 'Save as', ref: 'e8' }],
        identityOf(button),
      ),
    ).toBeNull();
  });

  it('uses a unique name when the role is different', () => {
    expect(matchIdentity([{ ...button, role: 'menuitem', ref: 'e4' }], identityOf(button))?.ref).toBe('e4');
  });

  it('refuses a name that is shared by two rows', () => {
    expect(
      matchIdentity(
        [
          { ...button, role: 'menuitem', ref: 'e4' },
          { ...button, role: 'link', ref: 'e5' },
        ],
        identityOf(button),
      ),
    ).toBeNull();
  });
});

// The Jev fallback: one fast typed choice when the exact rules give up,
// acted on only above the confidence threshold.
describe('matchIdentityFuzzy', () => {
  /** A Jev that answers every choice the same way and counts the asks. */
  const answer = (choice: string, confidence = 0.9, asked = { count: 0 }): Jev => ({
    async choices(_state, asks) {
      asked.count++;
      return Object.fromEntries(Object.keys(asks).map((name) => [name, { choice, confidence }])) as Awaited<
        ReturnType<Jev['choices']>
      >;
    },
    judge: async () => null,
  });

  it('never asks when the exact rules already match', async () => {
    const asked = { count: 0 };
    const next = { ...button, ref: 'e9' };
    expect((await matchIdentityFuzzy([next], identityOf(button), answer('e9', 1, asked)))?.ref).toBe('e9');
    expect(asked.count).toBe(0);
  });

  it('takes a confident answer when the label drifted', async () => {
    const renamed = { ...button, name: 'Save (2)', ref: 'e7' };
    expect((await matchIdentityFuzzy([field, renamed], identityOf(button), answer('e7')))?.ref).toBe('e7');
  });

  it('refuses an unconfident answer, and "none"', async () => {
    const renamed = { ...button, name: 'Save (2)', ref: 'e7' };
    expect(await matchIdentityFuzzy([renamed], identityOf(button), answer('e7', 0.5))).toBeNull();
    expect(await matchIdentityFuzzy([renamed], identityOf(button), answer('none'))).toBeNull();
  });

  it('is exactly matchIdentity without a decider', async () => {
    expect(await matchIdentityFuzzy([{ ...button, name: 'Save (2)' }], identityOf(button))).toBeNull();
  });
});

describe('stepComplete', () => {
  const before = identityOf(field);

  it('detects a typed value', () => {
    expect(
      stepComplete({ condition: 'value_changed', before, after: { ...field, value: 'hi@x.com' } }),
    ).toBe(true);
    expect(stepComplete({ condition: 'value_changed', before, after: field })).toBe(false);
  });

  it('detects a gone target', () => {
    expect(stepComplete({ condition: 'gone', before, after: null })).toBe(true);
    expect(stepComplete({ condition: 'gone', before, after: field })).toBe(false);
    expect(stepComplete({ condition: 'gone', before, after: null, observed: false })).toBe(false);
  });

  it('uses lastBounds when the live match has no box yet', () => {
    expect(
      stepComplete({
        condition: 'clicked',
        before: identityOf(button),
        after: { ...button, bounds: null },
        lastBounds: button.bounds,
        click: { x: 120, y: 90, at: Date.now() },
      }),
    ).toBe(true);
  });

  it('detects a click near the live box', () => {
    expect(
      stepComplete({
        condition: 'clicked',
        before: identityOf(button),
        after: button,
        click: { x: 120, y: 90, at: Date.now() },
      }),
    ).toBe(true);
    expect(
      stepComplete({
        condition: 'clicked',
        before: identityOf(button),
        after: button,
        click: { x: 800, y: 800, at: Date.now() },
      }),
    ).toBe(false);
  });

  it('any fires on the first matching signal', () => {
    expect(stepComplete({ condition: 'any', before, after: null })).toBe(true);
    expect(stepComplete({ condition: 'any', before, after: field })).toBe(false);
  });
});

describe('clickHitsBox', () => {
  it('includes padding around the control', () => {
    expect(clickHitsBox({ x: 95, y: 80, at: 0 }, button.bounds, 16)).toBe(true);
    expect(clickHitsBox({ x: 10, y: 10, at: 0 }, button.bounds, 16)).toBe(false);
  });
});

describe('classifyWalkSpeech', () => {
  it('maps skip, back, and stop phrases', () => {
    expect(classifyWalkSpeech('skip')).toBe('skip');
    expect(classifyWalkSpeech('I did it.')).toBe('skip');
    expect(classifyWalkSpeech('go back')).toBe('back');
    expect(classifyWalkSpeech('stop')).toBe('stop');
    expect(classifyWalkSpeech('what is this')).toBeNull();
  });
});
