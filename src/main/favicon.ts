// Site icons for the sources list, fetched through Google's favicon service
// and cached for the session so every overlay and the panel share one
// request per site. This is the one place Buddy tells a third party anything
// about page content: the hostname of a link a tool result mentioned.

import { createLogger } from './log';
import { errorMessage } from '../shared/errors';

const log = createLogger('favicon');

const ENDPOINT = 'https://www.google.com/s2/favicons';
/** Retina-friendly, and the largest size the service reliably returns. */
const ICON_SIZE = 64;

/**
 * Asked for a bare hostname, the favicon service follows http:// and answers
 * with the same "G" for most Workspace products. The product's own page has
 * a distinct icon, so those hosts are looked up by URL. Ads publishes the
 * "G" as its favicon on purpose, so its product mark is fetched directly.
 */
const PRODUCT_ICON: Record<string, string> = {
  'mail.google.com': iconPage('https://mail.google.com/mail/'),
  'calendar.google.com': iconPage('https://calendar.google.com/calendar/'),
  'drive.google.com': iconPage('https://drive.google.com/drive/'),
  'docs.google.com': iconPage('https://docs.google.com/document/'),
  'sheets.google.com': iconPage('https://docs.google.com/spreadsheets/'),
  'slides.google.com': iconPage('https://docs.google.com/presentation/'),
  'analytics.google.com': iconPage('https://analytics.google.com/'),
  'ads.google.com':
    'https://fonts.gstatic.com/s/i/productlogos/ads/v2/web-64dp/logo_ads_color_2x_web_64dp.png',
};

function iconPage(url: string): string {
  return `${ENDPOINT}?sz=${ICON_SIZE}&domain_url=${encodeURIComponent(url)}`;
}

/** The request that actually carries this host's icon. */
export function faviconRequestUrl(host: string): string {
  return (
    PRODUCT_ICON[host] ?? `${ENDPOINT}?domain=${encodeURIComponent(host)}&sz=${ICON_SIZE}`
  );
}

const TIMEOUT_MS = 4_000;
/** A favicon is a few KB; anything bigger isn't one. */
const MAX_BYTES = 64 * 1024;

/** host -> data URL, or null when there's no icon to show. */
const cache = new Map<string, string | null>();

/** Hostnames only: the value arrives over IPC, so it is never trusted. */
const HOST_PATTERN = /^[a-z0-9.-]{1,253}$/i;

export async function getFavicon(host: string): Promise<string | null> {
  if (!HOST_PATTERN.test(host)) return null;

  const cached = cache.get(host);
  if (cached !== undefined) return cached;

  const icon = await fetchIcon(host);
  cache.set(host, icon);
  return icon;
}

/** A product photo can be a real image; the windows' CSP still forbids remote img-src. */
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
/** A real product photo is bigger than this; a logo, sprite, or tracking pixel is not. */
const MIN_PHOTO_BYTES = 12 * 1024;
const PHOTO_TIMEOUT_MS = 8_000;
/** The page's image is often its logo, not the product. The URL usually says so. */
const NOT_A_PHOTO = /logo|icon|favicon|brand|sprite|badge|swoosh|placeholder|\.svg(\?|$)/i;
/** url -> data URL, or null when the store would not hand the photo over. */
const photos = new Map<string, string | null>();

/**
 * A product photo as a data URL, fetched from main. The renderers' CSP
 * allows only self and data: images, and stores refuse hotlinks anyway;
 * fetching with the product page as referer is what a browser would send.
 * Logos and vectors come back null, so the card shows its site chip instead.
 */
export async function getProductPhoto(imageUrl: string, pageUrl: string): Promise<string | null> {
  const image = httpsOnly(imageUrl);
  if (!image || NOT_A_PHOTO.test(image)) return null;
  const cached = photos.get(image);
  if (cached !== undefined) return cached;
  const photo = await fetchPhoto(image, httpsOnly(pageUrl) ?? image);
  photos.set(image, photo);
  return photo;
}

function httpsOnly(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

async function fetchPhoto(image: string, referer: string): Promise<string | null> {
  try {
    const response = await fetch(image, {
      headers: {
        accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        referer,
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      },
      signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
    });
    const type = response.headers.get('content-type') ?? '';
    // A vector is artwork, never a product shot.
    if (!response.ok || !type.startsWith('image/') || type.includes('svg')) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < MIN_PHOTO_BYTES || bytes.byteLength > MAX_PHOTO_BYTES) return null;
    return `data:${type.split(';')[0]};base64,${Buffer.from(bytes).toString('base64')}`;
  } catch (error) {
    log.warn(`no photo at ${image}: ${errorMessage(error)}`);
    return null;
  }
}

async function fetchIcon(host: string): Promise<string | null> {
  const url = faviconRequestUrl(host);
  try {
    // The endpoint redirects to gstatic, so redirects must be followed.
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const type = response.headers.get('content-type') ?? '';
    // A site with no icon answers 404 with a generic globe PNG. Checking the
    // status rejects that, so the chip keeps its own letter mark instead.
    if (!response.ok || !type.startsWith('image/')) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;
    return `data:${type.split(';')[0]};base64,${Buffer.from(bytes).toString('base64')}`;
  } catch (error) {
    // No icon is a cosmetic loss; the chip falls back to its letter mark.
    log.warn(`no icon for ${host}: ${errorMessage(error)}`);
    return null;
  }
}
