// Where a proposed task can run, read off propose_task and off the plan's
// words. A purchase only works inside a page, so the card locks it to Buddy's
// browser. A task that can only happen on the user's Mac cannot happen in
// that browser, so the card does not offer it. The model flags each; the
// words are the backstop for when it forgets. Pure module.

import { CHECKOUT_WORDS } from '../../shared/checkout-words';

export function looksLikeCheckout(goal: string, steps: readonly string[]): boolean {
  return CHECKOUT_WORDS.test(goal) || steps.some((step) => CHECKOUT_WORDS.test(step));
}

/** What the plan card says in place of the run-style choice. */
export const CHECKOUT_MODE_NOTE = "Purchases run in Buddy's browser, where the card fill works. Nothing touches your cursor.";

/** A website, a browser, or a link: the task can happen on a page, so Buddy's browser is a real option. */
const WEB =
  /\b(?:https?:\/\/|[\w-]+\.(?:com|org|net|io)\b|safari|chrome|arc|firefox|edge|brave|website|web page|browser|this tab|the tab)\b/i;

/**
 * A Mac app, or the computer itself. Buddy's browser is one window with a
 * page in it; none of these exist there.
 */
const MAC =
  /\b(?:figma|finder|textedit|system settings|photos|preview|spotify|terminal|xcode|messages|imessage|notes app|mail app|music app|on (?:my |this )?(?:mac|computer)|my desktop|the desktop|downloads folder)\b/i;

/**
 * True when the plan can only be carried out on the user's Mac. A web cue
 * wins: "open figma.com" is a page, and Buddy's browser can do a page.
 */
export function looksLikeMacOnly(goal: string, steps: readonly string[]): boolean {
  const text = [goal, ...steps].join('\n');
  return MAC.test(text) && !WEB.test(text);
}
