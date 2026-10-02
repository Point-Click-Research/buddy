// Dev-only windows: the input-driver test page (fixed coordinates) and
// the Harbor Conference form used to try "fill this out with my info."
// Reached from the tray's "Input test" submenu (dev builds only).

import { BrowserWindow, clipboard, screen } from 'electron';
import { join } from 'path';
import { setTimeout as pause } from 'timers/promises';
import { createLogger } from '../log';
import { getPermissions, requestPermission } from '../permissions';
import { flyBuddyTo } from '../windows';
import { runApprovedAgentTask } from './agent';
import { approvePlan } from './control-tools';
import { createNutDriver, type InputDriver } from '../computer/nut-driver';
import { beforeAction, driverHooks, startDriving, stopDriving } from './safety';

const log = createLogger('input-test');

// Content coordinates of the targets in dev/input-test.html's fixed layout.
const TARGETS = {
  clickButton: { x: 140, y: 84 },
  doubleBox: { x: 400, y: 84 },
  sliderFrom: { x: 70, y: 148 },
  sliderTo: { x: 300, y: 148 },
  scrollBox: { x: 270, y: 265 },
  shortText: { x: 270, y: 398 },
  longText: { x: 270, y: 495 },
};

const LONG_TEXT =
  'This text is longer than twenty characters, so the driver pastes it via the clipboard and then restores whatever you had copied before.';

let formWindow: BrowserWindow | null = null;
let driverWindow: BrowserWindow | null = null;

function loadDevPage(win: BrowserWindow, file: 'test-form' | 'input-test'): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void win.loadURL(`${devUrl}/dev/${file}.html`);
  } else {
    void win.loadFile(join(__dirname, `../renderer/dev/${file}.html`));
  }
}

/** Harbor Conference registration — the form-filling test page. */
export function openTestForm(): BrowserWindow {
  if (formWindow && !formWindow.isDestroyed()) {
    formWindow.show();
    return formWindow;
  }
  formWindow = new BrowserWindow({
    width: 640,
    height: 860,
    useContentSize: true,
    title: 'Harbor Conference — Guest registration',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  loadDevPage(formWindow, 'test-form');
  formWindow.on('closed', () => (formWindow = null));
  return formWindow;
}

function openDriverForm(): BrowserWindow {
  if (driverWindow && !driverWindow.isDestroyed()) {
    driverWindow.show();
    return driverWindow;
  }
  driverWindow = new BrowserWindow({
    width: 560,
    height: 640,
    useContentSize: true,
    resizable: false,
    title: 'Buddy input test',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  loadDevPage(driverWindow, 'input-test');
  driverWindow.on('closed', () => (driverWindow = null));
  return driverWindow;
}

/** Move + click + drag + scroll + type through the whole driver surface. */
export async function runInputTest(): Promise<void> {
  if (getPermissions().accessibility !== 'granted') {
    log.warn('input test needs the Accessibility permission; opening System Settings');
    await requestPermission('accessibility');
    return;
  }

  const win = openDriverForm();
  await pause(800); // let it render/settle

  const content = win.getContentBounds();
  const at = (target: { x: number; y: number }) => ({
    x: content.x + target.x,
    y: content.y + target.y,
  });

  const driver = createNutDriver(driverHooks);
  const displayId = screen.getDisplayNearestPoint({ x: content.x, y: content.y }).id;
  startDriving(displayId, 'watch', (event) => log.warn(`driving event: ${event.type} — ${event.message}`));

  try {
    await clickAt(driver, at(TARGETS.clickButton), 1);
    await clickAt(driver, at(TARGETS.clickButton), 1);
    await clickAt(driver, at(TARGETS.doubleBox), 2);

    if (await guard('drag slider')) {
      flyBuddyTo(at(TARGETS.sliderTo).x, at(TARGETS.sliderTo).y);
      await driver.drag(at(TARGETS.sliderFrom), at(TARGETS.sliderTo));
    }

    if (await guard('scroll')) {
      await driver.moveMouse(at(TARGETS.scrollBox).x, at(TARGETS.scrollBox).y);
      await driver.scroll(0, 400);
      await pause(400);
      await driver.scroll(0, -200);
    }

    await clickAt(driver, at(TARGETS.shortText), 1);
    if (await guard('type short text')) await driver.typeText('Hi from Buddy!');

    await clickAt(driver, at(TARGETS.longText), 1);
    if (await guard('paste long text')) await driver.typeText(LONG_TEXT);

    if (await guard('select all')) {
      await driver.pressKeys(process.platform === 'darwin' ? 'cmd+a' : 'ctrl+a');
    }
    log.info('input test finished');
  } finally {
    stopDriving();
  }
}

/** Announce (dot flies there), then move and click — the agent's click ritual. */
async function clickAt(
  driver: InputDriver,
  point: { x: number; y: number },
  count: number,
): Promise<void> {
  if (!(await guard(`click ${point.x},${point.y}`))) return;
  flyBuddyTo(point.x, point.y);
  await pause(400); // the user sees where the click will land
  await driver.moveMouse(point.x, point.y);
  await driver.click('left', count);
  await pause(250);
}

/**
 * Dev-only entry point: the clipboard text is the goal, and the same strict
 * plan approval as propose_task / the agent chord gates the start.
 */
export async function runAgentTaskFromClipboard(): Promise<void> {
  const goal = (await clipboard.readText()).trim();
  if (!goal) {
    log.warn('clipboard is empty — copy the task text first');
    return;
  }
  if (getPermissions().accessibility !== 'granted') {
    await requestPermission('accessibility');
    return;
  }
  const task = { goal, steps: [], mode: 'watch' as const };
  const approved = await approvePlan(task, new AbortController().signal);
  if (!approved) return;
  await runApprovedAgentTask(approved);
}

/** Every action goes through safety.beforeAction; a refusal skips the rest. */
async function guard(step: string): Promise<boolean> {
  const check = await beforeAction();
  if (!check.ok) {
    log.warn(`input test halted at "${step}": ${check.reason}`);
    return false;
  }
  return true;
}