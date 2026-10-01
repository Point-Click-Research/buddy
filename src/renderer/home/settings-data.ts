// The settings view as the home window reads it (the settings window edits
// through SettingsProvider instead).

import { buddy } from '../buddy';
import { createBuddyStore } from '../shared/buddy-store';

export const useSettingsView = createBuddyStore(
  () => buddy.getSettings(),
  (publish) => buddy.onSettingsChanged(publish),
);
