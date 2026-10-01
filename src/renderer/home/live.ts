// The in-progress exchange, built from the session events every window gets.
// The store persists an exchange only when it completes, so the thread's tail
// — the question being asked, the reply streaming in — lives here until the
// saved transcript has that exchange.
//
// Subscribed once at module scope: accumulating deltas inside a React effect
// would double-count under StrictMode's doubled subscriptions.

import type { Attachment } from '../../shared/attachments';
import type { CallStatus, ChatIndex, ChatMessage } from '../../shared/types';
import { buddy } from '../buddy';
import { withoutEmDash } from '../shared/markdown';

export interface LiveTurn {
  /**
   * The conversation this turn belongs to; null for a turn begun on New Chat
   * until its first exchange creates one. Only that thread renders the tail.
   */
  conversationId: string | null;
  /** The transcript so far (voice streams partials) or the typed ask. */
  user: string;
  /** The files sent with a typed ask, as chips. */
  attachments: Attachment[];
  /** Buddy's reply so far, as it is spoken or streamed. */
  assistant: string;
  /** Sources the turn's tool results have surfaced so far. */
  links: string[];
  /** The shimmer-pill label ("Searching…"); null when there is none. */
  activity: string | null;
  /** A Bland phone call this turn is placing, for the call card. */
  call: CallStatus | null;
  error: string | null;
  running: boolean;
}

const IDLE: LiveTurn = {
  conversationId: null,
  user: '',
  attachments: [],
  assistant: '',
  links: [],
  activity: null,
  call: null,
  error: null,
  running: false,
};

let turn: LiveTurn = IDLE;
/** Bumps each time a new ask starts, so a step can ignore a turn that was already on screen. */
let turnSeq = 0;
/** A finished turn stays on screen until the saved transcript has caught up. */
let settling = false;
/** The walk does not keep a chat, so a finished turn has nothing to wait for. */
let walk = false;
const listeners = new Set<() => void>();

/** Main's view of which conversation the next ask continues, and which one last got an exchange. */
let active: string | null = null;
let engaged: string | null = null;

export function subscribeLive(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLiveTurn(): LiveTurn {
  return turn;
}

/** How many asks have started. A step that opens mid-turn can tell a later ask from the one it walked in on. */
export function getLiveTurnSeq(): number {
  return turnSeq;
}

/**
 * The saved transcript has the exchange this live turn was showing. True only
 * once the turn has finished, so a reply still streaming is never treated as
 * already stored.
 */
export function exchangeLanded(messages: ChatMessage[], live: LiveTurn): boolean {
  if (live.running || !live.user.trim()) return false;
  const user = withoutEmDash(live.user.trim());
  const lastUser = messages.findLast((message) => message.role === 'user');
  return Boolean(lastUser && withoutEmDash(lastUser.text) === user);
}

/** Drop a finished turn once the thread is showing the saved copy. */
export function releaseLiveTurn(): void {
  if (!settling) return;
  settling = false;
  update({ ...IDLE });
}

function update(patch: Partial<LiveTurn>): void {
  turn = { ...turn, ...patch };
  for (const listener of listeners) listener();
}

function noteChatIndex(index: ChatIndex): void {
  active = index.activeId;
  // A turn begun on New Chat belongs to the conversation its exchange created.
  if (turn.running && turn.conversationId === null && index.engagedId && index.engagedId !== engaged) {
    update({ conversationId: index.engagedId });
  }
  engaged = index.engagedId;
}

void buddy.getChatIndex().then(noteChatIndex);
buddy.onChatChanged(noteChatIndex);

buddy.onTranscript((text, attachments = []) => {
  // Mid-turn, partials refine the user text; after a finished turn, the first
  // words of the next ask start a fresh one, clearing any leftovers.
  settling = false;
  if (!turn.running) turnSeq += 1;
  update(
    turn.running
      ? { user: text, attachments, error: null }
      : { ...IDLE, conversationId: active, user: text, attachments, running: true },
  );
});
// The stream channel follows the model, not the voice, so replies build here
// the way chat apps stream. Gated on running so nothing lands between turns.
buddy.onStreamDelta((delta) => {
  if (turn.running) update({ assistant: turn.assistant + delta });
});
buddy.onActivity((label) => update({ activity: label }));
buddy.onCallStatus((status) => {
  if (turn.running) update({ call: status });
});
// Sources appear as the searches run, not only when the reply lands.
buddy.onSessionLinks((links) => {
  if (turn.running) update({ links: [...new Set([...turn.links, ...links])] });
});
// Done: keep the question and reply up until the saved transcript arrives.
// Clearing here is what left the first message of a thread invisible — the
// conversation does not exist until this exchange is recorded.
buddy.onResponseDone(() => {
  if (!turn.user.trim() || walk) {
    settling = false;
    update({ ...IDLE });
    return;
  }
  settling = true;
  update({ running: false, activity: null, call: null });
});
buddy.onSettingsChanged((view) => {
  walk = !view.settings.onboardingDone;
});
void buddy.getSettings().then((view) => {
  walk = !view.settings.onboardingDone;
});
buddy.onSessionCancelled(() => {
  settling = false;
  update({ ...IDLE });
});
// An error outside a turn ("Buddy is busy") belongs to the thread being looked at.
buddy.onSessionError((message) => {
  settling = false;
  update({
    error: message,
    activity: null,
    call: null,
    running: false,
    ...(turn.running ? {} : { conversationId: active }),
  });
});
