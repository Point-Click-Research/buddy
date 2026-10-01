// The three ways a guide turn begins: a voice recording from the chord, a
// typed message from the home window, and a typed draft from the Type to
// Buddy box. Each gathers the ask (transcript, screenshots, marks, highlight)
// and hands it to runGuideTurn.

import type { AttachmentDraft } from '../../shared/attachments';
import { type RecordingResult } from '../../shared/types';
import { attachmentBlocks, attachmentChips, attachmentOnlyAsk } from './attachments';
import { stageTurnFiles } from './turn-files';
import { captureAllDisplays, type ScreenshotMeta } from '../capture';
import { setActiveConversation, startNewConversation } from '../chat/conversations';
import { observeWindowForMarks } from '../computer/observer';
import { buildMarksRequest } from '../marks/context';
import { clearMarks, pendingMarks, setLastTurnDebug, takeTurnMarks, type MarksTurn } from '../marks/marks';
import { insertMarkTokens, type WordTiming } from '../marks/transcript';
import { takeQuickAskHighlight, takeSelection } from '../selection';
import { getSettings } from '../settings';
import { answersLocally } from '../ai/brain';
import { LOCAL_SCREENSHOT_BOX, SCREENSHOT_BOX } from '../computer/provider';
import { getState, setState } from '../state';
import { broadcast } from '../windows';
import { runGuideTurn, type TurnMarks } from './guide-turn';
import { cancel, rejectIfBusy, runSession, sayNothingHeard } from './lifecycle';
import { hear, hearForMarks, type Heard } from './listening';
import { sayLine } from './say';
import { IpcChannels } from '../../shared/ipc';

/** The words of an ask, with the marks folded into them when any were drawn. */
interface Ask {
  transcript: string;
  marks?: TurnMarks;
}

/** What the hotkey step says back. The model stays out of this turn. */
export const HOTKEY_REPLY = 'Got it. Click Next.';

/** A hold-to-talk recording: transcribe + capture + ask the brain + speak. State must be `transcribing`. */
export function runVoiceAsk(recording: RecordingResult): Promise<void> {
  return runSession(async (signal) => {
    // The hotkey step answers with a fixed line.
    if (onHotkeyStep()) {
      const text = (await hear(recording, signal)).trim();
      if (signal.aborted) return;
      if (!text) {
        sayNothingHeard();
        return;
      }
      broadcast(IpcChannels.sessionTranscript, text);
      await sayLine(HOTKEY_REPLY, signal);
      return;
    }

    // STT, this turn's marks (whose native screenshots resolve now),
    // screenshots, and any pinned selection are independent; run them in
    // parallel. The selection resolves to '' when nothing was highlighted.
    const [heard, marksTurn, screenshots, selection] = await Promise.all([
      pendingMarks()
        ? hearForMarks(recording, signal)
        : hear(recording, signal).then((text): Heard => ({ text, words: null })),
      takeTurnMarks(),
      captureForTurn(),
      takeSelection(),
    ]);
    if (signal.aborted) return;
    if (!heard.text && !marksTurn) {
      sayNothingHeard();
      return;
    }

    const ask: Ask = marksTurn
      ? await foldInMarks(marksTurn, heard.text, screenshots, heard.words, recording.durationMs)
      : { transcript: heard.text };
    if (signal.aborted) return;

    broadcast(IpcChannels.sessionTranscript, ask.transcript);
    setState('thinking');
    await runGuideTurn({ ...ask, screenshots, signal, highlight: selection });
  });
}

/** The first-run hotkey step: hear them, then a fixed line. */
function onHotkeyStep(): boolean {
  return onWalkStep('hotkey');
}

/** The unfinished walk is showing this step. */
export function onWalkStep(step: string): boolean {
  const settings = getSettings();
  return !settings.onboardingDone && settings.onboardingStep === step;
}


/**
 * A typed ask from the home window: same pipeline as voice, minus the
 * microphone. A conversation id continues that conversation; null starts a
 * fresh one. Buddy still sees the screen — the home window excludes itself
 * from captures (content protection), so the chat never photographs the chat.
 */
export async function sendChatMessage(
  text: string,
  conversationId: string | null,
  attachments: AttachmentDraft[] = [],
): Promise<void> {
  const trimmed = text.trim() || (attachments.length > 0 ? attachmentOnlyAsk(attachments) : '');
  if (!trimmed) return;
  if (rejectIfBusy()) return;
  if (getState() !== 'idle') cancel();
  clearMarks(); // a new request: the last turn's marks are done
  if (conversationId) {
    if (!setActiveConversation(conversationId)) return; // deleted meanwhile
  } else {
    startNewConversation();
  }

  const chips = attachmentChips(attachments);
  // On disk too, so a tool can forward one by name. They stay until the next
  // ask stages its own: a forward's upload outlives the turn.
  stageTurnFiles(attachments);
  await runSession(async (signal) => {
    setState('thinking');
    broadcast(IpcChannels.sessionTranscript, trimmed, chips);
    const screenshots = await captureForTurn();
    if (signal.aborted) return;
    await runGuideTurn({
      transcript: trimmed,
      screenshots,
      signal,
      ...(attachments.length > 0 ? { attachments: { blocks: attachmentBlocks(attachments), chips } } : {}),
    });
  });
}

/**
 * A typed ask from the Type to Buddy box, with whatever marks were drawn
 * while it was open riding along. It continues the active conversation.
 * sendChatMessage is the wrong entry here: it clears the marks before the
 * turn — exactly the ink this ask exists to carry.
 */
export async function sendQuickAskMessage(text: string): Promise<void> {
  const trimmed = text.trim();
  const highlight = takeQuickAskHighlight();
  if (rejectIfBusy()) {
    clearMarks();
    return;
  }
  // Consume the marks before any cancel(): interrupting a mid-flight answer
  // clears the module's marks, and the strokes just drawn must survive it.
  const marksTurn = await takeTurnMarks();
  if (!trimmed && !marksTurn && !highlight) return;
  if (getState() !== 'idle') cancel();

  await runSession(async (signal) => {
    setState('thinking');
    const screenshots = await captureForTurn();
    if (signal.aborted) return;
    // A highlight with nothing typed is the same ask as the Ask Buddy button.
    const typed = trimmed || (highlight ? "Explain this in the context of what's on screen." : '');
    // No speech timeline to place tokens by: recordingMs 0 appends every
    // ⟦mark N⟧ after the typed text, and an empty draft becomes the same
    // "What is this?" a silent voice turn with marks does.
    const ask: Ask = marksTurn ? await foldInMarks(marksTurn, typed, screenshots, null, 0) : { transcript: typed };
    if (signal.aborted) return;

    broadcast(IpcChannels.sessionTranscript, ask.transcript);
    await runGuideTurn({ ...ask, screenshots, signal, highlight });
  });
}

/** This turn's screenshots: every display, or none with the eyes off. */
function captureForTurn(): Promise<ScreenshotMeta[]> {
  if (!getSettings().screenAwareness) return Promise.resolve([]);
  return captureAllDisplays(answersLocally() ? LOCAL_SCREENSHOT_BOX : SCREENSHOT_BOX);
}

/**
 * Fold the turn's user marks into the ask. With the eyes on, the marks
 * module builds the annotated screenshots, the close-up crops and the
 * per-mark context, and inserts ⟦mark N⟧ tokens where each mark was drawn
 * (a silent turn with marks becomes "What is this? ⟦mark 1⟧"). With the
 * eyes off, only the tokens go in: nothing on screen is captured or
 * described, and the prompt tells Buddy to say he can't see it.
 */
async function foldInMarks(
  turn: MarksTurn,
  transcript: string,
  screenshots: ScreenshotMeta[],
  words: WordTiming[] | null,
  recordingMs: number,
): Promise<Ask> {
  const settings = getSettings();
  if (!settings.screenAwareness) {
    const marks = turn.marks.map((mark) => ({ number: mark.number, endMs: mark.endMs }));
    return { transcript: insertMarkTokens(transcript, words, marks, recordingMs).text, marks: 'unseen' };
  }
  const request = await buildMarksRequest({
    turn,
    releaseShots: screenshots,
    transcript,
    words,
    recordingMs,
    color: settings.colorUserMarks,
    lookupElements: observeWindowForMarks,
  });
  setLastTurnDebug(request.debug);
  return { transcript: request.transcript, marks: request };
}
