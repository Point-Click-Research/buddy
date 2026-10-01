// Dev-only window showing exactly what the model received for the last turn
// with user marks: the annotated screenshots, the close-up crops, and the
// context text. Reached from the tray's dev menu.

import { BrowserWindow } from 'electron';
import { join } from 'path';

let win: BrowserWindow | null = null;

export function openMarksView(): void {
  if (win && !win.isDestroyed()) {
    win.show();
    win.reload(); // pick up the newest turn
    return;
  }
  win = new BrowserWindow({
    width: 960,
    height: 820,
    title: 'Buddy — Marks (last turn)',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void win.loadURL(`${devUrl}/dev/marks.html`);
  else void win.loadFile(join(__dirname, '../renderer/dev/marks.html'));
  win.on('closed', () => (win = null));
}
