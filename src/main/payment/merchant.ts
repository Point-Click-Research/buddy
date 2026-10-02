// The merchant gate for fill_payment: card details go only into a checkout
// whose real tab URL is HTTPS on a merchant the user chose. "Chose" means one
// of: a tab Buddy itself opened this conversation (picked from search, not by
// page content), the tab in front when the plan was approved ("Buy this"),
// a domain named in the approved plan text, or the standing trusted list in
// settings. This is the defense against an injected page steering the model
// onto an attacker's form, so every check fails closed.
//
// The URL says whose page it is, not whose iframe. Card fields often live in
// frames, and a frame on a merchant's page is not necessarily the merchant:
// a processor's hosted fields are the legitimate case, an ad or chat embed
// with an input labelled "Card number" the hostile one. So each field's
// frame is gated too, by the origin the browser process reports for it, and
// so is every frame above it (fill-tool.ts walks the chain): a processor's
// real card frame placed by an ad frame is the ad's to read.

import { registrableDomain } from '../../shared/link-text';
import { runJxa } from '../apple/jxa';
import { createLogger } from '../log';
import { getSessionPlan } from '../mcp/confirm';
import { getSettings, updateSettings } from '../settings';

const log = createLogger('merchant');

const JXA_TIMEOUT_MS = 10_000;

/** Domains named in free text — the approved plan's goal and steps. */
export function hostsInText(text: string): string[] {
  const found = text.toLowerCase().match(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\b/g) ?? [];
  return [...new Set(found.map(registrableDomain))];
}

// --- Hosts noted during the conversation --------------------------------------
// Buddy's own navigation (browser_tabs open) and the tab the user was looking
// at when they approved the plan. Never grown from page content.

let noted = new Set<string>();

export function noteMerchantUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !parsed.hostname) return;
    noted.add(registrableDomain(parsed.hostname));
  } catch {
    // Not a URL; nothing to note.
  }
}

/** A conversation's noted merchants must not authorize the next conversation's checkout. */
export function clearNotedMerchants(): void {
  noted = new Set();
  lastNotedUrl = null;
}

/** After a successful fill, the merchant needs no naming next time. */
export function trustMerchant(host: string): void {
  const domain = registrableDomain(host);
  const current = getSettings().trustedMerchants;
  if (current.includes(domain)) return;
  updateSettings({ trustedMerchants: [...current, domain] });
}

/**
 * May the card be filled on this page? The URL is the tab's real URL from
 * the browser's scripting interface, never text the page displays. The
 * refusal reason goes back to the model verbatim, so it can ask_user.
 */
export function allowFill(url: string): { ok: true; host: string } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'The checkout tab URL could not be read, so the card was not filled.' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: `The checkout page is not HTTPS (${parsed.protocol}//), so the card was not filled.` };
  }
  const domain = registrableDomain(parsed.hostname);
  const plan = getSessionPlan();
  const planned = hostsInText(plan ? `${plan.goal}\n${plan.steps.join('\n')}` : '');
  const trusted = getSettings().trustedMerchants.map(registrableDomain);
  if (noted.has(domain) || planned.includes(domain) || trusted.includes(domain)) {
    return { ok: true, host: domain };
  }
  return {
    ok: false,
    reason:
      `The checkout host ${domain} is not a merchant the user chose — it was not in the approved plan, ` +
      'not a page Buddy opened, and not on the trusted list. Use ask_user to confirm this is the right ' +
      'store before anything else; if they confirm, ask them to say the store name so it can be approved.',
  };
}

/**
 * Payment processors whose hosted card fields merchants embed as iframes, by
 * registrable domain. Kept short on purpose: a field in a frame from any
 * other host is refused with that host in the reason, so a processor missing
 * here shows up as a named refusal, never as a fill into an unknown frame.
 */
const PROCESSOR_DOMAINS = new Set([
  'stripe.com', // Stripe Elements
  'shopifycs.com', // Shopify Payments
  'adyen.com', // Adyen secured fields
  'braintreegateway.com', // Braintree hosted fields
  'paypal.com', // PayPal card fields
  'checkout.com', // Checkout.com Frames
]);

/**
 * May a card field in a frame of this origin take the card? Only a frame of
 * the merchant's own site (`merchant` is the registrable domain allowFill
 * passed) or a processor's hosted fields. An opaque origin ("null"), no
 * origin at all (a desktop driver's row), and plain HTTP all fail closed.
 */
export function allowFrame(origin: string | undefined, merchant: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin ?? '');
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const domain = registrableDomain(parsed.hostname);
  return domain === merchant || PROCESSOR_DOMAINS.has(domain);
}

// --- Reading the real tab URL --------------------------------------------------

/** Must match browser-tabs.ts; Safari uses currentTab, the Chromium family activeTab. */
const BROWSERS = ['Safari', 'Google Chrome', 'Arc', 'Dia', 'Microsoft Edge', 'Brave Browser'] as const;

/** Whether an app name is one of the browsers Buddy can read a tab from. */
export function isBrowserApp(appName: string): boolean {
  const wanted = appName.trim().toLowerCase();
  return BROWSERS.some((browser) => browser.toLowerCase() === wanted);
}

/** The page in front when the last plan was approved, for Buddy's browser to open first. */
let lastNotedUrl: string | null = null;

export function lastNotedMerchantUrl(): string | null {
  return lastNotedUrl;
}

/**
 * The active tab's URL of the named browser — of the window whose title
 * matches when given, otherwise the frontmost window. Null when the app is
 * not a scriptable browser or nothing matches: the caller fails closed.
 */
async function activeTabUrl(appName: string, windowTitle = ''): Promise<string | null> {
  const browser = BROWSERS.find((name) => name.toLowerCase() === appName.trim().toLowerCase());
  if (!browser) return null;
  const source = `(() => {
    try {
      const app = Application(${JSON.stringify(browser)});
      if (!app.running()) return '';
      const wanted = ${JSON.stringify(windowTitle.trim())};
      const tabOf = (win) => {
        try { return win.activeTab().url() || ''; } catch (e) {}
        try { return win.currentTab().url() || ''; } catch (e) {}
        return '';
      };
      if (wanted) {
        for (const win of app.windows()) {
          if (String(win.name() || '') === wanted) return tabOf(win);
        }
      }
      const front = app.windows()[0];
      return front ? tabOf(front) : '';
    } catch (e) { return ''; }
  })()`;
  try {
    const url = (await runJxa(source, JXA_TIMEOUT_MS)).trim();
    return url || null;
  } catch (error) {
    log.warn(`active tab URL read failed: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * Note the page the user is looking at as the plan is approved: the front
 * window's active tab of each running browser. "Buy this" with the product
 * page open needs no merchant name in the plan. Never throws.
 */
export async function noteFrontBrowserTabs(): Promise<void> {
  lastNotedUrl = null;
  await Promise.all(
    BROWSERS.map(async (browser) => {
      const url = await activeTabUrl(browser);
      if (!url) return;
      noteMerchantUrl(url);
      if (/^https:/i.test(url)) lastNotedUrl ??= url;
    }),
  );
}
