// Buddy's chrome around its browser: who is driving and what they are doing,
// the page's address, Stop while a task runs (Close between tasks), and
// Expand / Minimize. In peek the latest page capture shows in the frame, so
// a glance is enough to see how it is going. Expanded, the page is the
// user's to use too: the task keeps going until Stop, or they say stop.

import { linkHost, typedAddressUrl } from '../../shared/link-text';
import type { BrowserStatus } from '../../shared/types';
import type { BuddyApi } from '../../shared/ipc';
import { buildSiteMark } from '../shared/site-mark';

const buddy = (window as unknown as { buddy: BuddyApi }).buddy;

const status = document.getElementById('status')!;
const address = document.getElementById('address')!;
const host = document.getElementById('host') as HTMLInputElement;
const peek = document.getElementById('peek')!;
const stop = document.getElementById('stop') as HTMLButtonElement;
const hide = document.getElementById('hide') as HTMLButtonElement;
const toggle = document.getElementById('toggle') as HTMLButtonElement;

let current: BrowserStatus | null = null;

function statusLine(next: BrowserStatus): string {
  if (next.active) return next.activity ?? 'Working…';
  return next.hasPage ? 'Done' : '';
}

/** The site the pill's mark is for, so the mark is rebuilt only when the site changes. */
let shownSite = '';

/**
 * The address field: the site's mark and host at rest, the whole URL while
 * editing. Expanded, it shows even before there is a page, so an address can
 * be typed into an empty browser.
 */
function renderAddress(next: BrowserStatus): void {
  const site = next.hasPage ? linkHost(next.url) : '';
  address.hidden = !site && next.state !== 'expanded';
  address.title = next.url;
  if (document.activeElement !== host) host.value = site;
  if (site === shownSite) return;
  shownSite = site;
  address.querySelector('.site-mark')?.remove();
  if (site) address.prepend(buildSiteMark(buddy, site, 'site-mark'));
}

host.addEventListener('focus', () => {
  host.value = current?.hasPage ? current.url : '';
  host.select();
});
host.addEventListener('blur', () => {
  host.value = shownSite;
});
host.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') host.blur();
  if (event.key !== 'Enter') return;
  const url = typedAddressUrl(host.value);
  if (!url) return;
  host.blur();
  // Refused while a task drives the page; the status line says so until the next update.
  void buddy.openInBrowser(url).then((result) => {
    if (!result.ok) status.textContent = result.message;
  });
});

function render(next: BrowserStatus): void {
  current = next;
  document.body.dataset['state'] = next.state;
  status.textContent = statusLine(next);
  status.classList.toggle('shimmer-text', next.active);
  stop.hidden = !next.active;
  hide.hidden = next.active;
  const label = next.state === 'expanded' ? 'Minimize' : 'Expand';
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
  renderAddress(next);
}

toggle.addEventListener('click', () => {
  buddy.sendBrowserCommand(current?.state === 'expanded' ? 'peek' : 'expand');
});
stop.addEventListener('click', () => buddy.sendBrowserCommand('stop'));
hide.addEventListener('click', () => buddy.sendBrowserCommand('hide'));

buddy.onBrowserStatus(render);
void buddy.getBrowserStatus().then(render);

/** The peek thumbnail, added with its first capture so no empty image is ever on screen. */
let preview: HTMLImageElement | null = null;
buddy.onBrowserPreview((base64) => {
  if (!preview) {
    preview = document.createElement('img');
    preview.id = 'preview';
    preview.alt = '';
    preview.draggable = false;
    peek.append(preview);
  }
  preview.src = `data:image/jpeg;base64,${base64}`;
});
