// What a spoken ask is, decided by Jev before the brain is chosen: whether
// it needs the deep model, which tool it most likely ends in, and (with
// agent mode on) whether it means working inside an app, which is a task to
// propose. One request, sub-second — and the answer to the first saves
// seconds, because a lookup the regex router would have sent to the deep
// model answers on the fast one. Null answers mean "no opinion", and the
// regex router (router.ts) decides as it always has.
//
// Pure: the Jev is passed in, and the tests fake it.

import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { JEV_CONFIDENT, JEV_MAX_OPTIONS, type Jev, type JevAsk, type JevOptions } from './jev';
import { looksLikeSmallTalk } from './router';
import type { ToolRegistry } from './tools';

export interface TurnIntent {
  /** Jev's verdict on needing the deep model, or null for no opinion. */
  deep: boolean | null;
  /** The tool the ask most likely ends in, when Jev is confident; else null. */
  tool: string | null;
  /** Jev is confident the ask means working inside an app or page: a task to propose. */
  drive: boolean;
  /** Small talk with nothing to look at or do: the turn goes out without screenshots or tools. */
  chat: boolean;
}

export const NO_INTENT: TurnIntent = { deep: null, tool: null, drive: false, chat: false };

const NONE = 'none';

/** Registered only when agent mode is on; the drive question is asked only then. */
const PROPOSE_TASK = 'propose_task';

/**
 * Whether the ask is done by working an app's or page's own window. Opening
 * an app is a command; everything after it (a shape on a canvas, a new
 * document typed into) is clicking, and that is a task.
 */
const DRIVE: JevOptions = {
  yes: "Doing it means working inside an app's or web page's window: clicking, drawing, or typing in it, such as adding a shape in Figma, writing in a new TextEdit document, filling in a form, or fixing something Buddy just did in an app that the user says came out wrong",
  no: 'An answer, a lookup, one command, or an action a single tool finishes (send a message, play music, open an app and stop there)',
};

/**
 * The kinds of ask, worded for a literal reader. Only the first is a fast-
 * model answer: everything that ends in a tool call or in reasoning is
 * where the fast model fails, by arguing from the conversation (or the
 * screenshot) instead of acting or thinking.
 */
const KINDS: JevOptions = {
  chat: 'Small talk with no question and nothing to do: a hello, thanks, a check-in like "you there", "what\'s up", "hey buddy"',
  read_screen:
    'A question answered by looking at the screen or from general knowledge: what something on screen says or means, where a control is, a general fact',
  look_up:
    "A question answered only by a tool, from the user's own accounts and connected apps or from Buddy itself: their email, calendar, or orders, which account an app is connected with, what Buddy is set up to do, a price or stock right now",
  act: 'An instruction to do something: open, click, type, send, play, pause, remember, search for, find, buy, book, call, run',
  work_out: 'Needs reasoning or writing: why, how, compare, explain, plan, debug, review, or draft a reply',
};

/** How much of a tool's description Jev sees: enough to tell tools apart, not the whole manual. */
const DESCRIPTION_CHARS = 240;
/** Enough of Buddy's last reply to read a follow-up ("that's not a circle") against. */
const PREVIOUS_CHARS = 400;

/** Buddy's last words in the conversation, clipped; '' at the start of one. */
export function lastReply(history: readonly MessageParam[]): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]!;
    if (message.role !== 'assistant') continue;
    const text =
      typeof message.content === 'string'
        ? message.content
        : message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(' ');
    if (text.trim()) return text.trim().slice(0, PREVIOUS_CHARS);
  }
  return '';
}

/**
 * `previous` is Buddy's last reply: a follow-up like "that's not a circle"
 * means nothing alone, and is a correction of the task that just ran.
 */
export async function readIntent(
  jev: Jev | null,
  transcript: string,
  tools: ToolRegistry,
  previous = '',
): Promise<TurnIntent> {
  if (!transcript.trim()) return NO_INTENT;
  // The words alone settle a plain hello. No Jev call, no screenshots, no tools.
  if (looksLikeSmallTalk(transcript)) return { deep: false, tool: null, drive: false, chat: true };
  if (!jev) return NO_INTENT;
  // Annotation tools (point, draw) are how the fast model answers about the
  // screen; they are not the kind of tool call this routing is about.
  const candidates = [...tools.values()].filter((tool) => !tool.immediate).slice(0, JEV_MAX_OPTIONS - 1);
  const options: JevOptions = Object.fromEntries(
    candidates.map((tool) => [tool.definition.name, (tool.definition.description ?? '').slice(0, DESCRIPTION_CHARS)]),
  );
  options[NONE] = 'No tool: answer in words, or point at and draw on the screen';

  const asks: Record<string, JevAsk> = {
    kind: {
      question: `What kind of ask is \`ask\`, spoken to a voice assistant that sees the screen?${previous ? ' It may follow up on `previous_reply`, what the assistant said last.' : ''}`,
      options: KINDS,
    },
    tool: { question: 'Which one tool does answering `ask` most likely end in calling?', options },
  };
  if (tools.has(PROPOSE_TASK)) {
    asks.drive = {
      question: `Does doing \`ask\` mean working inside an app or web page window?${previous ? ' Read it against `previous_reply`.' : ''}`,
      options: DRIVE,
    };
  }
  const state: Record<string, string> = previous ? { ask: transcript, previous_reply: previous } : { ask: transcript };
  const { kind, tool, drive } = await jev.choices(state, asks);
  const confident = (choice: { confidence: number } | null | undefined): choice is { choice: string; confidence: number } =>
    choice != null && choice.confidence >= JEV_CONFIDENT;
  // Small talk only when both reads agree: a hello that Jev thinks ends in a tool is not one.
  const chat = confident(kind) && kind.choice === 'chat' && (!confident(tool) || tool.choice === NONE);
  return {
    deep: confident(kind) ? kind.choice !== 'read_screen' && kind.choice !== 'chat' : null,
    tool: confident(tool) && tool.choice !== NONE ? tool.choice : null,
    drive: !chat && confident(drive) && drive.choice === 'yes',
    chat,
  };
}

/** The user-turn line that passes a confident read on to the model, or nothing. */
export function toolHint(intent: TurnIntent): string | undefined {
  if (intent.drive) {
    return 'This ask means working inside an app or page: propose_task for the whole job now, opening the app included as the first step. Do not open it first and stop.';
  }
  return intent.tool ? `This ask most likely ends in the ${intent.tool} tool. A hint, not an order.` : undefined;
}
