// A Mac app's own icon, read from its bundle, for settings that name an app
// (Messages on Text Buddy). Cached for the session.

import { app } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createLogger } from './log';
import { errorMessage } from '../shared/errors';

const execFileAsync = promisify(execFile);
const log = createLogger('app-icon');

/** An app name only: the value arrives over IPC, so no slashes. */
const APP_NAME = /^[\w .-]{1,64}$/;
const FOLDERS = ['/System/Applications', '/Applications'];
/** Sharp at 20pt on a 2x screen, with room to spare. */
const ICON_PX = 64;

/** name -> data URL, or null when the app isn't installed. */
const cache = new Map<string, string | null>();

export async function getAppIcon(name: string): Promise<string | null> {
  if (!APP_NAME.test(name)) return null;
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const bundle = FOLDERS.map((folder) => `${folder}/${name}.app`).find((path) => existsSync(path));
  const icon = bundle ? ((await bundleIcon(bundle)) ?? (await shellIcon(bundle))) : null;
  cache.set(name, icon);
  return icon;
}

/**
 * The bundle's own .icns, scaled to a PNG by sips. app.getFileIcon hands
 * back a generic document for system apps on recent macOS, so it is only
 * the fallback.
 */
async function bundleIcon(bundle: string): Promise<string | null> {
  const out = join(tmpdir(), `buddy-app-icon-${process.pid}-${Date.now()}.png`);
  try {
    const { stdout } = await execFileAsync('plutil', [
      '-extract',
      'CFBundleIconFile',
      'raw',
      '-o',
      '-',
      `${bundle}/Contents/Info.plist`,
    ]);
    const file = stdout.trim().replace(/\.icns$/, '') || 'AppIcon';
    await execFileAsync('sips', [
      '-s',
      'format',
      'png',
      '-Z',
      String(ICON_PX),
      `${bundle}/Contents/Resources/${file}.icns`,
      '--out',
      out,
    ]);
    return `data:image/png;base64,${(await readFile(out)).toString('base64')}`;
  } catch (error) {
    log.warn(`no bundle icon for ${bundle}: ${errorMessage(error)}`);
    return null;
  } finally {
    await rm(out, { force: true });
  }
}

async function shellIcon(bundle: string): Promise<string | null> {
  const image = await app.getFileIcon(bundle, { size: 'normal' }).catch(() => null);
  return image && !image.isEmpty() ? image.toDataURL() : null;
}
