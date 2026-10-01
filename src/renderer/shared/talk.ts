// Hold-to-talk's live signals, subscribed once at module scope: the preload's
// listeners cannot be removed, so a per-mount subscription would stack up
// every time the composer moves between the empty view and the thread.
//
// The mic level is read each frame instead of stored in React — sixty
// re-renders a second to breathe one halo is not a trade worth making.

import { buddy } from '../buddy';

export interface TalkState {
  /** The microphone is open, whether the button or the hotkey opened it. */
  listening: boolean;
  /** The configured hold-to-talk chord, for the button's label. */
  chord: string;
}

let state: TalkState = { listening: false, chord: '' };
let level = 0;
const listeners = new Set<() => void>();

function update(patch: Partial<TalkState>): void {
  if (Object.entries(patch).every(([key, value]) => state[key as keyof TalkState] === value)) return;
  state = { ...state, ...patch };
  if (!state.listening) level = 0;
  for (const listener of listeners) listener();
}

void buddy.getState().then((current) => update({ listening: current === 'listening' }));
buddy.onStateChanged((current) => update({ listening: current === 'listening' }));
void buddy.getSettings().then((view) => update({ chord: view.settings.hotkey }));
buddy.onSettingsChanged((view) => update({ chord: view.settings.hotkey }));
buddy.onMicLevel((next) => {
  level = next;
});

export function subscribeTalk(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTalkState(): TalkState {
  return state;
}

/** The mic's current loudness, 0..1. */
export function micLevel(): number {
  return level;
}
