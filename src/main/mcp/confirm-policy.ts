// How a confirmation is answered when nobody is at the screen. Foreground
// turns show the overlay card; a background run cannot, so its runner
// installs a policy around each tool call — one that parks the action as a
// pending approval and answers no, or one that texts the card to the phone
// and waits for the reply. AsyncLocalStorage keys the policy to the call's
// async context, so concurrent background runs (and a foreground turn at the
// same time) never see each other's.
//
// Pure module: confirm.ts consults it, tests import it directly.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ConfirmCard } from '../../shared/types';

/** Answers a confirmation in place of the card, now or once the user has replied. */
export type ConfirmPolicy = (card: ConfirmCard) => boolean | Promise<boolean>;

const storage = new AsyncLocalStorage<ConfirmPolicy>();

/** Run `fn` with every confirmation inside it answered by `policy`. */
export function runWithConfirmPolicy<T>(policy: ConfirmPolicy, fn: () => Promise<T>): Promise<T> {
  return storage.run(policy, fn);
}

/** The policy governing the current async context; undefined = show the card. */
export function currentConfirmPolicy(): ConfirmPolicy | undefined {
  return storage.getStore();
}
