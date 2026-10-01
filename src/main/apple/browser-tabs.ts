// Instant tab control for the user's own browsers — list, open, close.
// These are the windows already on screen. Only talks to browsers that
// are already running, so a call never launches Chrome just to list nothing.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { currentToolBatch } from '../ai/batch';
import { type ToolOutcome, type ToolRegistry, toolArgs } from '../ai/tools';
import type { ProductBrowse } from '../../shared/product-browse';
import { createLogger } from '../log';
import { noteMerchantUrl } from '../payment/merchant';
import { getSettings } from '../settings';
import { waitForSpeechQueue } from '../speech/tts';
import { jxaErrorMessage, runJxa } from './jxa';

const execFileAsync = promisify(execFile);
const log = createLogger('browser-tabs');

const TIMEOUT_MS = 15_000;

const BROWSERS = ['Safari', 'Google Chrome', 'Arc', 'Dia', 'Microsoft Edge', 'Brave Browser'] as const;

/** Skip apps that aren't installed — Application('Arc') throws -2700 before running() can return. */
const JXA_RUNNING_APP = `
    const runningApp = (name) => {
      try {
        const app = Application(name);
        return app.running() ? app : null;
      } catch (e) { return null; }
    };
`;

const OPEN_RULES: Record<ProductBrowse, string> = {
  one: 'open adds a tab in a running browser (or the default if none is) — at most one per turn; a second open in the same turn is refused, so present pages one at a time.',
  rundown:
    'open adds a tab in a running browser (or the default if none is) — at most one per step: say a sentence or two about the page that opened, then open the next in your next step. Several opens in one step are refused.',
  all: 'open adds a tab in a running browser (or the default if none is). Several opens in one turn are fine when showing every find at once.',
};

function browserTabsTool(mode: ProductBrowse): Tool {
  const open = OPEN_RULES[mode];
  return {
    name: 'browser_tabs',
    description:
      "The user's own browser tabs, in one call — never a proposed task. list returns titles " +
      `and URLs per running browser. ${open} close closes tabs whose URL or title contains match, ` +
      'and reports which. One match string; never close everything.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'open', 'close'] },
        url: { type: 'string', description: 'open: the URL to open.' },
        match: { type: 'string', description: 'close: substring of the URL or title.' },
      },
      required: ['action'],
    },
  };
}

/** Register browser_tabs. A no-op off macOS. */
export function addBrowserTabsTool(registry: ToolRegistry): void {
  if (process.platform !== 'darwin') return;
  // The pace is enforced in code: prompting alone never stopped a
  // presentation from slamming every option open at once. One-at-a-time
  // caps opens per user turn. A rundown caps them per model step, so each
  // next tab comes after a step that described the last one. The tab itself
  // opens before that sentence finishes; the speech wait only holds the
  // tool open so the next step cannot start early. All-at-once has no cap.
  // The registry is rebuilt each user turn, so the mode follows the
  // current choice.
  const mode = getSettings().productBrowse;
  let openedThisTurn = false;
  let openedInBatch = -1;
  registry.set('browser_tabs', {
    definition: browserTabsTool(mode),
    execute: async (input) => {
      const action = (toolArgs(input))['action'];
      if (action === 'open') {
        if (mode === 'one' && openedThisTurn) {
          return {
            content:
              'Not opened: a tab was already opened this turn — pages open one per turn, at the ' +
              "user's pace. Describe the one that is open and stop; open the next when they ask.",
            isError: true,
          };
        }
        if (mode === 'rundown' && openedInBatch === currentToolBatch()) {
          return {
            content:
              'Not opened: a rundown opens one page per step. Say a sentence or two about the page that just opened, then open this one in your next step.',
            isError: true,
          };
        }
      }
      const outcome = await browserTabs(input);
      if (action === 'open' && !outcome.isError) {
        openedThisTurn = true;
        openedInBatch = currentToolBatch();
      }
      return outcome;
    },
  });
}

async function browserTabs(input: unknown): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const action = typeof args['action'] === 'string' ? args['action'] : '';
  try {
    if (action === 'list') return await listTabs();
    if (action === 'open') return await openTab(args);
    if (action === 'close') return await closeTabs(args);
    return { content: `Unknown browser_tabs action "${action}".`, isError: true };
  } catch (error) {
    log.warn(`browser_tabs ${action} failed: ${error instanceof Error ? error.message : error}`);
    return { content: jxaErrorMessage(error, 'the browser'), isError: true };
  }
}

/**
 * Every running browser's tabs as one text block (title and URL per tab),
 * for a read-only consumer like the morning suggestions. Empty string when
 * no browser is running or none can be reached.
 */
export async function openTabs(): Promise<string> {
  if (process.platform !== 'darwin') return '';
  try {
    const outcome = await listTabs();
    return outcome.isError || typeof outcome.content !== 'string' ? '' : outcome.content;
  } catch {
    return '';
  }
}

async function listTabs(): Promise<ToolOutcome> {
  const parsed = JSON.parse(await runJxa(listScript(), TIMEOUT_MS)) as Record<
    string,
    Array<{ title: string; url: string }>
  >;
  const names = Object.keys(parsed);
  if (names.length === 0) return { content: 'No supported browser is running.' };
  const blocks = names.map((name) => {
    const tabs = parsed[name] ?? [];
    if (tabs.length === 0) return `${name}: (no tabs)`;
    return `${name}:\n${tabs.map((t) => `- ${t.title || '(untitled)'} · ${t.url}`).join('\n')}`;
  });
  return { content: blocks.join('\n\n') };
}

/** A wedged clip must not hold a tab hostage forever. */
const SPEECH_CATCHUP_MS = 30_000;

const LINK_CHECK_TIMEOUT_MS = 4_000;
/** Definitive "this page no longer exists" answers. Nothing else counts. */
const GONE_STATUSES = new Set([404, 410]);

/**
 * Does the page provably not exist? Search results go stale — product pages
 * most of all — and opening a 404 costs the user more than this probe costs.
 * Only a definite 404/410 says gone: retail sites answer plain fetches with
 * bot walls (403, 405, challenges), so everything ambiguous — including any
 * network failure — opens normally and lets the real browser decide.
 */
async function linkGone(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(LINK_CHECK_TIMEOUT_MS),
      // A browser-ish UA gets an honest status from more sites than the
      // default Node one; sites that still refuse fall into "ambiguous".
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      },
    });
    void response.body?.cancel().catch(() => undefined);
    return GONE_STATUSES.has(response.status);
  } catch {
    return false; // unreachable is not gone; the browser may still manage
  }
}

async function openTab(args: Record<string, unknown>): Promise<ToolOutcome> {
  const url = typeof args['url'] === 'string' ? args['url'].trim() : '';
  if (!url) return { content: 'open needs a url.', isError: true };

  if (await linkGone(url)) {
    return {
      content: `Not opened: that page no longer exists (HTTP 404/410 at ${url}). Use a different link — or, if this was one of several options being presented, quietly swap in a replacement instead.`,
      isError: true,
    };
  }

  const raw = await runJxa(
    `(() => {
      ${JXA_RUNNING_APP}
      const browsers = ${JSON.stringify(BROWSERS)};
      for (const name of browsers) {
        if (runningApp(name)) return name;
      }
      return '';
    })()`,
    5_000,
  );
  const running = raw.trim();

  // Open through Launch Services (`open -a`), never by scripting a tab into
  // the window: that is the same path as clicking a link, so it works — and
  // keeps working — in every browser. Dia in particular declares its tabs
  // scriptable but crashes outright when one is pushed in via Apple Events.
  await execFileAsync('open', running ? ['-a', running, url] : [url], { timeout: 5_000 });
  // The page is up before the sentence about it finishes. Speech was queued
  // ahead of this call, so the tab lands while that sentence is still playing.
  // Holding the tool open until the sentence ends keeps the next pick from
  // starting early. All-at-once skips the hold so every tab in the step opens
  // together. Costs nothing when speech is off or idle.
  if (getSettings().productBrowse !== 'all') await waitForSpeechQueue(SPEECH_CATCHUP_MS);
  // Buddy picked this page itself (from search results, not page content), so
  // its merchant counts as user-chosen for a later fill_payment.
  noteMerchantUrl(url);
  return { content: `Opened ${url} in ${running || 'the default browser'}.` };
}

async function closeTabs(args: Record<string, unknown>): Promise<ToolOutcome> {
  const match = typeof args['match'] === 'string' ? args['match'].trim() : '';
  if (!match) return { content: 'close needs a match (part of the URL or title).', isError: true };

  const source = `(() => {
    ${JXA_RUNNING_APP}
    const browsers = ${JSON.stringify(BROWSERS)};
    const needle = ${JSON.stringify(match.toLowerCase())};
    const closed = [];
    for (const name of browsers) {
      const app = runningApp(name);
      if (!app) continue;
      try {
        for (const win of app.windows()) {
          const doomed = [];
          for (const tab of win.tabs()) {
            const title = String(tab.name() || '').toLowerCase();
            const url = String(tab.url() || '').toLowerCase();
            if (title.indexOf(needle) !== -1 || url.indexOf(needle) !== -1) {
              doomed.push(tab);
              closed.push({ browser: name, title: tab.name() || '(untitled)', url: tab.url() || '' });
            }
          }
          for (const tab of doomed) tab.close();
        }
      } catch (e) { /* no scriptable tabs */ }
    }
    return JSON.stringify(closed);
  })()`;

  const closed = JSON.parse(await runJxa(source, TIMEOUT_MS)) as Array<{
    browser: string;
    title: string;
    url: string;
  }>;
  if (closed.length === 0) return { content: `No open tab matched "${match}".` };
  const lines = closed.map((t) => `- ${t.browser}: ${t.title} · ${t.url}`);
  return { content: `Closed ${closed.length} tab(s):\n${lines.join('\n')}` };
}

function listScript(): string {
  return `(() => {
    ${JXA_RUNNING_APP}
    const browsers = ${JSON.stringify(BROWSERS)};
    const out = {};
    for (const name of browsers) {
      const app = runningApp(name);
      if (!app) continue;
      try {
        const tabs = [];
        for (const win of app.windows()) {
          for (const tab of win.tabs()) {
            tabs.push({ title: tab.name() || '', url: tab.url() || '' });
          }
        }
        out[name] = tabs;
      } catch (e) { /* no scriptable tabs */ }
    }
    return JSON.stringify(out);
  })()`;
}
