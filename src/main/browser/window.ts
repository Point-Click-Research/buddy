// Buddy's own browser window: a page Buddy drives from the inside, framed
// by Buddy's chrome so the user can check in. The chrome is a view the size
// of the whole window: a header along the top and the card around the page.
// The page takes the expanded window's size and keeps it through peek — the
// model's screenshots and coordinates come from it, and a resize retires
// them by frame id — and in peek the chrome covers it with a live thumbnail.
// The page carries no preload: it is the merchant's untrusted content, and
// nothing of Buddy's is reachable from it.

import { app, BaseWindow, nativeTheme, screen, session, WebContentsView, type WebContents } from 'electron';
import { join } from 'path';
import {
  type BrowserCommand,
  type BrowserStatus,
  type BrowserViewState,
} from '../../shared/types';
import { createLogger } from '../log';
import { broadcast, loadRendererPage } from '../windows';
import { IpcChannels } from '../../shared/ipc';

const log = createLogger('browser');

/** Cookies and logins persist here across tasks, in Buddy's own profile. */
export const BROWSER_PARTITION = 'persist:buddy-browser';

/** The page's starting size. Its live size follows the expanded window; see pageSize(). */
const PAGE_SIZE = { width: 1200, height: 780 };
/** The chrome's header and the page's inset and corners; browser.css draws the same frame. */
const HEADER_HEIGHT = 52;
const INSET = 8;
const PAGE_RADIUS = 10;
/** Peek frames a thumbnail in the page's own proportions. */
const PEEK = { width: 440, height: HEADER_HEIGHT + 276 + INSET };
const EDGE = 16;
/** The card colour under the chrome while it paints; --raised in ui/tokens.css. */
const RAISED = { light: '#fcfcfc', dark: '#1b1b1b' };

/**
 * The page view's current size: whatever the expanded window's content is
 * inside the frame, remembered through peek so minimizing never reflows the
 * page. Screenshots and coordinates live in this space; a resize changes the
 * next capture, whose new frame id retires coordinates measured in the old.
 */
let size = { ...PAGE_SIZE };
export function pageSize(): { width: number; height: number } {
  return size;
}

/** Boogle (the empty browser's search page) and blank documents are not a page anyone opened. */
function isStartPage(url: string): boolean {
  return url.startsWith('about:') || /\/boogle\/index\.html/.test(url);
}

let win: BaseWindow | null = null;
let chrome: WebContentsView | null = null;
let page: WebContentsView | null = null;

let status: BrowserStatus = {
  state: 'hidden',
  active: false,
  hasPage: false,
  title: '',
  url: '',
  activity: null,
};

/** The page's web contents, creating the window (hidden) on first use. */
export function browserPage(): WebContents {
  if (!win || win.isDestroyed()) create();
  return page!.webContents;
}

export function browserStatus(): BrowserStatus {
  return status;
}

/**
 * A task started or ended. Starting brings a hidden window up as a peek.
 * Ending leaves the window as the user had it: what Buddy just did is on
 * that page, and a window that vanishes reads as progress lost. Only a
 * window that was never shown (painting invisibly for captures) goes away.
 */
export function setBrowserActive(active: boolean): void {
  if (active) {
    browserPage();
    update({ active: true, activity: null });
    if (status.state === 'hidden') showBrowser('peek');
    return;
  }
  update({ active: false, activity: null });
  if (status.state === 'hidden') showBrowser('hidden');
}

/** What Buddy is doing right now, for the header's status line. */
export function setBrowserActivity(activity: string | null): void {
  if (status.activity !== activity) update({ activity });
}

/** How often the peek thumbnail follows the page: brisk while a task drives it, lazy while idle. */
const PREVIEW_MS = { active: 1_000, idle: 3_000 };
let previewTimer: { handle: ReturnType<typeof setInterval>; period: number } | null = null;

/**
 * The peek's thumbnail is captured here on a clock, not fed from the model's
 * screenshots: a browser task reads and clicks by element and may never take
 * one, which left the thumbnail on whatever the first capture saw (often
 * about:blank). Runs only while the chrome is actually showing the thumbnail.
 */
function syncPreviewLoop(): void {
  const period = status.state !== 'peek' || !page ? 0 : status.active ? PREVIEW_MS.active : PREVIEW_MS.idle;
  if (previewTimer?.period === period) return;
  if (previewTimer) clearInterval(previewTimer.handle);
  previewTimer = null;
  if (!period) return;
  previewTimer = { handle: setInterval(() => void refreshPreview(), period), period };
  void refreshPreview();
}

async function refreshPreview(): Promise<void> {
  if (!page || !chrome || chrome.webContents.isDestroyed()) return;
  try {
    const image = await page.webContents.capturePage();
    if (image.isEmpty()) return;
    // The chrome shows it at PEEK.width points; twice that covers a retina display.
    const jpeg = image.resize({ width: PEEK.width * 2 }).toJPEG(60).toString('base64');
    chrome.webContents.send(IpcChannels.browserPreview, jpeg);
  } catch {
    // Nothing painted yet (a page mid-load); the next tick tries again.
  }
}

export function showBrowser(state: BrowserViewState): void {
  browserPage();
  const window = win!;
  if (state === 'hidden') {
    // An active task still needs the page painting for its captures, so the
    // window stays shown but invisible and untouchable; idle, it truly hides.
    if (status.active) {
      window.setOpacity(0);
      window.setIgnoreMouseEvents(true);
      window.setFocusable(false);
    } else {
      window.hide();
    }
    update({ state });
    return;
  }
  const wanted =
    state === 'peek'
      ? PEEK
      : { width: size.width + 2 * INSET, height: HEADER_HEIGHT + size.height + INSET };
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const bounds =
    state === 'peek'
      ? {
          x: area.x + area.width - wanted.width - EDGE,
          y: area.y + area.height - wanted.height - EDGE,
          width: wanted.width,
          height: wanted.height,
        }
      : {
          x: area.x + Math.round((area.width - wanted.width) / 2),
          y: area.y + Math.round((area.height - wanted.height) / 2),
          width: Math.min(wanted.width, area.width),
          height: Math.min(wanted.height, area.height),
        };
  const animate = status.state !== 'hidden';
  // The state is set before the bounds change so the resize events it fires
  // are laid out as the new state: shrinking to peek must not shrink the page.
  update({ state });
  window.setIgnoreMouseEvents(false);
  window.setOpacity(1);
  // macOS animates the frame change itself; a window that was hidden has no
  // frame worth animating from, so it just appears in place.
  window.setBounds(bounds, animate);
  // Peek floats over everything and takes no focus; expanded is an ordinary
  // window the user can work in.
  window.setAlwaysOnTop(state === 'peek', 'floating');
  window.setFocusable(state === 'expanded');
  window.setResizable(state === 'expanded');
  layout();
  window.show();
  if (state === 'expanded') window.focus();
}

const VIEW_OF = {
  expand: 'expanded',
  peek: 'peek',
  hide: 'hidden',
} as const satisfies Record<Exclude<BrowserCommand, 'stop'>, BrowserViewState>;

/** The header's buttons, and the chat window's Show browser. */
export function handleBrowserCommand(command: keyof typeof VIEW_OF): void {
  showBrowser(VIEW_OF[command]);
}

/** Bring Buddy's browser to this page, expanded: the user asked to see it. */
export function openBrowserPage(url: string): void {
  void browserPage().loadURL(url);
  showBrowser('expanded');
}

function update(patch: Partial<BrowserStatus>): void {
  status = { ...status, ...patch };
  broadcast(IpcChannels.browserStatus, status);
  // The chrome lives in a view of a BaseWindow, out of broadcast()'s reach.
  if (chrome && !chrome.webContents.isDestroyed()) chrome.webContents.send(IpcChannels.browserStatus, status);
  syncPreviewLoop();
}

function paintBackground(): void {
  win?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? RAISED.dark : RAISED.light);
}

function create(): void {
  win = new BaseWindow({
    width: PEEK.width,
    height: PEEK.height,
    frame: false,
    show: false,
    resizable: false,
    skipTaskbar: true,
    title: 'Buddy',
  });
  win.setVisibleOnAllWorkspaces(true);
  paintBackground();
  nativeTheme.on('updated', paintBackground);

  chrome = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // The window's own background shows until the chrome paints.
  chrome.setBackgroundColor('#00000000');
  loadRendererPage(chrome.webContents, 'browser');

  const ses = session.fromPartition(BROWSER_PARTITION);
  // Sites see an ordinary Chrome, not an Electron app.
  ses.setUserAgent(app.userAgentFallback.replace(/\s(Electron|Buddy)\/[\d.]+/g, ''));
  ses.on('will-download', (event) => event.preventDefault());
  page = new WebContentsView({
    webPreferences: {
      partition: BROWSER_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The page must keep painting while the window is peeking or invisible:
      // the model's screenshots come from it.
      backgroundThrottling: false,
    },
  });
  page.setBorderRadius(PAGE_RADIUS);
  const contents = page.webContents;
  // Popups and new tabs open in this same page; nothing else opens anywhere.
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void contents.loadURL(url);
    return { action: 'deny' };
  });
  contents.on('page-title-updated', (_event, title) => update({ title }));
  contents.on('did-navigate', (_event, url) => update({ url, hasPage: !isStartPage(url) }));
  contents.on('did-navigate-in-page', (_event, url) => update({ url }));
  // A document from the start, so the very first capture has something painted.
  loadRendererPage(contents, 'boogle');

  win.contentView.addChildView(chrome);
  win.contentView.addChildView(page);
  win.on('resize', layout);
  win.on('closed', () => {
    nativeTheme.off('updated', paintBackground);
    win = null;
    chrome = null;
    page = null;
    update({ state: 'hidden', active: false, hasPage: false });
  });
  layout();
  log.info('browser window created');
}

/**
 * The chrome fills the window. Expanded, the page sits on top of it inside
 * the frame, and that becomes its size. In peek the chrome goes on top (its
 * thumbnail stands in for the page) and the page sits underneath at the
 * size it had, covered but inside the window's bounds: a view parked outside
 * them is never composited, and then there is no surface to capture.
 */
function layout(): void {
  if (!win || !chrome || !page) return;
  const { width, height } = win.getContentBounds();
  chrome.setBounds({ x: 0, y: 0, width, height });
  const peek = status.state === 'peek';
  // Adding a child it already holds moves it to the top.
  const top = peek ? chrome : page;
  if (win.contentView.children.at(-1) !== top) win.contentView.addChildView(top);
  if (peek) {
    page.setBounds({ x: 0, y: 0, ...size });
    return;
  }
  if (status.state === 'expanded') {
    size = { width: Math.max(1, width - 2 * INSET), height: Math.max(1, height - HEADER_HEIGHT - INSET) };
  }
  page.setBounds({ x: INSET, y: HEADER_HEIGHT, ...size });
}
