// The settings as a renderer sees them: the non-secret settings plus whether
// each key is set. Anything in main that changes settings behind the UI's
// back (a saved memory, a demoted voice, a dead key) pushes the same shape
// the settings IPC returns, so every window redraws from one source.

import type { SettingsView } from '../shared/types';
import { IpcChannels } from '../shared/ipc';
import { cardSummary } from './payment/card';
import { broadcast } from './windows';
import { getAppKeyStatus, getKeyStatus, getSettings } from './settings';

export function settingsView(): SettingsView {
  return {
    settings: getSettings(),
    keys: getKeyStatus(),
    // The card's status is a display label (brand + last4), never the digits.
    appKeys: { ...getAppKeyStatus(), card: cardSummary() },
  };
}

/** Push the current view to every window, then return it to the caller. */
export function broadcastSettings(): SettingsView {
  const view = settingsView();
  broadcast(IpcChannels.settingsChanged, view);
  return view;
}
