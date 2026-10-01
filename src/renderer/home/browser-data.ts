// Buddy's browser status, so the thread can offer "Show browser" while a task runs there.

import { buddy } from '../buddy';
import { createBuddyStore } from '../shared/buddy-store';

export const useBrowserStatus = createBuddyStore(
  () => buddy.getBrowserStatus(),
  (publish) => buddy.onBrowserStatus(publish),
);
