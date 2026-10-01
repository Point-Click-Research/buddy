import type { BuddyApi } from '../../shared/ipc';
import { typePlaceholder } from '../../shared/hotkeys';
// The Type to Buddy box: one autofocused text line summoned next to the
// buddy dot. Enter sends the draft (with any marks dragged out while it was
// open); Escape dismisses without sending. Main owns opening and closing —
// this page only reports the two keys and keeps the field focused.


// Injected by src/preload/index.ts.
const buddy = (window as unknown as { buddy: BuddyApi }).buddy;

const field = document.getElementById('field') as HTMLInputElement;

function showChord(chord: string): void {
  field.placeholder = typePlaceholder(chord);
}

void buddy.getSettings().then((view) => showChord(view.settings.hotkey));
buddy.onSettingsChanged((view) => showChord(view.settings.hotkey));
const chip = document.getElementById('chip')!;
const chipLabel = document.getElementById('chip-label')!;
const send = document.getElementById('send') as HTMLButtonElement;

function showChip(label: string | null): void {
  chip.hidden = !label;
  chipLabel.textContent = label ?? '';
  syncSend();
}

/** A highlight alone is enough to send; an empty field with no chip is not. */
function syncSend(): void {
  const canSend = field.value.trim() !== '' || !chip.hidden;
  send.disabled = !canSend;
}

// Dictation: partials replace one another after whatever was already typed;
// the final settles there ('' = the recording was discarded, the tail goes).
let dictationBase: string | null = null;

const shell = document.getElementById('shell')!;

buddy.onQuickAskShow((highlight) => {
  field.value = '';
  dictationBase = null;
  showChip(highlight);
  field.focus();
  // Bloom in on every open, not just the first: restart the animation.
  shell.classList.remove('bloom');
  void shell.offsetWidth; // reflow, so the class re-triggers it
  shell.classList.add('bloom');
});

buddy.onQuickAskHighlight((label) => showChip(label));

buddy.onQuickAskTranscript(({ kind, text }) => {
  if (dictationBase === null) {
    const typed = field.value.trimEnd();
    dictationBase = typed ? `${typed} ` : '';
  }
  field.value = `${dictationBase}${text}`.trimEnd();
  syncSend();
  if (kind === 'final') {
    dictationBase = null;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }
});

field.addEventListener('input', () => syncSend());

field.addEventListener('keydown', (event) => {
  event.stopPropagation();
  if (event.key === 'Enter') {
    event.preventDefault();
    buddy.submitQuickAsk(field.value);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    buddy.cancelQuickAsk();
  }
});

// Keep the caret in the field; the click still fires.
send.addEventListener('mousedown', (event) => event.preventDefault());
send.addEventListener('click', () => buddy.submitQuickAsk(field.value));

// A mark drag can wander focus-wise; typing must always land in the field.
window.addEventListener('focus', () => field.focus());
