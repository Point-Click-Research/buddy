// Dictated speech for this window's focused field, subscribed once at
// module scope: the preload's listeners cannot be removed, so a per-mount
// subscription would stack up every time a field mounts.

import type { DictationTranscript } from '../../../shared/types';
import { buddy } from '../../buddy';

type Listener = (event: DictationTranscript) => void;

const listeners = new Set<Listener>();

buddy.onDictation((event) => {
  for (const listener of listeners) listener(event);
});

export function subscribeDictation(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
