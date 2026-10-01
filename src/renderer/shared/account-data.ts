// The account and the connected apps, one subscription per window. Both are
// read again when the window comes forward: usage moves as Buddy works, and
// apps are connected from the Settings window or the browser.

import type { TourStopId } from '../../shared/tour';
import type { AppConnection } from '../../shared/types';
import { buddy } from '../buddy';
import { createBuddyStore } from './buddy-store';

export const useAccount = createBuddyStore(
  () => buddy.getAccount(),
  (publish) => {
    buddy.onAccountChanged(publish);
    window.addEventListener('focus', () => void buddy.getAccount().then(publish));
  },
);

/** Where the app's update stands, pushed as the updater moves. */
export const useUpdateStatus = createBuddyStore(
  () => buddy.getUpdateStatus(),
  (publish) => buddy.onUpdateStatus(publish),
);

/** Where the first-run tour stands: a stop id while it runs, null otherwise. */
export const useTourStop = createBuddyStore<TourStopId | null>(
  () => Promise.resolve(null),
  (publish) => buddy.onTourChanged(publish),
);

/**
 * The connected apps for whoever is signed in now. A list fetched before the
 * account was ready is null, not empty, and a slow answer from the previous
 * sign-in never lands on top of the next one.
 */
let listed = 0;

function listConnections(): Promise<AppConnection[] | null> {
  const mine = ++listed;
  return buddy.listAppConnections().then(
    (next) => (mine === listed ? next : null),
    () => null,
  );
}

export const useAppConnections = createBuddyStore(listConnections, (publish, clear) => {
    const show = (next: AppConnection[] | null): void => {
      if (next) publish(next);
    };
    window.addEventListener('focus', () => void listConnections().then(show));
    // The first event is this sign-in becoming known; the list in hand, if
    // any, is already theirs. A later event is a different person, and the
    // list on screen is the previous one's until the new fetch lands.
    let who: string | undefined;
    buddy.onAccountChanged((view) => {
      const id = view.signedIn ? view.identity : '';
      if (who !== undefined && who !== id) clear();
      who = id;
      void listConnections().then(show);
    });
  },
);
