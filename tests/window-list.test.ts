// Reading the window inventory, against a list recorded from the real
// driver: 122 windows on an ordinary desktop, of which four were windows a
// person would say were open.

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  activePid,
  formatRunningApps,
  formatWindows,
  frontWindow,
  parseRunningApps,
  parseWindows,
  usableWindows,
  windowAt,
} from '../src/main/computer/window-list';

const RECORDED = readFileSync(join(__dirname, 'fixtures', 'window-list.json'), 'utf8');

describe('finding the windows a person would call open', () => {
  it('drops the service panels and shadow windows WindowServer also reports', () => {
    const all = parseWindows(RECORDED);
    expect(all.length).toBe(122);
    const usable = usableWindows(all);
    // Twelve real windows across every Space, down from 122.
    expect(usable.length).toBeLessThan(15);
    expect(usable.map((window) => window.app)).toEqual(
      expect.arrayContaining(['TextEdit', 'Cursor', 'Dia']),
    );
  });

  it('orders them front first, so the model can pick without guessing', () => {
    const usable = usableWindows(parseWindows(RECORDED));
    const zIndexes = usable.filter((window) => window.onScreen).map((window) => window.zIndex ?? -1);
    expect(zIndexes).toEqual([...zIndexes].sort((a, b) => b - a));
    expect(frontWindow(parseWindows(RECORDED))?.app).toBe('Dia');
  });

  it('gives each window the pid and window_id an action addresses it by', () => {
    const rendered = formatWindows(parseWindows(RECORDED));
    const front = frontWindow(parseWindows(RECORDED))!;
    expect(rendered).toContain(`pid ${front.pid} window_id ${front.windowId}`);
    expect(rendered.split('\n').length).toBeLessThan(16);
  });

  it('keeps an offscreen window that has a title, since that is how it is found', () => {
    const windows = parseWindows(
      JSON.stringify({
        windows: [
          {
            window_id: 1,
            pid: 2,
            app_name: 'Mail',
            title: 'Inbox',
            bounds: { x: 0, y: 0, width: 800, height: 600 },
            is_on_screen: false,
            z_index: 1,
          },
          {
            window_id: 2,
            pid: 2,
            app_name: 'Mail',
            title: '',
            bounds: { x: 0, y: 0, width: 64, height: 64 },
            is_on_screen: false,
            z_index: 2,
          },
        ],
      }),
    );
    const usable = usableWindows(windows);
    expect(usable.map((window) => window.title)).toEqual(['Inbox']);
    expect(formatWindows(windows)).toContain('offscreen');
    // Nothing is on screen, so there is no front window to default to.
    expect(frontWindow(windows)).toBeNull();
  });

  it('says so plainly when there is nothing to list', () => {
    expect(formatWindows([])).toBe('No ordinary windows are open.');
    expect(parseWindows(undefined)).toEqual([]);
    expect(parseWindows('{"windows":"nope"}')).toEqual([]);
  });
});

describe('the window a point lands in', () => {
  const overlapping = (front: Record<string, unknown> = {}, behind: Record<string, unknown> = {}) =>
    parseWindows(
      JSON.stringify({
        windows: [
          {
            window_id: 1,
            pid: 100,
            app_name: 'Notes',
            title: 'Notes',
            bounds: { x: 0, y: 0, width: 1400, height: 900 },
            is_on_screen: true,
            z_index: null,
            ...behind,
          },
          {
            window_id: 2,
            pid: 200,
            app_name: 'Dia',
            title: 'New Tab',
            bounds: { x: 100, y: 0, width: 1200, height: 800 },
            is_on_screen: true,
            z_index: null,
            ...front,
          },
        ],
      }),
    );

  it('lets the frontmost app win a z_index tie, like frontWindow does', () => {
    // With every z_index null, list order used to decide — and a click in a
    // frontmost browser was attributed to the Notes window behind it.
    expect(windowAt(overlapping(), 700, 68)?.app).toBe('Notes');
    expect(windowAt(overlapping(), 700, 68, 200)?.app).toBe('Dia');
  });

  it('falls back to stacking order when the frontmost app is not under the point', () => {
    expect(windowAt(overlapping(), 50, 500, 999)?.app).toBe('Notes');
    expect(windowAt(overlapping({ z_index: 40 }, { z_index: 10 }), 700, 68)?.app).toBe('Dia');
  });

  it('returns null when no window contains the point', () => {
    expect(windowAt(overlapping(), 5000, 5000, 200)).toBeNull();
  });
});

describe('listing running apps', () => {
  const apps = JSON.stringify({
    apps: [
      { pid: 0, name: 'Numbers', running: false, active: false },
      { pid: 11, name: 'Safari', running: true, active: false },
      { pid: 12, name: 'Mail', running: true, active: true },
    ],
  });

  it('leaves out the hundreds of installed apps that are not running', () => {
    const rendered = formatRunningApps(parseRunningApps(apps));
    expect(rendered).not.toContain('Numbers');
    expect(rendered).toContain('pid 11 | Safari');
  });

  it('puts the frontmost app first and marks it', () => {
    expect(formatRunningApps(parseRunningApps(apps)).split('\n')[1]).toBe('pid 12 | Mail | frontmost');
  });

  it('names the process that owns the front window', () => {
    expect(activePid(parseRunningApps(apps))).toBe(12);
    expect(activePid([])).toBeNull();
  });
});
