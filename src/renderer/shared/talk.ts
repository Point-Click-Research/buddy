// Hold-to-talk's live signals, subscribed once at module scope: the preload's
// listeners cannot be removed, so a per-mount subscription would stack up
// every time the composer moves between the empty view and the thread.

import { buddy } from '../buddy';

export interface TalkState {
  /** The microphone is open, whether the button or the hotkey opened it. */
  listening: boolean;
  /** The configured hold-to-talk chord, for the button's label. */
  chord: string;
}

let state: TalkState = { listening: false, chord: '' };
const listeners = new Set<() => void>();

function update(patch: Partial<TalkState>): void {
  if (Object.entries(patch).every(([key, value]) => state[key as keyof TalkState] === value)) return;
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

void buddy.getState().then((current) => update({ listening: current === 'listening' }));
buddy.onStateChanged((current) => update({ listening: current === 'listening' }));
void buddy.getSettings().then((view) => update({ chord: view.settings.hotkey }));
buddy.onSettingsChanged((view) => update({ chord: view.settings.hotkey }));

export function subscribeTalk(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTalkState(): TalkState {
  return state;
}
