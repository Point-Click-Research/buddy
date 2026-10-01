// Keeping Buddy current the way any Mac app does: a quiet check on launch and
// every few hours against the feed electron-builder publishes (the zip and
// latest-mac.yml beside the dmg), the download in the background, and the
// install when the app next quits. A menu-bar app must never quit itself
// mid-task, so "Restart to update" is the user's button on Account. Nothing
// happens in a dev build, which has no feed and no signature.

import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '../shared/types';
import { createLogger } from './log';
import { broadcast } from './windows';
import { IpcChannels } from '../shared/ipc';
import { errorMessage } from '../shared/errors';

const log = createLogger('updates');

/** Let the windows and tray settle before the first check. */
const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 4 * 60 * 60_000;

let status: UpdateStatus = { state: 'idle', version: app.getVersion() };

export function updateStatus(): UpdateStatus {
  return status;
}

function set(next: Partial<UpdateStatus>): void {
  status = { ...status, ...next };
  broadcast(IpcChannels.updatesChanged, status);
}

/** Wire the updater and start the clock. Call once at launch. */
export function startUpdates(): void {
  if (!app.isPackaged) return;
  autoUpdater.logger = { info: log.info, warn: log.warn, error: log.error, debug: () => undefined };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', message: undefined }));
  autoUpdater.on('update-not-available', () => set({ state: 'idle' }));
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', available: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (progress) => set({ state: 'downloading', percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', available: info.version, percent: 100 }));
  autoUpdater.on('error', (error) => set({ state: 'error', message: errorMessage(error) }));
  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS);
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS);
}

/** One check now; the events above carry the outcome. Dev builds say so. */
export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    set({ state: 'idle', message: 'Updates apply to installed builds.' });
    return status;
  }
  if (status.state === 'checking' || status.state === 'downloading') return status;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    set({ state: 'error', message: errorMessage(error) });
  }
  return status;
}

/** The downloaded update is installed as the app relaunches. */
export function installUpdate(): void {
  if (status.state !== 'ready') return;
  autoUpdater.quitAndInstall();
}
