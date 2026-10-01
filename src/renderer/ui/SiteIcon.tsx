// A site's icon with an instant letter-mark fallback: the same favicon
// strategy as the sources list (the main process fetches through Google's
// icon service and caches per session), as a React component for settings.

import { useEffect, useState, type ReactElement } from 'react';
import { linkInitial, linkMarkColor } from '../../shared/link-text';
import { buddy } from '../buddy';
import { cn } from './cn';

const icons = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

const markClass =
  'inline-flex shrink-0 items-center justify-center rounded text-[10px] font-semibold text-white';
const imageClass = 'inline-block shrink-0 rounded object-contain';

/** A passed size replaces the default. Keeping both would let the stylesheet's later rule win. */
function sized(base: string, className?: string): string {
  const hasSize = className?.split(/\s+/).some((name) => /^(?:!)?(?:size|h|w)-/.test(name));
  return cn(hasSize ? base : `${base} size-4`, className);
}

function loadFavicon(host: string): Promise<string | null> {
  if (icons.has(host)) return Promise.resolve(icons.get(host)!);
  const existing = pending.get(host);
  if (existing) return existing;
  const job = buddy.getFavicon(host).then((data) => {
    icons.set(host, data);
    pending.delete(host);
    return data;
  });
  pending.set(host, job);
  return job;
}

/**
 * The same icon as SiteIcon, for a contenteditable that React does not own.
 * The node is marked data-icon so callers can skip it when reading the text.
 */
export function mountSiteIcon(host: string, className?: string): HTMLElement {
  const cached = icons.get(host);
  if (cached) return siteImage(cached, className);
  const mark = siteMark(host, className);
  if (!icons.has(host)) {
    void loadFavicon(host).then((data) => {
      if (data && mark.isConnected) mark.replaceWith(siteImage(data, className));
    });
  }
  return mark;
}

function siteMark(host: string, className?: string): HTMLElement {
  const mark = document.createElement('span');
  mark.dataset.icon = '';
  mark.contentEditable = 'false';
  mark.className = sized(markClass, className);
  mark.style.background = linkMarkColor(host);
  mark.textContent = linkInitial(host);
  return mark;
}

function siteImage(src: string, className?: string): HTMLElement {
  const img = document.createElement('img');
  img.dataset.icon = '';
  img.contentEditable = 'false';
  img.alt = '';
  img.draggable = false;
  img.src = src;
  img.className = sized(imageClass, className);
  return img;
}

export function SiteIcon({ host, className }: { host: string; className?: string }): ReactElement {
  const [icon, setIcon] = useState<string | null>(() => (icons.has(host) ? icons.get(host)! : null));

  useEffect(() => {
    if (icons.has(host)) {
      setIcon(icons.get(host)!);
      return;
    }
    let alive = true;
    void loadFavicon(host).then((data) => {
      if (alive) setIcon(data);
    });
    return () => {
      alive = false;
    };
  }, [host]);

  // The letter mark shows immediately and stays if the site has no icon,
  // so the row never waits on the network to become readable.
  if (!icon) {
    return (
      <span
        className={sized(markClass, className)}
        style={{ background: linkMarkColor(host) }}
        aria-hidden
      >
        {linkInitial(host)}
      </span>
    );
  }
  return <img src={icon} alt="" className={sized(imageClass, className)} />;
}
