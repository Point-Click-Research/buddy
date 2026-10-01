// One-shot: type a draft into whatever field the user has focused.
// No agent loop, no plan approval — it works with agent mode off. Nothing
// here takes focus, so the field they were typing in is still the field
// that receives the text, and the text stays editable in place.

import { screen } from 'electron';
import { isExcludedAppName } from '../agent/open-app';
import type { DriverSafetyHooks } from '../computer/claim';
import type { ComputerProvider } from '../computer/provider';
import { createComputerProvider } from '../computer/select';
import { copySelectedText, COPY_MAX_CHARS } from '../reader/copy';
import { frontmostApp, frontmostFocusedRole } from '../reader/frontmost';
import { getSettings } from '../settings';
import type { ToolOutcome } from './tools';

/** Focused-element roles that take typed text. A web page in focus counts: its field may not report itself. */
const TEXT_ROLES = new Set(['AXTextArea', 'AXTextField', 'AXComboBox', 'AXWebArea']);

/** Typing here is the user's own request, not an agent acting on its own. */
const quietHooks: DriverSafetyHooks = {
  recordKey: () => {},
  recordMousePosition: () => {},
  markTyping: () => {},
  markMouseActivity: () => {},
};

// The last draft this tool typed, so a revision can swap it out rather than
// type the new text into the middle of the old one (wherever the user's
// cursor happens to sit). Kept only in memory: a revision is always asked
// for moments after the insert it revises.
let lastInserted = '';

export async function insertDraft(
  text: string,
  replaces: boolean,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const trimmed = text.trim();
  if (!trimmed) return { content: 'The draft was empty.', isError: true };
  if (process.platform !== 'darwin') {
    return { content: 'Inserting a draft is only available on macOS.', isError: true };
  }

  const app = await frontmostApp();
  if (app && isExcludedAppName(app.name, getSettings().agentExcludedApps)) {
    return {
      content: `${app.name} is on the excluded-apps list, so I won't type into it.`,
      isError: true,
    };
  }

  // Typing with nothing to type into (an app still on its file picker, a
  // button in focus) would lose the draft and still report success. Refuse
  // only when the focus is known and is not a place for text; when it can't
  // be read, type as before.
  const role = await frontmostFocusedRole();
  if (role !== null && !TEXT_ROLES.has(role)) {
    const where = app?.name ?? 'the front app';
    return {
      content: `No text box is selected in ${where}, so nothing was typed. Something has to be opened first (a new document, a reply). If you can propose tasks, propose one that opens it and types the text; otherwise tell the user to open it.`,
      isError: true,
    };
  }

  const displayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
  const { provider } = await createComputerProvider(displayId, quietHooks);
  try {
    if (replaces) return await replaceDraft(provider, trimmed, signal);
    const outcome = await provider.act({ name: 'type', input: { text: trimmed } }, signal);
    if (outcome.error) {
      return { content: `I couldn't type that: ${outcome.error.detail}`, isError: true };
    }
    lastInserted = trimmed;
    return { content: 'inserted' };
  } finally {
    await provider.close();
  }
}

/**
 * A revision: select the whole field, read it back, swap the old draft for
 * the new text, and type the result over the selection. Reading first means
 * the user's cursor position never matters, and anything else in the field
 * (a quoted thread under a reply) is kept rather than typed into.
 */
async function replaceDraft(
  provider: ComputerProvider,
  draft: string,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const selectAll = await provider.act({ name: 'key', input: { text: 'cmd+a' } }, signal);
  if (selectAll.error) {
    return { content: `I couldn't select the field: ${selectAll.error.detail}`, isError: true };
  }
  const content = normalize(await copySelectedText(null));
  const previous = normalize(lastInserted);

  if (content.length >= COPY_MAX_CHARS) {
    // The read was clipped; retyping it would silently drop the rest.
    await collapseSelection(provider, signal);
    return {
      content: 'Not replaced: the field is too large to rewrite safely. Ask the user to select the old draft first.',
      isError: true,
    };
  }
  // An empty field has nothing to keep; the new draft is simply typed.
  const replacement = content
    ? previous && content.includes(previous)
      ? content.replace(previous, draft)
      : null
    : draft;
  if (replacement === null) {
    await collapseSelection(provider, signal);
    return {
      content:
        'Not replaced: the field no longer contains the draft I typed earlier. ' +
        'Ask the user to clear or select the old text, then insert the new draft without replaces_draft.',
      isError: true,
    };
  }

  const outcome = await provider.act({ name: 'type', input: { text: replacement } }, signal);
  if (outcome.error) {
    return { content: `I couldn't type the revision: ${outcome.error.detail}`, isError: true };
  }
  lastInserted = draft;
  return { content: 'replaced' };
}

/** Put the caret back: a stray keystroke on a select-all would wipe the field. */
async function collapseSelection(provider: ComputerProvider, signal: AbortSignal): Promise<void> {
  await provider.act({ name: 'key', input: { text: 'right' } }, signal);
}

/** Clipboard reads may carry \r\n; compare and rewrite in one newline flavor. */
function normalize(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}
