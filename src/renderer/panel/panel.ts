// Panel entry point: a developer inspector (dev builds only) showing the live
// state, transcript, streaming response, sources, and the agent action log.

import { linkLabel } from '../../shared/link-text';
import { APP_NAME, type AgentLogEntry, type AppState } from '../../shared/types';
import { buildSourceChip } from '../shared/source-chip';
import type { BuddyApi } from '../../shared/ipc';

// Injected by src/preload/index.ts.
const buddy = (window as unknown as { buddy: BuddyApi }).buddy;

document.getElementById('title')!.textContent = APP_NAME;

const statePill = document.getElementById('state')!;
const micMeter = document.getElementById('mic-meter')!;
const micFill = document.getElementById('mic-fill')!;

function showState(state: AppState): void {
  statePill.textContent = state;
  statePill.dataset['state'] = state;
  micMeter.hidden = state !== 'listening';
}

void buddy.getState().then(showState);

buddy.onMicLevel((level) => {
  micFill.style.width = `${Math.round(level * 100)}%`;
});

// --- Always-on badge and last recording -------------------------------------

const alwaysOnPill = document.getElementById('always-on')!;
const showAlwaysOn = (on: boolean): void => {
  alwaysOnPill.hidden = !on;
};
void buddy.getAlwaysOn().then(showAlwaysOn);
buddy.onAlwaysOnChanged(showAlwaysOn);

// --- Transcript, streaming response, errors ----------------------------------

const transcriptEl = document.getElementById('transcript')!;
const transcriptText = document.getElementById('transcript-text')!;
const responseEl = document.getElementById('response')!;
const errorEl = document.getElementById('error')!;

const EDIT_WINDOW_MS = 20_000;
let originalTranscript = '';
let editTimer: ReturnType<typeof setTimeout> | null = null;

buddy.onTranscript((text) => {
  originalTranscript = text;
  transcriptEl.hidden = false;
  transcriptText.textContent = text;
  lockTranscript();
  // A new question starts a new response and clears old errors and sources.
  responseEl.hidden = false;
  responseEl.textContent = '';
  errorEl.hidden = true;
  clearSources();
});

buddy.onStateChanged((state) => {
  showState(state);
  if (state === 'thinking' && originalTranscript) unlockTranscript();
});

function unlockTranscript(): void {
  transcriptText.contentEditable = 'true';
  if (editTimer) clearTimeout(editTimer);
  editTimer = setTimeout(lockTranscript, EDIT_WINDOW_MS);
}

function lockTranscript(): void {
  if (editTimer) clearTimeout(editTimer);
  editTimer = null;
  transcriptText.contentEditable = 'false';
}

function commitTranscript(): void {
  const corrected = (transcriptText.textContent ?? '').trim();
  if (!corrected || corrected === originalTranscript) return;
  void buddy.learnDictionary(originalTranscript, corrected);
  originalTranscript = corrected;
}

transcriptText.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey) return;
  event.preventDefault();
  transcriptText.blur();
});
transcriptText.addEventListener('blur', commitTranscript);

// The panel keeps the whole session, so a new message only starts a new line.
buddy.onMessageStart(() => {
  if (responseEl.textContent) responseEl.textContent += '\n';
});

buddy.onResponseDelta((delta) => {
  responseEl.hidden = false;
  responseEl.textContent += delta;
  responseEl.scrollTop = responseEl.scrollHeight;
});

buddy.onSessionError((message) => {
  errorEl.hidden = false;
  errorEl.textContent = message;
});

// --- Sources -------------------------------------------------------------------
// Links a tool result mentioned, so the user can read what the answer came
// from. Opened in the default browser, never inside a Buddy window.

const sourcesEl = document.getElementById('sources')!;
const sourceList = document.getElementById('source-list')!;
const shownLinks = new Set<string>();

buddy.onSessionLinks((links) => {
  for (const url of links) {
    if (shownLinks.has(url)) continue;
    shownLinks.add(url);
    // The panel is wider than the overlay corner, so show the path too.
    sourceList.append(buildSourceChip(buddy, url, linkLabel(url, 40)));
  }
  sourcesEl.hidden = shownLinks.size === 0;
});

function clearSources(): void {
  shownLinks.clear();
  sourceList.replaceChildren();
  sourcesEl.hidden = true;
}

// --- Agent action log ---------------------------------------------------------

const agentLog = document.getElementById('agent-log')!;
const agentLogList = document.getElementById('agent-log-list')!;
const saveLogResult = document.getElementById('save-log-result')!;

function appendLogEntry(entry: AgentLogEntry): void {
  agentLog.hidden = false;
  const row = document.createElement('div');
  row.className = 'log-entry';
  if (entry.thumbnail) {
    const img = document.createElement('img');
    img.src = entry.thumbnail;
    row.append(img);
  }
  const text = document.createElement('div');
  const head = document.createElement('div');
  head.className = 'log-action';
  head.textContent = `${entry.index} · ${entry.action}`;
  const args = document.createElement('div');
  args.className = 'log-args';
  args.textContent = entry.args === '{}' ? '' : entry.args;
  const reasoning = document.createElement('div');
  reasoning.className = 'log-reasoning';
  reasoning.textContent = entry.reasoning;
  text.append(head, args, reasoning);
  row.append(text);
  agentLogList.append(row);
  agentLogList.scrollTop = agentLogList.scrollHeight;
}

buddy.onAgentLogAppend(appendLogEntry);
buddy.onAgentLogReset(() => {
  agentLogList.replaceChildren();
  saveLogResult.hidden = true;
  agentLog.hidden = true;
});
void buddy.getAgentLog().then((entries) => entries.forEach(appendLogEntry));

document.getElementById('save-log')!.addEventListener('click', async () => {
  const path = await buddy.saveAgentLog();
  saveLogResult.hidden = false;
  saveLogResult.textContent = path ? `Saved to ${path}` : 'Nothing saved.';
});

document.getElementById('open-settings')!.addEventListener('click', () => {
  buddy.openSettingsWindow();
});
