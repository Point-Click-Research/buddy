// The jobs and ideas views: Settings → Jobs, the approval cards in a job's
// conversation, and the suggestions on New Chat.

import { buddy } from '../buddy';
import { createBuddyStore } from './buddy-store';

export const useJobsView = createBuddyStore(
  () => buddy.listJobs(),
  (publish) => buddy.onJobsChanged(publish),
);

export const useIdeasView = createBuddyStore(
  () => buddy.listIdeas(),
  (publish) => buddy.onIdeasChanged(publish),
);
