// The first-run walk's pieces that live in main. The story step asks the
// user to tell Buddy their story; the next guide turn then carries a
// one-shot addition that has Buddy save what it heard and answer like it
// knows them. The permissions step's Grant opens that permission's prompt
// or System Settings pane and floats a card the user drags Buddy's own icon
// out of: dropping it on the Accessibility or Screen Recording list is how
// macOS adds an app there, since the drag carries the app bundle.

import { app, nativeImage, type NativeImage, type WebContents } from 'electron';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PermissionName, PermissionPane, PermissionsStatus } from '../shared/types';
import { getPermissions, requestPermission } from './permissions';
import { primeAutomationPermission } from './reader/frontmost';
import { hideDragCard, showDragCard } from './windows';

let storyPending = false;

/** The next spoken turn is the user's story. */
export function beginStoryTurn(): void {
  storyPending = true;
}

/** The user left the story step before telling it: the next turn is an ordinary one. */
export function cancelStoryTurn(): void {
  storyPending = false;
}

/** Whether this turn is the story, consumed by the guide turn that builds its prompt. */
export function takeStoryTurn(): boolean {
  const pending = storyPending;
  storyPending = false;
  return pending;
}

/**
 * The .app that macOS attributes permissions to: Buddy.app, or Electron.app
 * in development. Either way the executable sits at Contents/MacOS inside it.
 */
function appBundlePath(): string {
  return resolve(process.execPath, '../../..');
}

/** Buddy's icon for the drag image: the source png in development, the bundle's own icon when packaged. */
let dragIcon: NativeImage | null = null;

/** getFileIcon is async and a drag cannot wait on it, so the icon is fetched when the step opens. */
function primeDragIcon(): void {
  if (dragIcon) return;
  const png = join(app.getAppPath(), 'build/icon.png');
  if (existsSync(png)) {
    dragIcon = nativeImage.createFromPath(png).resize({ width: 64 });
    return;
  }
  void app.getFileIcon(appBundlePath(), { size: 'normal' }).then((icon) => (dragIcon = icon));
}

/** Start dragging the app bundle out of the window whose renderer asked. Synchronous: the OS drag is already under way. */
export function dragAppBundle(contents: WebContents): void {
  contents.startDrag({ file: appBundlePath(), icon: dragIcon ?? nativeImage.createEmpty() });
}

const CARD_POLL_MS = 1500;

/** The list the card is up for; the card comes down once that permission lands. */
let cardList: PermissionName | null = null;
let cardWatch: NodeJS.Timeout | null = null;

function isWalkPermission(name: PermissionPane): name is PermissionName {
  return name === 'microphone' || name === 'screen' || name === 'accessibility';
}

/**
 * Grant, from the walk or Settings: the prompt or pane for one permission.
 * When a pane opened, the card floats above it saying what to do in that
 * list. A first microphone ask is the native prompt, which needs no card.
 */
export async function grantPermission(name: PermissionPane): Promise<PermissionsStatus> {
  const before = getPermissions();
  const status = await requestPermission(name);
  if (!isWalkPermission(name) || status[name] === 'granted') return status;
  if (name === 'microphone' && before.microphone === 'not-determined') return status;
  showCardFor(name);
  return status;
}

function showCardFor(list: PermissionName): void {
  cardList = list;
  primeDragIcon();
  showDragCard(list);
  if (cardWatch) return;
  cardWatch = setInterval(() => {
    if (cardList && getPermissions()[cardList] !== 'granted') return;
    stopPermissionsWalk();
  }, CARD_POLL_MS);
}

/** The permissions step is showing: get what Grant will need ready. Nothing opens until Grant. */
export function startPermissionsWalk(): void {
  // System Events (Automation) is asked here, with the other permissions, not at launch.
  void primeAutomationPermission();
  primeDragIcon();
}

/** The user left the permissions step, or the card's permission landed: take the card down. */
export function stopPermissionsWalk(): void {
  if (cardWatch) clearInterval(cardWatch);
  cardWatch = null;
  cardList = null;
  hideDragCard();
}
