// Fetch a URL and turn the HTML into readable text. Pure stripping so
// the conversion can be unit-tested without the network.

const FETCH_MS = 15_000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function fetchPageText(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_MS),
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`Could not fetch that page (${response.status}).`);
  const type = response.headers.get('content-type') ?? '';
  const body = await response.text();
  if (type.includes('text/plain')) return body;
  return htmlToText(body);
}

export function htmlToText(html: string): string {
  const without = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote|header|footer)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(without)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => fromCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => fromCode(Number(dec)));
}

function fromCode(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  return String.fromCodePoint(code);
}
