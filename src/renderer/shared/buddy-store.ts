// One window-wide subscription to something main publishes: the current value
// is fetched once, then every push replaces it. Subscribed at module scope
// because the preload's listeners cannot be removed — a component effect
// would stack one per mount (twice under StrictMode).

import { useSyncExternalStore } from 'react';

/**
 * A React hook that reads the latest value main has sent, or null before the
 * first fetch lands.
 */
export function createBuddyStore<T>(
  load: () => Promise<T | null>,
  onChange: (publish: (next: T) => void, clear: () => void) => void,
): () => T | null {
  let value: T | null = null;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  const publish = (next: T): void => {
    value = next;
    notify();
  };
  /** Back to "nothing fetched yet", so a stale answer is not shown as current. */
  const clear = (): void => {
    if (value === null) return;
    value = null;
    notify();
  };
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  // Null means the fetch had nothing to report yet, so the hook stays at
  // its loading value instead of flashing an empty one.
  void load().then((next) => {
    if (next !== null) publish(next);
  });
  onChange(publish, clear);
  return () => useSyncExternalStore(subscribe, () => value);
}
