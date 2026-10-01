// macOS permission checks and prompts. Buddy needs the microphone (voice),
// screen recording (screenshots), and accessibility (uiohook global hotkey).
// On other platforms everything reports granted.

import { shell, systemPreferences } from 'electron';
import type { PermissionPane, PermissionsStatus } from '../shared/types';
import { createLogger } from './log';

const log = createLogger('permissions');

// Deep links into System Settings' Privacy & Security panes. Automation and
// Full Disk Access have no programmatic prompt, so their panes are the lever.
// Whether Full Disk Access took is probed by opening the Messages database.
/** Lock Screen, where "Turn display off on battery when inactive" lives. */
const LOCK_SCREEN_PANE = 'x-apple.systempreferences:com.apple.Lock-Screen-Settings.extension';

/** Open System Settings on the Lock Screen pane. No-op off macOS. */
export async function openLockScreenSettings(): Promise<void> {
  if (process.platform !== 'darwin') return;
  await shell.openExternal(LOCK_SCREEN_PANE);
}

const SETTINGS_PANES: Record<PermissionPane, string> = {
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
  fullDisk: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
};

export function getPermissions(): PermissionsStatus {
  if (process.platform !== 'darwin') {
    return { microphone: 'granted', screen: 'granted', accessibility: 'granted' };
  }
  return {
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    screen: systemPreferences.getMediaAccessStatus('screen'),
    // No "not-determined" for accessibility: it's a boolean trust check.
    accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied',
  };
}

/**
 * Trigger the right prompt for a permission, falling back to opening the
 * matching System Settings pane. Returns the (possibly updated) statuses.
 */
export async function requestPermission(name: PermissionPane): Promise<PermissionsStatus> {
  if (process.platform !== 'darwin') return getPermissions();
  log.info(`requesting ${name}`);

  if (name === 'microphone' && systemPreferences.getMediaAccessStatus('microphone') === 'not-determined') {
    // First ask shows the native prompt; after a denial only System Settings helps.
    await systemPreferences.askForMediaAccess('microphone');
  } else if (name === 'accessibility') {
    // Passing true makes macOS show its "grant accessibility" dialog.
    systemPreferences.isTrustedAccessibilityClient(true);
    await shell.openExternal(SETTINGS_PANES[name]);
  } else {
    // Screen recording, Automation, and Full Disk Access have no programmatic prompt.
    await shell.openExternal(SETTINGS_PANES[name]);
  }
  return getPermissions();
}
