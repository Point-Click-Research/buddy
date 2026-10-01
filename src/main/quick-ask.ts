// The Type to Buddy box: a small always-on-top text field summoned next to
// the buddy dot by a gesture (cursor shake, double-tap Control, or a
// press-once chord) as the typed alternative to holding the talk hotkey.
//
// Marks stay available, but the mouse is not taken just because the box is
// open: highlighting text and clicking the field have to keep working. The
// overlays capture the pointer only while the talk chord is held, the same
// gesture as point-and-talk, and give it back on release. Nothing is sent
// until Enter, which carries the draft and the ink together. Escape (or the
// gesture again) drops both.

import { isAgentActive } from './agent/agent';
import { isQuestionPending } from './agent/control-tools';
import { highlightChipLabel } from './highlight-chip';
import { clearMarks, endCapture, pendingMarks, prepareQuickAskMarks, setMarkPointer } from './marks/marks';
import { isConfirmationPending } from './mcp/confirm';
import { clearQuickAskHighlight, quickAskHighlightText, setQuickAskHighlight, takeSelection } from './selection';
import { cancelDictation, endDictation, sendQuickAskMessage, startDictation } from './session';
import { hideQuickAskWindow, raiseQuickAskWindow, sendQuickAskTranscript, showQuickAskWindow } from './windows';

let open = false;

export function isQuickAskOpen(): boolean {
  return open;
}

/** The summoning gesture toggles: doing it again with the box open closes it. */
export function toggleQuickAsk(): void {
  if (open) cancelQuickAsk();
  else openQuickAsk();
}

export function openQuickAsk(highlight = ''): void {
  if (open) return;
  // Not over an agent mid-task (the capture would steal the mouse out from
  // under its clicks) or a pending card (whose keyboard the box would take).
  if (isAgentActive() || isConfirmationPending() || isQuestionPending()) return;
  open = true;
  if (highlight) setQuickAskHighlight(highlight);
  else clearQuickAskHighlight();
  // Ready to keep marks, without taking the mouse. The "draw to point"
  // setting gates it. Eyes off still keeps the ink; the reply says the
  // marks can't be seen until that setting is on.
  prepareQuickAskMarks();
  // The chip rides in the show message: on the very first open the window is
  // still loading, and anything sent separately before then is lost.
  showQuickAskWindow(highlight ? highlightChipLabel(highlight) : null);
}

/**
 * The Ask Buddy button was clicked: the box opens with that highlight
 * already attached as the chip. Type the intent behind it, or press Enter
 * bare for a plain "explain this".
 */
export async function openQuickAskFromSelection(): Promise<void> {
  openQuickAsk((await takeSelection()).trim());
}

/**
 * The talk chord, while the box is open: hold it to speak into the field
 * (the transcript streams in as dictation) and drag to mark meanwhile.
 * Release, and the pointer is the user's again — highlighting text works
 * between marks. Never starts a voice session of its own.
 */
export function setQuickAskMarking(active: boolean, heldMs = 0): void {
  if (!open) return;
  setMarkPointer(active);
  if (active) {
    startDictation(sendQuickAskTranscript);
    return;
  }
  endDictation(heldMs);
  // The fullscreen overlay rising to take the drag can cover the field;
  // put the field back on top once the pointer is free.
  raiseQuickAskWindow();
}

/** Close without sending; the ink drawn for this ask goes with it. True = it was open. */
export function cancelQuickAsk(): boolean {
  if (!open) return false;
  open = false;
  cancelDictation();
  endCapture();
  clearMarks();
  clearQuickAskHighlight();
  hideQuickAskWindow();
  return true;
}

/** Enter: the box closes and the draft goes out with the marks still pending. */
export function submitQuickAsk(text: string): void {
  if (!open) return;
  // A highlight alone is enough: the chip is the question.
  if (!text.trim() && !pendingMarks() && !quickAskHighlightText()) return;
  open = false;
  cancelDictation(); // Enter mid-hold sends what's in the field now
  endCapture();
  hideQuickAskWindow();
  void sendQuickAskMessage(text);
}
