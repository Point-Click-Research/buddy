// The pause a running task waits in while the user decides whether to
// continue: after a takeover, an excluded app, or a stall. Actions block on
// wait() until resume() — or the task's abort, which releases every waiter
// so nothing is left hanging.

import { beforeAction, type ActionGate } from './safety';

export interface PauseGate {
  pause(): void;
  resume(): void;
  /** Blocks while paused, then runs the safety rails. */
  gate: ActionGate;
}

export function createPauseGate(signal: AbortSignal): PauseGate {
  let paused = false;
  let waiters: Array<() => void> = [];
  const release = (): void => {
    for (const waiter of waiters) waiter();
    waiters = [];
  };
  signal.addEventListener('abort', release);

  return {
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      release();
    },
    gate: async (targetApp, synthesizesInput = true) => {
      while (paused && !signal.aborted) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      if (signal.aborted) return { ok: false, reason: 'the task was stopped' };
      return beforeAction(targetApp, synthesizesInput);
    },
  };
}
