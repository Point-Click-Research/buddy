import { describe, expect, it } from 'vitest';
import { decideLegacyPersonal, isWalkConversation } from '../src/main/account/personal-split';
import { brainForPlan, cloudModelsForPlan, modelForPlan, modelOnPlan, modelsForPicker } from '../src/shared/plan-models';
import { legacyBelongsToAccount } from '../src/main/account/scope';

describe('legacy local data', () => {
  const created = Date.parse('2026-09-28T06:00:00.000Z');

  it('stays with the account when the chats came after sign-up', () => {
    expect(legacyBelongsToAccount(created + 1_000, created)).toBe(true);
  });

  it('stays with the account when a chat starts in the same minute as sign-up', () => {
    expect(legacyBelongsToAccount(created - 30_000, created)).toBe(true);
  });

  it('does not belong to an account created after the chats', () => {
    expect(legacyBelongsToAccount(created - 86_400_000, created)).toBe(false);
  });

  it('stays put when there is nothing stored, or this Mac has no account', () => {
    expect(legacyBelongsToAccount(null, created)).toBe(true);
    expect(legacyBelongsToAccount(created, null)).toBe(true);
  });
});

describe('personal data on a new account', () => {
  it('keeps the file when this Mac has only one account', () => {
    expect(decideLegacyPersonal([], false)).toEqual({ kind: 'self' });
  });

  it('gives the file to the other account when there is exactly one', () => {
    expect(decideLegacyPersonal(['phone-account'], false)).toEqual({ kind: 'give', id: 'phone-account' });
  });

  it('holds the file when several other accounts could own it, or older chats were set aside', () => {
    expect(decideLegacyPersonal(['a', 'b'], false)).toEqual({ kind: 'park' });
    expect(decideLegacyPersonal([], true)).toEqual({ kind: 'park' });
  });
});

describe('walk chats', () => {
  const story = 'I grew up in Ohio.';
  const reply = 'Got it. Click Next.';

  it('drops the hotkey reply and the story, and keeps a chat that continued', () => {
    expect(isWalkConversation([{ role: 'user', text: 'Hi' }, { role: 'assistant', text: reply }], story, reply)).toBe(true);
    expect(isWalkConversation([{ role: 'user', text: story }, { role: 'assistant', text: 'Hello.' }], story, reply)).toBe(true);
    expect(
      isWalkConversation(
        [
          { role: 'user', text: story },
          { role: 'assistant', text: 'Hello.' },
          { role: 'user', text: 'And also this.' },
        ],
        story,
        reply,
      ),
    ).toBe(false);
  });
});

describe('plan model', () => {
  const allowed = ['anthropic/claude-haiku', 'openai/gpt-5-mini'];
  const fast = 'anthropic/claude-haiku-4.5';

  it('keeps a model the plan includes and swaps one it does not', () => {
    expect(modelOnPlan('~openai/gpt-sol-latest', allowed)).toBe(false);
    expect(modelForPlan('~openai/gpt-sol-latest', allowed, fast)).toBe(fast);
    expect(modelForPlan('openai/gpt-5-mini', allowed, fast)).toBe('openai/gpt-5-mini');
    expect(modelForPlan(fast, allowed, fast)).toBe(fast);
  });

  it('does not restore Sonnet when the plan only includes the fast model', () => {
    const sonnet = 'anthropic/claude-sonnet-5';
    expect(cloudModelsForPlan(sonnet, fast, allowed)).toEqual({
      brainModel: fast,
      brainFastModel: fast,
    });
    expect(cloudModelsForPlan(sonnet, fast, [])).toEqual({
      brainModel: sonnet,
      brainFastModel: fast,
    });
  });

  it('hands Sonnet back when the plan grows, and leaves a chosen model alone', () => {
    const starter = { model: 'anthropic/claude-sonnet-5', fastModel: fast };
    const every = ['anthropic/', 'openai/'];
    const pushedDown = { brainModel: fast, brainFastModel: fast };
    // Waitlist → early: the brain the waitlist forced onto Haiku gets Sonnet.
    expect(brainForPlan(pushedDown, starter, every, allowed)).toEqual({ brainModel: starter.model, brainFastModel: fast });
    // The same answer again (nothing grew) keeps Haiku, as does a launch with no earlier plan.
    expect(brainForPlan(pushedDown, starter, every, every)).toEqual(pushedDown);
    expect(brainForPlan(pushedDown, starter, every, null)).toEqual(pushedDown);
    // Sonnet picked by hand on early stays Sonnet.
    const chosen = { brainModel: starter.model, brainFastModel: fast };
    expect(brainForPlan(chosen, starter, every, every)).toEqual(chosen);
    // And a plan that shrinks still pulls it down.
    expect(brainForPlan(chosen, starter, allowed, every)).toEqual(pushedDown);
  });

  it('limits the picker to the plan, except on their own key', () => {
    const account = { signedIn: true, models: allowed };
    expect(modelsForPicker(account, false)).toEqual(allowed);
    expect(modelsForPicker(account, true)).toEqual([]);
    expect(modelsForPicker({ ...account, signedIn: false }, false)).toEqual([]);
    expect(modelsForPicker(null, false)).toEqual([]);
  });
});
