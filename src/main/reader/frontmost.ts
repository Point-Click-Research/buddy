// Frontmost app, browser tab URL, document path, and selected text, via
// AppleScript. macOS only; other platforms get a clear "not supported".
//
// Every one of these needs macOS Automation permission (Apple Events) on top
// of Accessibility. The first call raises a system prompt, and a denial comes
// back as error -1743 forever after — so a refusal is reported as such rather
// than looking like "there was nothing to read".

import { execFile } from 'child_process';
import { promisify } from 'util';
import { app as electronApp } from 'electron';
import { createLogger } from '../log';
import { errorMessage } from '../../shared/errors';

const execFileAsync = promisify(execFile);
const log = createLogger('frontmost');

/** Long enough to answer the one-time Automation prompt. */
const TOOL_TIMEOUT_MS = 20_000;
/** Selection is probed on every mouse-up, so it never waits on a prompt. */
const PROBE_TIMEOUT_MS = 2_500;

export const AUTOMATION_HINT =
  'macOS is blocking Buddy from reading other apps. Open System Settings → Privacy & Security → ' +
  'Automation and allow Buddy to control System Events (and your browser), then ask me again.';

/** The user (or macOS policy) refused Apple Events. Distinct from "nothing found". */
export class AutomationDenied extends Error {
  constructor() {
    super(AUTOMATION_HINT);
    this.name = 'AutomationDenied';
  }
}

/**
 * Chromium forks answer `active tab of front window`; Safari wants
 * `current tab`. Matched on bundle id first, because names collide — a
 * Chromium fork can present the same process name as Chrome itself.
 */
const SAFARI_IDS = new Set(['com.apple.safari', 'com.apple.safaritechnologypreview']);

const CHROMIUM_IDS = new Set([
  'com.google.chrome',
  'com.google.chrome.beta',
  'com.google.chrome.canary',
  'org.chromium.chromium',
  'com.brave.browser',
  'com.brave.browser.beta',
  'com.microsoft.edgemac',
  'company.thebrowser.browser', // Arc
  'company.thebrowser.dia', // Dia
  'com.vivaldi.vivaldi',
  'com.operasoftware.opera',
]);

const SAFARI_NAMES = new Set(['safari', 'safari technology preview']);

const CHROMIUM_NAMES = new Set([
  'google chrome',
  'google chrome beta',
  'google chrome canary',
  'chromium',
  'brave browser',
  'microsoft edge',
  'arc',
  'dia',
  'vivaldi',
  'opera',
]);

export interface FrontmostApp {
  name: string;
  bundleId: string;
}

/**
 * Ask for Apple Events once, at launch, with time to answer the prompt.
 * The selection probe runs on a short timeout and would otherwise kill the
 * dialog before the user could reach it, leaving the feature dead.
 */
export async function primeAutomationPermission(): Promise<void> {
  if (process.platform !== 'darwin') return;
  try {
    await runScript('tell application "System Events" to get the name of the current user', TOOL_TIMEOUT_MS);
    log.info('Apple Events available');
  } catch {
    log.warn('Apple Events refused; highlight-to-ask and document reading are unavailable');
  }
}

/** The app in front, with its bundle id so we can address it unambiguously. */
export async function frontmostApp(): Promise<FrontmostApp | null> {
  if (process.platform !== 'darwin') return null;
  const raw = await runScript(
    `tell application "System Events"
       set p to first application process whose frontmost is true
       set bid to ""
       try
         set bid to bundle identifier of p
       end try
       return (name of p) & tab & bid
     end tell`,
    PROBE_TIMEOUT_MS,
  );
  if (!raw) return null;
  const [name = '', bundleId = ''] = raw.split('\t');
  return name ? { name, bundleId } : null;
}

export async function frontmostAppName(): Promise<string> {
  return (await frontmostApp())?.name ?? '';
}

/** Buddy itself is in front — one of our own windows, not the user's app.
 * (In dev the process System Events sees is plain "Electron".) */
export function isSelfApp(front: FrontmostApp): boolean {
  const name = front.name.toLowerCase();
  // Optional-chained: vitest resolves 'electron' without an app object.
  return name === (electronApp?.name.toLowerCase() ?? 'buddy') || name === 'electron';
}

/** The URL of the frontmost browser tab, or null when the front app isn't a browser. */
export async function frontmostBrowserUrl(front?: FrontmostApp | null): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  const app = front ?? (await frontmostApp());
  const script = app ? browserUrlScript(app) : null;
  if (!script) return null;
  const url = await runScript(script, TOOL_TIMEOUT_MS);
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** The file the frontmost window is showing (an AXDocument file:// URL), if any. */
export async function frontmostDocumentPath(): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  // `front window of p` with the process bound to a variable: the inline
  // `window 1 of (first application process whose ...)` form is a syntax error.
  const raw = await runScript(
    `tell application "System Events"
       set p to first application process whose frontmost is true
       try
         set d to value of attribute "AXDocument" of front window of p
       on error
         return ""
       end try
       if d is missing value then return ""
       return d as text
     end tell`,
    TOOL_TIMEOUT_MS,
  );
  return raw ? raw : null;
}

/** Whatever text is selected in the frontmost app, or '' when there is none. */
export async function frontmostSelectedText(): Promise<string> {
  if (process.platform !== 'darwin') return '';
  // AXSelectedText lives on the focused element, which must be fetched from
  // the process itself — `focused UI element of window 1` does not parse.
  const text = await runScript(
    `tell application "System Events"
       set p to first application process whose frontmost is true
       try
         set el to value of attribute "AXFocusedUIElement" of p
       on error
         return ""
       end try
       if el is missing value then return ""
       try
         set t to value of attribute "AXSelectedText" of el
       on error
         return ""
       end try
       if t is missing value then return ""
       return t as text
     end tell`,
    PROBE_TIMEOUT_MS,
  );
  return text ?? '';
}

/**
 * The accessibility role of the frontmost app's focused element (AXTextArea,
 * AXButton, …): '' when nothing has focus, null when it can't be read (no
 * permission, a timeout, or an app like Chromium that publishes no tree to
 * AppleScript).
 */
export async function frontmostFocusedRole(): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  const role = await runScript(
    `tell application "System Events"
       set p to first application process whose frontmost is true
       try
         set el to value of attribute "AXFocusedUIElement" of p
       on error
         return "?"
       end try
       if el is missing value then return ""
       try
         return value of attribute "AXRole" of el
       on error
         return "?"
       end try
     end tell`,
    PROBE_TIMEOUT_MS,
  ).catch(() => null);
  return role === null || role === '?' ? null : role;
}

/**
 * Which browser engine this app is, or null when it isn't a browser.
 * Also decides how its selection can be read: browsers publish no
 * accessibility tree to AppleScript, so they need the copy fallback.
 */
export function browserFamily(app: FrontmostApp): 'safari' | 'chromium' | null {
  const id = app.bundleId.toLowerCase();
  const name = app.name.toLowerCase();
  if (SAFARI_IDS.has(id) || (!id && SAFARI_NAMES.has(name))) return 'safari';
  if (CHROMIUM_IDS.has(id) || (!id && CHROMIUM_NAMES.has(name))) return 'chromium';
  return null;
}

/** Bring an app back to the front, by bundle id when we have one. */
export async function activateApp(app: FrontmostApp): Promise<void> {
  if (process.platform !== 'darwin') return;
  const args = app.bundleId ? ['-b', app.bundleId] : app.name ? ['-a', app.name] : null;
  if (!args) return;
  await execFileAsync('open', args, { timeout: 5_000 });
}

/** Exported for tests: which script (if any) reads this app's current URL. */
export function browserUrlScript(app: FrontmostApp): string | null {
  const family = browserFamily(app);
  if (!family) return null;
  // Addressing by bundle id targets the app that is actually in front. By
  // name, `tell application "Google Chrome"` would launch Chrome when the
  // front window belongs to a fork that merely reports Chrome's name.
  const target = app.bundleId
    ? `application id "${app.bundleId.replace(/["\\]/g, '')}"`
    : `application "${app.name.replace(/["\\]/g, '')}"`;
  const tab = family === 'safari' ? 'current tab' : 'active tab';
  return `tell ${target} to get URL of ${tab} of front window`;
}

/**
 * Run one AppleScript. Returns its trimmed output, or null when the script
 * failed for a benign reason (no window, app not scriptable). Throws
 * AutomationDenied when macOS refused the Apple Event outright.
 */
async function runScript(source: string, timeout: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', source], {
      timeout,
      maxBuffer: 4_000_000,
    });
    const value = stdout.trim();
    return value === 'missing value' ? null : value;
  } catch (error) {
    const detail = errorText(error);
    if (isAuthorizationFailure(detail)) {
      log.warn(`Apple Events refused: ${detail}`);
      throw new AutomationDenied();
    }
    log.warn(`AppleScript failed: ${detail}`);
    return null;
  }
}

/** -1743 is "not authorized to send Apple events"; -25211 is assistive access. */
function isAuthorizationFailure(detail: string): boolean {
  return (
    detail.includes('-1743') ||
    detail.includes('-25211') ||
    /not allowed assistive access/i.test(detail) ||
    /not authori[sz]ed/i.test(detail)
  );
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'stderr' in error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim();
    if (stderr) return stderr;
  }
  return errorMessage(error);
}
