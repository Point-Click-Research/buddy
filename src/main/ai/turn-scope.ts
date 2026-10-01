// Which turn a brain call belongs to, and what kind: a talk turn (the
// hotkey, a typed ask, a text from the phone), an agent task, or a
// background job. Carried down the async stack, so the proxied call can
// name it and the API counts turns instead of model calls.

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { SCOPE_HEADER, TURN_HEADER, type TurnScope } from '../../shared/contracts';

interface Turn {
  scope: TurnScope;
  id: string;
}

const storage = new AsyncLocalStorage<Turn>();

/**
 * Run `work` as one turn of this kind. A nested call of the same kind stays
 * in the outer turn; a task proposed inside a talk turn is its own turn.
 */
export function withTurnScope<T>(scope: TurnScope, work: () => Promise<T>): Promise<T> {
  const current = storage.getStore();
  if (current?.scope === scope) return work();
  return storage.run({ scope, id: randomUUID() }, work);
}

/** The headers a proxied brain call carries; none outside a turn. */
export function turnHeaders(): Record<string, string> {
  const turn = storage.getStore();
  return turn ? { [TURN_HEADER]: turn.id, [SCOPE_HEADER]: turn.scope } : {};
}
