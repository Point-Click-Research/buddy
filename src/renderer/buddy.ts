import type { BuddyApi } from '../shared/ipc';

export const buddy = (window as unknown as { buddy: BuddyApi }).buddy;
