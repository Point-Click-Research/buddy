// The one-page web server that catches the Google sign-in redirect. Started
// for a sign-in, stopped as soon as the browser lands on it (or gives up).
// A loopback URL works the same in `npm run dev` and the packaged app, which
// a custom URL scheme does not on macOS.

import { nativeImage } from 'electron';
import { createServer } from 'node:http';
import iconPath from '../../../build/icon.png?asset';
import tokens from '../../renderer/ui/tokens.css?raw';
import { LOOPBACK_PORT } from './config';

const WAIT_MS = 5 * 60_000;
/** The mark's CSS size; the image is rendered at 2x for Retina. */
const ICON_PX = 72;

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** The error text arrives in the redirect's query string, so it is untrusted. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

function page(title: string, body: string): string {
  const icon = nativeImage
    .createFromPath(iconPath)
    .resize({ width: ICON_PX * 2 })
    .toDataURL();
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Buddy</title>
<style>
${tokens}
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--canvas); color: var(--ink); font: 13px/1.45 -apple-system, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
main { display: flex; flex-direction: column; align-items: center; gap: 20px; width: 288px; text-align: center; }
img { width: ${ICON_PX}px; height: ${ICON_PX}px; border-radius: 16px; box-shadow: 0 0 0 1px var(--line), var(--elev-card); }
h1 { margin: 0 0 6px; font-size: 25px; font-weight: 500; }
p { margin: 0; color: var(--muted); }
</style>
<main class="word-in">
<img src="${icon}" alt="">
<div><h1>${title}</h1><p>${escapeHtml(body)}</p></div>
</main>
</html>`;
}

/**
 * Wait for the browser to hit /callback?code=… and resolve with the code.
 * Rejects on an error redirect, a port already in use, or the wait running out.
 */
export function awaitOAuthCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${LOOPBACK_PORT}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error_description') ?? url.searchParams.get('error');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      if (code) {
        res.end(page("You're signed in", 'You can close this tab and go back to Buddy.'));
        finish(() => resolve(code));
      } else {
        res.end(page("That didn't work", error ?? 'Go back to Buddy and try again.'));
        finish(() => reject(new Error(error ?? 'Sign-in was cancelled.')));
      }
    });
    const timer = setTimeout(() => finish(() => reject(new Error('Sign-in timed out.'))), WAIT_MS);
    const finish = (settle: () => void): void => {
      clearTimeout(timer);
      server.close();
      settle();
    };
    server.once('error', (error) => finish(() => reject(error)));
    server.listen(LOOPBACK_PORT, '127.0.0.1');
  });
}
