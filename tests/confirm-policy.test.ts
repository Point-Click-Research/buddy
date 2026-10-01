import { describe, expect, it } from 'vitest';
import { currentConfirmPolicy, runWithConfirmPolicy } from '../src/main/mcp/confirm-policy';
import type { ConfirmCard } from '../src/shared/types';

/** What confirm.ts does at the top of requestConfirmation. */
function requestLike(card: ConfirmCard): Promise<boolean> {
  const policy = currentConfirmPolicy();
  if (policy) return Promise.resolve(policy(card));
  return Promise.reject(new Error('would show a card'));
}

const card = (title: string): ConfirmCard => ({ title, detail: '{}' });

describe('confirm policy', () => {
  it('is absent outside a policy run — the card path is the default', () => {
    expect(currentConfirmPolicy()).toBeUndefined();
  });

  it('answers confirmations anywhere in the async call chain, and records them', async () => {
    const parked: string[] = [];
    const outcome = await runWithConfirmPolicy(
      (asked) => {
        parked.push(asked.title);
        return false;
      },
      async () => {
        await Promise.resolve(); // an await boundary, like a real tool
        return requestLike(card('Allow send_message?'));
      },
    );
    expect(outcome).toBe(false);
    expect(parked).toEqual(['Allow send_message?']);
  });

  it('does not leak into the surrounding context after the run', async () => {
    await runWithConfirmPolicy(() => true, async () => requestLike(card('x')));
    expect(currentConfirmPolicy()).toBeUndefined();
  });

  it('keeps concurrent runs isolated — each job answers only its own asks', async () => {
    const first: string[] = [];
    const second: string[] = [];
    const run = (log: string[], title: string): Promise<boolean> =>
      runWithConfirmPolicy(
        (asked) => {
          log.push(asked.title);
          return false;
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return requestLike(card(title));
        },
      );
    await Promise.all([run(first, 'job one'), run(second, 'job two')]);
    expect(first).toEqual(['job one']);
    expect(second).toEqual(['job two']);
  });

  it('an approve-all policy (the Allow once replay) answers yes', async () => {
    const approved = await runWithConfirmPolicy(
      () => true,
      async () => requestLike(card('Allow this action?')),
    );
    expect(approved).toBe(true);
  });
});
