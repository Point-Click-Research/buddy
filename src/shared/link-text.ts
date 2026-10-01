// How a link is written for the user. Both the overlay and the tray panel
// show sources, so they share this so a link reads the same in both places.
// Pure module: no Electron, no DOM.

/** Calm, distinguishable colours for a site's mark. No network, no favicon. */
export const LINK_MARK_COLORS = [
  '#7c6cff',
  '#4aa8ff',
  '#39c2a0',
  '#e0a33a',
  '#e0688a',
  '#9d7bf0',
] as const;

/**
 * What a typed address means: a URL as written, a bare host made https, and
 * anything else (words, no dot) a web search. Empty for a blank field.
 */
export function typedAddressUrl(text: string): string {
  const typed = text.trim();
  if (!typed) return '';
  if (/^https?:\/\//i.test(typed)) return typed;
  if (/^[^\s]+\.[^\s]+$/.test(typed)) return `https://${typed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(typed)}`;
}

/** The site's name, without the scheme, "www." or path: "example.com". */
export function linkHost(url: string): string {
  return stripNoise(url).split('/')[0] ?? url;
}

/**
 * ccTLD registrations usually sit one label deeper (amazon.co.uk). The full
 * public-suffix list is overkill for a gate that fails closed; a two-letter
 * TLD with one of these second levels is the case that matters.
 */
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'ac', 'edu']);

/** The store a host belongs to: "www.checkout.amazon.co.uk" -> "amazon.co.uk"; "shop.example.com" -> "example.com". */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const tld = labels[labels.length - 1]!;
  const second = labels[labels.length - 2]!;
  const keep = tld.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

/** The link as a short readable line: "example.com/some-article". */
export function linkLabel(url: string, max = 64): string {
  const text = stripNoise(url).replace(/\/$/, '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The single letter shown in a site's mark. */
export function linkInitial(host: string): string {
  return (host[0] ?? '?').toUpperCase();
}

/** A stable colour for one site, so the same source always looks the same. */
export function linkMarkColor(host: string): string {
  let total = 0;
  for (let i = 0; i < host.length; i++) total = (total * 31 + host.charCodeAt(i)) >>> 0;
  return LINK_MARK_COLORS[total % LINK_MARK_COLORS.length]!;
}

function stripNoise(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '');
}
