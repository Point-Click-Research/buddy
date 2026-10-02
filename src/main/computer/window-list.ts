// Reading the driver's window and app inventories.
//
// WindowServer knows about far more windows than a person would say are open:
// a recorded desktop had 122, of which 4 were on screen and the rest were
// service panels, offscreen helpers and 64x64 shadow windows. The model only
// ever needs the ones a user could point at, front to back.
//
// Pure module: parses the driver's JSON into text, so it is unit-testable.

export interface WindowRecord {
  windowId: number;
  pid: number;
  app: string;
  title: string;
  bounds: { x: number; y: number; width: number; height: number };
  onScreen: boolean;
  /** Higher is closer to the front; null when WindowServer won't say. */
  zIndex: number | null;
}

/** Below this a "window" is a shadow, a badge or a service panel. */
const MIN_USEFUL_SIZE = 120;

/** Enough to choose from; more would just be a list of helper processes. */
const MAX_WINDOWS = 25;
const MAX_APPS = 40;

export function parseWindows(structuredJson: string | undefined): WindowRecord[] {
  const raw = parseArray(structuredJson, 'windows');
  return raw.map((window) => ({
    windowId: numberOf(window['window_id']),
    pid: numberOf(window['pid']),
    app: stringOf(window['app_name']),
    title: stringOf(window['title']),
    bounds: {
      x: numberOf((window['bounds'] as Record<string, unknown>)?.['x']),
      y: numberOf((window['bounds'] as Record<string, unknown>)?.['y']),
      width: numberOf((window['bounds'] as Record<string, unknown>)?.['width']),
      height: numberOf((window['bounds'] as Record<string, unknown>)?.['height']),
    },
    onScreen: window['is_on_screen'] === true,
    zIndex: typeof window['z_index'] === 'number' ? window['z_index'] : null,
  }));
}

/**
 * The windows a user would call open, front first. Offscreen windows are
 * kept when they have a title — that is how a minimized or another-Space
 * window is found — but the untitled helpers are not.
 */
export function usableWindows(windows: readonly WindowRecord[]): WindowRecord[] {
  return windows
    .filter((window) => {
      if (window.bounds.width < MIN_USEFUL_SIZE || window.bounds.height < MIN_USEFUL_SIZE) return false;
      return window.onScreen || window.title !== '';
    })
    .sort((a, b) => Number(b.onScreen) - Number(a.onScreen) || (b.zIndex ?? -1) - (a.zIndex ?? -1))
    .slice(0, MAX_WINDOWS);
}

/**
 * The window an action means when the model doesn't name one: the front
 * window of the app macOS says is frontmost.
 *
 * Stacking order alone is not enough. z_index is allowed to be null, and
 * when it is, every window ties and the first one the driver happened to
 * list wins — which is how an agent ends up reading a code editor while the
 * user is looking at a browser. The frontmost app is the fact that matters,
 * so it decides, and z_index only orders that app's own windows.
 */
export function frontWindow(windows: readonly WindowRecord[], frontPid?: number | null): WindowRecord | null {
  const onScreen = usableWindows(windows).filter((window) => window.onScreen);
  const owned = frontPid == null ? [] : onScreen.filter((window) => window.pid === frontPid);
  return owned[0] ?? onScreen[0] ?? null;
}

/**
 * The window a screen point lands in, topmost first. The frontmost app's
 * window wins whenever it contains the point, for the same reason frontWindow
 * gives: z_index is allowed to be null, and then every window ties and the
 * first one the driver happened to list wins — which is how a click in a
 * frontmost browser was once attributed to a Notes window behind it.
 */
export function windowAt(
  windows: readonly WindowRecord[],
  x: number,
  y: number,
  frontPid?: number | null,
): WindowRecord | null {
  const containing = usableWindows(windows).filter(
    (window) =>
      window.onScreen &&
      x >= window.bounds.x &&
      y >= window.bounds.y &&
      x <= window.bounds.x + window.bounds.width &&
      y <= window.bounds.y + window.bounds.height,
  );
  return containing.find((window) => window.pid === frontPid) ?? containing[0] ?? null;
}

export function formatWindows(windows: readonly WindowRecord[], frontPid?: number | null): string {
  const usable = usableWindows(windows);
  if (usable.length === 0) return 'No ordinary windows are open.';
  const front = frontWindow(windows, frontPid);
  const lines = usable.map(
    (window) =>
      `pid ${window.pid} window_id ${window.windowId} | ${window.app} | ${window.title || '(untitled)'} | ` +
      `${Math.round(window.bounds.x)},${Math.round(window.bounds.y)} ${Math.round(window.bounds.width)}x${Math.round(window.bounds.height)}` +
      (window === front ? ' | frontmost' : window.onScreen ? '' : ' | offscreen'),
  );
  return `Windows:\n${lines.join('\n')}`;
}

export interface AppRecord {
  pid: number;
  name: string;
  /** macOS says this is the frontmost app. */
  active: boolean;
}

/**
 * Running apps only. The driver also lists everything installed, which is
 * hundreds of lines the model has no use for — open_app takes a name.
 */
export function parseRunningApps(structuredJson: string | undefined): AppRecord[] {
  return parseArray(structuredJson, 'apps')
    .filter((app) => app['running'] === true)
    .map((app) => ({
      name: stringOf(app['name']),
      pid: numberOf(app['pid']),
      active: app['active'] === true,
    }));
}

/** The process macOS has in front, which owns the window actions default to. */
export function activePid(apps: readonly AppRecord[]): number | null {
  return apps.find((app) => app.active)?.pid ?? null;
}

export function formatRunningApps(apps: readonly AppRecord[]): string {
  if (apps.length === 0) return 'No running apps were reported.';
  const lines = [...apps]
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
    .slice(0, MAX_APPS)
    .map((app) => `pid ${app.pid} | ${app.name}${app.active ? ' | frontmost' : ''}`);
  return `Running apps:\n${lines.join('\n')}`;
}

function parseArray(structuredJson: string | undefined, key: string): Array<Record<string, unknown>> {
  if (!structuredJson) return [];
  try {
    const parsed = JSON.parse(structuredJson) as Record<string, unknown>;
    const list = parsed[key];
    return Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}
