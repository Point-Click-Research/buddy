// A site's mark: its letter on its colour at once, swapped for the favicon
// when that arrives, so nothing waits on the network to become readable.
// The source chips and Buddy's browser address pill both wear it.

import { linkInitial, linkMarkColor } from '../../shared/link-text';

export interface SiteMarkHost {
  getFavicon(host: string): Promise<string | null>;
}

export function buildSiteMark(buddy: SiteMarkHost, host: string, className: string): HTMLElement {
  const mark = document.createElement('span');
  mark.className = className;
  mark.textContent = linkInitial(host);
  mark.style.background = linkMarkColor(host);
  void buddy.getFavicon(host).then((icon) => {
    if (!icon) return;
    const image = document.createElement('img');
    image.src = icon;
    image.alt = '';
    mark.textContent = '';
    mark.style.background = 'none';
    mark.append(image);
  });
  return mark;
}
