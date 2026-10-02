// App lifecycle: single instance, tray, dock hiding, and window setup.

import { app, Menu, screen, Tray, type MenuItemConstructorOptions } from 'electron';
import { APP_NAME, type Annotation } from '../shared/types';
import { accountConfigured } from './account/config';
import { restartWalk } from './account/local';
import { replayWalk } from './tour';
import { hasStoredAccount, startAccount } from './account/session';
import { isAgentActive, stopAgentTask } from './agent/agent';
import { browserStatus, showBrowser } from './browser/window';
import { isFollowAlongActive } from './followalong/runner';
import { noteScreenClick, noteScreenKey } from './followalong/tools';
import { openTestForm, runAgentTaskFromClipboard, runInputTest } from './agent/input-test';
import { shutdownDriver } from './computer/driver';
import { backfillTitles, settleAbandonedAgentTraces } from './chat/conversations';
import { showDrawingGallery } from './drawing/gallery';
import {
  dismissAll,
  expireDrawings,
  followElements,
  revealDrawings,
  setDrawingsPinned,
  setMarkLookup,
} from './drawing/tools';
import { setMarkerListener } from './speech/tts';
import { isMouseButtonDown, startHotkeys, stopHotkeys } from './hotkey';
import { registerIpc } from './ipc';
import { startJobs } from './jobs/scheduler';
import { startTextBridge } from './texts/bridge';
import { startUpdates } from './updates';
import { createLogger } from './log';
import { openMarksView } from './marks/dev-view';
import { escapeClearsMarks, hideMarks, isCapturing, lingerThenHideMarks, markBox, pendingMarks } from './marks/marks';
import { resolveConfirmation, resolveConfirmationEnter } from './mcp/confirm';
import { startMcp, stopMcp } from './mcp/manager';
import { scheduleLocalWarmup } from './session/guide-turn';
import { getPermissions } from './permissions';
import { cancelQuickAsk, isQuickAskOpen, setQuickAskMarking, toggleQuickAsk } from './quick-ask';
import * as session from './session';
import { onWalkStep } from './session/asks';
import { sweepOutbox } from './session/turn-files';
import { sweepMessagesCopies } from './apple/messages';
import { createShakeDetector } from './shake';
import { hideSelection, startSelectionWatcher } from './selection';
import { getSettings } from './settings';
import { onStateChange, toggleAlwaysOn } from './state';
import { createTrayIcon } from './tray-icon';
import {
  applyAppearance,
  createRecorderWindow,
  openHomeWindow,
  warmHomeWindow,
  openSettingsWindow,
  sendAnnotationsToDisplay,
  sendFieldDictation,
  startCursorPoller,
  stopCursorPoller,
  syncOverlays,
  togglePanel,
} from './windows';

const log = createLogger('main');

/**
 * The drawing heartbeat: expiry, and element-anchored shapes following their
 * window. Twice a second is enough for a dragged window to feel tracked.
 */
const DRAWING_UPKEEP_MS = 500;

// Keep a reference so the tray isn't garbage-collected.
let tray: Tray | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// TTS clips play in the hidden recorder window, where no user gesture is
// possible — allow audio without one.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(() => {
  app.setName(APP_NAME);
  // A normal app: Dock icon, and the menu bar reads Buddy while a window is up.
  // An agent app stays out of the Dock and leaves the previous app's menu in place.
  if (process.platform === 'darwin') app.setActivationPolicy('regular');

  registerIpc();
  sweepOutbox();
  sweepMessagesCopies();
  // A stored sign-in comes back live before the first turn asks for a brain.
  startAccount();
  applyAppearance(getSettings().appearance);
  session.registerAlwaysOn();
  // The sign-in window comes up before overlays and the recorder, so first
  // boot is that window and not a stack of system dialogs over another app.
  warmHomeWindow();
  // Signed out, still in the walk, or missing a permission: the window is the
  // product. A screen-recording grant quits the app; the walk has to be there
  // when it comes back, not only a voice from the menu bar.
  if (
    !hasStoredAccount() ||
    !getSettings().onboardingDone ||
    Object.values(getPermissions()).some((state) => state !== 'granted')
  ) {
    openHomeWindow();
  }
  app.on('activate', () => openHomeWindow());
  syncOverlays();
  createRecorderWindow();
  // The poller feeds the shake trigger for the Type to Buddy box. Drags and
  // the agent's own cursor moves are never a gesture.
  const shake = createShakeDetector();
  startCursorPoller((sample) => {
    if (getSettings().quickAskTrigger !== 'shake') return;
    if (isMouseButtonDown() || isAgentActive()) {
      shake.reset();
      return;
    }
    if (shake.handle(sample)) toggleQuickAsk();
  });
  createTray();
  startMcp();
  scheduleLocalWarmup();
  // Background jobs and the morning Suggestions run tick off this clock.
  startJobs();
  startTextBridge();
  startUpdates();

  startSelectionWatcher();
  // Conversations saved before Buddy summarized names still read as clipped
  // first asks; give them proper ones in the background.
  // A task still marked running didn't survive the quit; close its chat line.
  settleAbandonedAgentTraces();
  backfillTitles();
  // While the Type to Buddy box is open, the talk chord dictates into the
  // field and drags draw marks — it never starts a voice session of its own,
  // which would wipe the ink drawn for the box. The pointer is taken only
  // for the hold, so highlighting text keeps working the rest of the time.
  startHotkeys({
    getChord: () => getSettings().hotkey,
    onChordDown: () => {
      if (isQuickAskOpen()) setQuickAskMarking(true);
      else if (session.fieldTakesDictation()) session.startDictation(sendFieldDictation);
      else session.onChordDown('guide');
    },
    onChordUp: (heldMs) => {
      if (isQuickAskOpen()) setQuickAskMarking(false, heldMs);
      else if (session.isDictating()) session.endDictation(heldMs);
      else session.onChordUp(heldMs);
    },
    onChordCancel: () => {
      if (isQuickAskOpen()) setQuickAskMarking(false);
      else if (session.isDictating()) session.cancelDictation();
      else session.onChordCancel();
    },
    // The "do this" chord: what the user says becomes a proposed agent task.
    getAgentChord: () => getSettings().agentHotkey,
    onAgentChordDown: () => {
      if (!isQuickAskOpen()) session.onChordDown('agent');
    },
    onAgentChordUp: (heldMs) => {
      if (!isQuickAskOpen()) session.onChordUp(heldMs);
    },
    onAgentChordCancel: () => {
      if (!isQuickAskOpen()) session.onChordCancel();
    },
    // The always-on toggle chord (Settings → Controls); '' means none.
    getAlwaysOnChord: () => getSettings().alwaysOnHotkey,
    onAlwaysOnChord: () => toggleAlwaysOn(),
    // The Type to Buddy chord: only armed when it is the chosen trigger.
    getQuickAskChord: () => {
      const settings = getSettings();
      return settings.quickAskTrigger === 'hotkey' ? settings.quickAskHotkey : '';
    },
    onQuickAskChord: () => toggleQuickAsk(),
    isDoubleTapArmed: () => getSettings().quickAskTrigger === 'doubleTap',
    onDoubleTap: () => toggleQuickAsk(),
    // With the Type to Buddy box open, Escape closes it (and only it), and
    // Enter belongs to its field — never to a pending confirmation.
    // Otherwise: while the talk chord is held with marks drawn, Escape
    // clears the marks and the hold continues; a pending tool confirmation
    // captures Escape (deny) and Enter (approve); and failing that Escape
    // stops whatever is in flight and takes the drawings down with it — it
    // is the "Buddy, enough" key.
    onEscape: () => {
      if (cancelQuickAsk()) return;
      if (escapeClearsMarks()) return;
      if (resolveConfirmation(false)) return;
      hideSelection();
      session.onEscape();
      dismissAll();
    },
    onEnter: () => {
      if (isQuickAskOpen()) return;
      resolveConfirmationEnter();
    },
    // A scroll or click changes what is under the drawings, which would
    // leave them marking up nothing. Not while the agent drives: its own
    // synthetic clicks arrive through the same tap, and they must not wipe
    // the safety cues that show the user what it is about to do.
    onScreenInteraction: (event) => {
      if (isFollowAlongActive()) {
        if (event.kind === 'click') noteScreenClick(event.x, event.y);
        else if (event.kind === 'key') noteScreenKey();
        return;
      }
      // Keys don't move what's under the drawings; only scrolls and clicks do.
      // The user's mark stays up through the answer (it is the pointer). A
      // click or scroll means that moment is over, same as the drawings.
      // Not during a stroke, and not before the question is sent: that click
      // is them still pointing, or focusing the box they are typing into.
      // On the walk's drawing step the first drawing has to survive the
      // click on Next, or they never see it.
      if (event.kind !== 'key' && !isAgentActive()) {
        if (!onWalkStep('drawing')) dismissAll();
        if (!isCapturing() && !pendingMarks()) hideMarks();
      }
    },
  });

  // Overlays must always match the current display setup.
  screen.on('display-added', syncOverlays);
  screen.on('display-removed', syncOverlays);
  screen.on('display-metrics-changed', syncOverlays);

  // Drawings fade on their own after a while, and element-anchored ones
  // follow the window they belong to; something has to keep both true.
  setInterval(() => {
    expireDrawings();
    void followElements();
  }, DRAWING_UPKEEP_MS);
  // Speech tells the drawing layer when the reply reaches a [[marker]], and
  // the waiting shape appears as the sentence is spoken.
  setDrawingsPinned(() => isAgentActive() || isFollowAlongActive() || onWalkStep('drawing'));
  setMarkerListener(revealDrawings);
  // { mark: n } drawing anchors resolve against this turn's user marks.
  setMarkLookup(markBox);
  // The user's marks stay up through the answer as the pointer; once the
  // turn is over (back to idle), they linger a reading beat and go down.
  onStateChange((state) => {
    if (state === 'idle') lingerThenHideMarks();
  });

  log.info(`${APP_NAME} ready`);
});

// Tray apps keep running with no windows open.
app.on('window-all-closed', () => {
  /* do not quit */
});

app.on('before-quit', () => {
  stopCursorPoller();
  stopHotkeys();
  stopMcp();
  // Sessions end with their owners; the driver itself only stops here.
  void shutdownDriver();
});

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip(APP_NAME);

  // Developer tools, dev builds only: the panel (live state inspector and
  // agent log), annotation/drawing smoke tests, and the input test that
  // drives the real mouse/keyboard.
  const devItems: MenuItemConstructorOptions[] = app.isPackaged
    ? []
    : [
        { type: 'separator' },
        { label: 'Open Panel', click: () => tray && togglePanel(tray.getBounds()) },
        { label: 'Test annotations', click: drawTestAnnotations },
        { label: 'Restart onboarding', click: () => {
          const accountId = restartWalk();
          // With no account there is no walk: the Launch screen comes back instead.
          if (accountId && accountConfigured()) replayWalk(accountId);
          openHomeWindow();
        } },
        // Every shape, stroke and animation, for eyes rather than tests.
        { label: 'Drawing gallery', click: () => void showDrawingGallery() },
        // What the model received for the last turn with user marks.
        { label: 'Marks view', click: () => openMarksView() },
        {
          label: 'Input test',
          submenu: [
            { label: 'Open test form', click: () => void openTestForm() },
            { label: 'Run input test', click: () => void runInputTest() },
            { label: 'Run agent task from clipboard', click: () => void runAgentTaskFromClipboard() },
          ],
        },
      ];

  // Built per open, so "Stop Buddy" reflects whether a task is running right
  // now. It is the stop control for a task in Buddy's browser (plain Escape
  // doesn't stop those), but it honestly stops a Watch task too.
  const buildMenu = (): Menu =>
    Menu.buildFromTemplate([
      { label: `Open ${APP_NAME}`, click: openHomeWindow },
      { label: `Stop ${APP_NAME}`, enabled: isAgentActive(), click: () => stopAgentTask('Stopped from the tray menu.') },
      { label: `Show ${APP_NAME}'s browser`, enabled: browserStatus().active || browserStatus().hasPage, click: () => showBrowser('expanded') },
      ...devItems,
      { type: 'separator' },
      { label: 'Settings…', click: () => openSettingsWindow() },
      { type: 'separator' },
      { label: `Quit ${APP_NAME}`, click: () => app.quit() },
    ]);

  // Left-click opens the home — conversations, and Settings one click away.
  tray.on('click', openHomeWindow);
  tray.on('right-click', () => tray?.popUpContextMenu(buildMenu()));
}

/** Tray test hook: draw one of each annotation type in the center of every display. */
function drawTestAnnotations(): void {
  for (const display of screen.getAllDisplays()) {
    const cx = display.bounds.width / 2;
    const cy = display.bounds.height / 2;
    const stamp = Date.now();
    const annotations: Annotation[] = [
      { id: `${stamp}-point`, kind: 'point', x: cx, y: cy - 180, label: 'A point' },
      { id: `${stamp}-circle`, kind: 'circle', x: cx - 240, y: cy, radius: 70, label: 'A circle' },
      { id: `${stamp}-arrow`, kind: 'arrow', fromX: cx + 300, fromY: cy + 180, toX: cx + 90, toY: cy + 30, label: 'An arrow' },
      { id: `${stamp}-highlight`, kind: 'highlight', x: cx - 150, y: cy + 130, width: 300, height: 80, label: 'A highlight' },
    ];
    sendAnnotationsToDisplay(display.id, annotations);
  }
}
