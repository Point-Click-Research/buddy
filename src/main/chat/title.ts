// Naming a conversation: a few words that say what it was about, so the
// sidebar reads as a list of topics rather than clipped first asks.

import { answersLocally, askBrain, fastOverrides } from '../ai/brain';
import { createLogger } from '../log';

const log = createLogger('chat-title');

const TIMEOUT_MS = 30_000;
/** An opening this long has already said what the conversation is about. */
const MAX_INPUT_CHARS = 600;
/** The sidebar row is narrow; anything past this would be truncated anyway. */
export const TITLE_LIMIT = 48;

const SYSTEM = `You name a conversation the way a person labels it in a sidebar: what it was about, in 2 to 5 words.

Title case. No quotes, no trailing punctuation, no prefix like "Chat about". Name the subject, not the request: "Kith shopping", "Italian restaurant booking", "Resume refinement". Reply with the name and nothing else.`;

/**
 * A name for this conversation from how it opened, or null when the model
 * is unavailable or gave nothing usable — the caller keeps its own fallback.
 */
export async function nameConversation(
  userText: string,
  assistantText: string,
): Promise<string | null> {
  // A local model keeps one cached prompt; a title would push out the turn's.
  if (answersLocally()) return null;
  try {
    const name = await askBrain(
      `They asked: ${clip(userText)}\n\nBuddy replied: ${clip(assistantText) || '(nothing yet)'}`,
      SYSTEM,
      AbortSignal.timeout(TIMEOUT_MS),
      fastOverrides(),
    );
    return tidy(name);
  } catch (error) {
    log.warn(`naming failed: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

function clip(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  return clean.length > MAX_INPUT_CHARS ? `${clean.slice(0, MAX_INPUT_CHARS)}…` : clean;
}

/** The first line, stripped of the wrapping a model sometimes adds. */
function tidy(reply: string): string | null {
  const name = (reply.split('\n', 1)[0] ?? '')
    .trim()
    .replace(/^["'“”]+|["'“”.]+$/g, '')
    .trim();
  return name && name.length <= TITLE_LIMIT ? name : null;
}
