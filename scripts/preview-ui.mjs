// Throwaway visual check: opens the built settings + overlay renderers with a
// stubbed buddy API (preview-preload.cjs) and saves screenshots of each state
// to /tmp/buddy-figma. Run with: npx electron scripts/preview-ui.mjs
import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = '/tmp/buddy-figma';
const preload = join(ROOT, 'scripts/preview-preload.cjs');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function capture(win, name) {
  const image = await win.webContents.capturePage();
  writeFileSync(join(OUT, `${name}.png`), image.toPNG());
}

async function previewSettings() {
  const win = new BrowserWindow({
    width: 800,
    height: 620,
    show: false,
    backgroundColor: '#ffffff',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 17 },
    webPreferences: { preload, contextIsolation: true, sandbox: false },
  });
  await win.loadFile(join(ROOT, 'out/renderer/settings/index.html'));
  win.showInactive();
  await sleep(500);
  const tabs = ['providers', 'voice', 'brain', 'agent', 'knowledge', 'skills', 'tools', 'shortcuts', 'appearance'];
  for (const tab of tabs) {
    await win.webContents.executeJavaScript(
      `document.querySelector('[data-page="${tab}"]').click()`,
    );
    await sleep(200);
    await capture(win, `app-${tab}`);
  }
  win.destroy();
}

async function previewOverlay() {
  const win = new BrowserWindow({
    width: 760,
    height: 900,
    show: false,
    backgroundColor: '#8ea4b8',
    webPreferences: { preload, contextIsolation: true, sandbox: false },
  });
  await win.loadFile(join(ROOT, 'out/renderer/overlay/index.html'));
  win.showInactive();
  await sleep(400);

  const fire = (name, payload) =>
    win.webContents.executeJavaScript(`window.__fire(${JSON.stringify(name)}, ${JSON.stringify(payload)})`);

  // Bubble + activity + error, anchored near a fake cursor.
  await fire('cursorMoved', { x: 160, y: 320 });
  await fire('stateChanged', 'speaking');
  await fire('messageStart', true);
  await fire(
    'responseDelta',
    'Hey! The towels are in the washing machine. You asked me to remind you when the cycle finished — it did, about ten minutes ago.',
  );
  await fire('activity', 'Thinking…');
  await fire('sessionError', 'Connection error. Check internet.');
  await sleep(1200); // let the eased positions settle
  await capture(win, 'app-overlay-bubbles');

  // Plan approval card.
  await fire('sessionCancelled', null);
  await fire('mcpConfirm', {
    title: '',
    detail: '',
    plan: {
      description:
        '1. Go to Google in the open browser\n2. Click the address bar in the Dia browser window\n3. Type google.com and press Enter',
      offerBackground: true,
      mode: 'watch',
    },
  });
  await sleep(400);
  await capture(win, 'app-overlay-plan');

  // Allow-action card.
  await fire('mcpConfirm', null);
  await fire('mcpConfirm', {
    title: 'Allow action?',
    detail: 'Submit your message to Sanna. “Hey, how are you?”',
  });
  await sleep(400);
  await capture(win, 'app-overlay-allow');
  win.destroy();
}

app.dock?.hide();
// Default behavior quits between the two previews (all windows closed).
app.on('window-all-closed', () => {});
app
  .whenReady()
  .then(async () => {
    await previewSettings();
    await previewOverlay();
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
