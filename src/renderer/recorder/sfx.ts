// Sound effects: short UI cues played from the hidden recorder window, which
// already exists solely for audio and may autoplay without a user gesture.
// Every trigger arrives over broadcasts the visible windows already receive,
// so main needs no extra wiring.

import type { AppState } from '../../shared/types';
import cardOverlayUrl from './sounds/card-overlay.mp3';
import errorUrl from './sounds/error.mp3';
import talkingUrl from './sounds/talking.mp3';
import taskFinishedUrl from './sounds/task-finished.mp3';
import workingUrl from './sounds/working.mp3';
import type { BuddyApi } from '../../shared/ipc';

// Injected by src/preload/index.ts.
const buddy = (window as unknown as { buddy: BuddyApi }).buddy;

const clips = {
  /** The hotkey went down and the mic opened. */
  talking: new Audio(talkingUrl),
  /** The hotkey came up (or a typed ask was sent) and Buddy is processing. */
  working: new Audio(workingUrl),
  /** An agent task ran to completion (not every chat reply). */
  taskFinished: new Audio(taskFinishedUrl),
  /** An error bubble appeared. */
  error: new Audio(errorUrl),
  /** A confirm/ask card appeared on the overlay. */
  cardOverlay: new Audio(cardOverlayUrl),
};

let enabled = true;
const applyEnabled = ({ settings }: { settings: { sfxEnabled: boolean } }): void => {
  enabled = settings.sfxEnabled;
};
void buddy.getSettings().then(applyEnabled);
buddy.onSettingsChanged(applyEnabled);

function play(name: keyof typeof clips): void {
  if (!enabled) return;
  const clip = clips[name];
  clip.currentTime = 0;
  void clip.play().catch(() => {}); // no mp3, no sound; never a crash
}

// The listening cue fires on hotkey down; the working cue fires once the
// press ends (listening -> transcribing) or a typed turn starts (idle ->
// thinking). Transcribing -> thinking stays silent: that work already chimed.
let previous: AppState = 'idle';
buddy.onStateChanged((state) => {
  if (state === 'listening') play('talking');
  else if (state === 'transcribing') play('working');
  else if (state === 'thinking' && previous !== 'transcribing') play('working');
  previous = state;
});

// Ordinary chat replies stay silent; only agent tasks earn the finished
// chime. A task announces itself with agent:log-reset, and the first
// response-done after that is the task ending. A failed or stopped task
// never sends response-done — it reports through session:error instead,
// which plays the error sound and disarms the chime.
let agentTaskRunning = false;
buddy.onAgentLogReset(() => (agentTaskRunning = true));
buddy.onResponseDone(() => {
  if (agentTaskRunning) play('taskFinished');
  agentTaskRunning = false;
});
buddy.onSessionError(() => {
  agentTaskRunning = false;
  play('error');
});
// The Type to Buddy box opening is the same "I'm listening" moment as the
// hotkey going down. Sending it plays the working cue through the state
// change (idle -> thinking) above; closing without sending stays silent.
buddy.onQuickAskOpenChanged((open) => {
  if (open) play('talking');
});

buddy.onMcpConfirm((card) => {
  if (card) play('cardOverlay');
});
buddy.onAskQuestion((card) => {
  if (card) play('cardOverlay');
});
