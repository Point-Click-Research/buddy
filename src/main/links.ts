// Pulling the links out of a tool result so the user can open them, and
// deciding which ones are safe to open. Tool results are untrusted input, so
// only http and https are ever handed to the browser — never a file path,
// never a custom scheme. Pure module: fully unit-testable.

import type { ToolOutcome } from './ai/tools';
import { BUDDY_FEEDBACK_EMAIL } from '../shared/site';

/** Per turn; enough to show a search's sources without flooding the panel. */
const MAX_LINKS = 12;

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
/** Punctuation that ends the sentence rather than the URL. */
const TRAILING_JUNK = /[.,;:!?'")\]}]+$/;

/** The unique, openable links in one tool result, in the order they appear. */
export function extractLinks(content: ToolOutcome['content'], max = MAX_LINKS): string[] {
  const text =
    typeof content === 'string'
      ? content
      : content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');

  const links = new Set<string>();
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING_JUNK, '');
    if (isOpenableUrl(url)) links.add(url);
    if (links.size >= max) break;
  }
  return [...links];
}

/** Whether Buddy may hand this URL to the user's browser. */
export function isOpenableUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Trusted mailto links from Buddy UI (not tool results). */
export function isAllowedMailto(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'mailto:') return false;
    const to = decodeURIComponent(url.pathname);
    return to.toLowerCase() === BUDDY_FEEDBACK_EMAIL;
  } catch {
    return false;
  }
}
