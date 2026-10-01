// The conversation store: every exchange lands in a conversation that
// survives restarts, so the user can come back tomorrow and pick up where
// they left off. Owns which conversation is active — the one the next ask
// continues — and the model context that resuming it restores.
//
// Two views of the same conversation live here. The display transcript
// (ChatMessage[]) is what the home window renders; the model context
// (MessageParam[]) is what the next request sends. The live context keeps the
// latest turn's screenshots for the follow-up; the persisted copy never does,
// so the store stays small and a resumed conversation loads instantly.
// An agent task's work log is display-only while it runs. When it finishes,
// one exchange (the request, what the user heard, the log, the links) is
// appended to the model context so the next ask can use what the task made.

import { randomUUID } from 'crypto';
import Store from 'electron-store';
import { isWalkConversation } from '../account/personal-split';
import { legacyBelongsToAccount } from '../account/scope';
import { getSettings } from '../settings/store';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { Attachment } from '../../shared/attachments';
import type {
  ChatIndex,
  ChatMessage,
  ConversationSummary,
  ConversationView,
  MessageSource,
} from '../../shared/types';
import { appendTurns, correctUserText, withoutImages } from '../ai/history';
import { clearNotedMerchants } from '../payment/merchant';
import { agentOutcomeTurns } from './agent-context';
import { nameConversation, TITLE_LIMIT } from './title';

const MAX_CONVERSATIONS = 100;

/** What a conversation is called before its summarized name arrives. */
const PENDING_TITLE = 'New chat';

interface StoredConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  /** Model context to resume with; images already pruned. */
  context: MessageParam[];
  /** The title is the model's summary, not a clip of the first ask. */
  named?: boolean;
  /** The one thread every job and suggestion reports into. */
  background?: boolean;
  /** The one thread texts from the user's phone land in. */
  texts?: boolean;
  /** Background work wrote here since the user last opened it. */
  unread?: boolean;
}

/** The threads Buddy keeps, not the user: read in the home window, never written to there. */
type OwnThread = 'background' | 'texts';
/** What each is called in the sidebar. */
const OWN_TITLES: Record<OwnThread, string> = { background: "Buddy's work", texts: 'Texts from your phone' };

interface ConversationFile {
  /** Written before chats were kept per account. Claimed or parked on the next sign-in. */
  conversations: StoredConversation[];
  byUser: Record<string, StoredConversation[]>;
  parked: StoredConversation[];
}

const file = new Store<ConversationFile>({
  name: 'conversations',
  defaults: { conversations: [], byUser: {}, parked: [] },
});

/** Whose chats `list` returns. Null shows nothing (signed out). */
let ownerId: string | null = null;

/** The conversation the next ask continues; null = it starts a fresh one. */
let activeId: string | null = null;
/** The conversation an exchange landed in this run; never restored from disk. */
let engagedId: string | null = null;
/** The active conversation's model context, latest screenshots included. */
let liveContext: MessageParam[] = [];
/**
 * Where the turn in flight records: the active conversation when it began.
 * Its context was read then, so a thread switch mid-answer must not move the
 * reply. undefined between turns.
 */
let turnTarget: string | null | undefined;

let listener: ((index: ChatIndex) => void) | null = null;

/** One listener is enough: ipc.ts broadcasts to every window. */
export function onConversationsChanged(cb: (index: ChatIndex) => void): void {
  listener = cb;
}

/** Show this account's chats. Null hides them. The open thread does not carry over. */
export function setConversationOwner(id: string | null): void {
  if (ownerId === id) return;
  ownerId = id;
  activeId = null;
  engagedId = null;
  liveContext = [];
  turnTarget = undefined;
  clearNotedMerchants();
  foldLegacyTexts();
  changed();
}

/**
 * Texts once landed in an untagged chat of the texts thread's name, a new one
 * each launch. Fold them into one texts thread, oldest message first; the
 * newest keeps its model context.
 */
function foldLegacyTexts(): void {
  const conversations = list();
  if (conversations.some((conversation) => conversation.texts)) return;
  const legacy = conversations.filter((conversation) => conversation.title === OWN_TITLES.texts);
  const [keep, ...rest] = legacy;
  if (!keep) return;
  keep.texts = true;
  keep.messages = legacy.flatMap((conversation) => conversation.messages).sort((a, b) => a.at - b.at);
  save(conversations.filter((conversation) => !rest.includes(conversation)));
}

/** Account ids that already have a chat list on this Mac. */
export function conversationAccountIds(): string[] {
  return Object.keys(file.get('byUser') ?? {});
}

/** Chats set aside for an account this Mac no longer has signed in. */
export function hasParkedConversations(): boolean {
  return file.get('parked').length > 0;
}

/** Drop every chat on the signed-in account. Used once, when that account was sharing someone else's file. */
export function clearOwnedChats(): void {
  if (list().length === 0) return;
  activeId = null;
  engagedId = null;
  liveContext = [];
  save([]);
  changed();
}

/**
 * Remove walk exchanges already saved: the hotkey's fixed reply, and the
 * story, which lives in memory. A chat that continued past that stays.
 */
export function dropWalkChats(story: string, hotkeyReply: string): void {
  const kept = list().filter((conversation) => !isWalkConversation(conversation.messages, story, hotkeyReply));
  if (kept.length === list().length) return;
  if (activeId && !kept.some((conversation) => conversation.id === activeId)) {
    activeId = null;
    liveContext = [];
  }
  if (engagedId && !kept.some((conversation) => conversation.id === engagedId)) engagedId = null;
  save(kept);
  changed();
}

/** Oldest unscoped chat, or null when that file is already empty. */
export function legacyConversationOldest(): number | null {
  const rows = file.get('conversations');
  if (rows.length === 0) return null;
  let oldest = rows[0]!.createdAt;
  for (const row of rows) if (row.createdAt < oldest) oldest = row.createdAt;
  return oldest;
}

/**
 * The unscoped file is a mix once someone new signs in. Chats from before
 * that account are parked; chats from after it stay with them.
 */
export function separateLegacyConversations(userId: string, createdAt: number | null): void {
  const rows = file.get('conversations');
  if (rows.length === 0) return;
  const keep: StoredConversation[] = [];
  const older: StoredConversation[] = [];
  for (const row of rows) {
    if (legacyBelongsToAccount(row.createdAt, createdAt)) keep.push(row);
    else older.push(row);
  }
  if (older.length > 0) file.set('parked', [...file.get('parked'), ...older]);
  if (keep.length > 0) {
    const byUser = { ...(file.get('byUser') ?? {}) };
    byUser[userId] = [...(byUser[userId] ?? []), ...keep];
    file.set('byUser', byUser);
  }
  file.set('conversations', []);
}

function changed(): void {
  listener?.(getChatIndex());
}

export function getChatIndex(): ChatIndex {
  return { conversations: list().map(summarize), activeId, engagedId };
}

export function getConversation(id: string): ConversationView | null {
  const found = list().find((conversation) => conversation.id === id);
  return found ? { id: found.id, title: found.title, messages: found.messages } : null;
}

/** The user opened this conversation: what is in it, and it is no longer unread. */
export function readConversation(id: string): ConversationView | null {
  const conversations = list();
  const found = conversations.find((conversation) => conversation.id === id);
  if (found?.unread) {
    delete found.unread;
    save(conversations);
    changed();
  }
  return getConversation(id);
}

/**
 * Newest-first summaries for the past-conversation tools. The active chat is
 * left out: it is already in the model's context, and listing it first is how
 * a lookup ends up reading the thread it was asked from.
 */
export interface ListedConversation extends ConversationSummary {
  /** The goal of the newest agent task in the chat. Null when it never ran one. */
  agentTask: string | null;
}

/** The newest agent task in any saved chat, including the one underway. */
export function latestAgentTask(): { id: string; title: string; goal: string; current: boolean } | null {
  let best: { id: string; title: string; goal: string; at: number } | null = null;
  for (const conversation of list()) {
    for (const message of conversation.messages) {
      const goal = agentGoal(message);
      if (!goal || (best && message.at <= best.at)) continue;
      best = { id: conversation.id, title: conversation.title, goal, at: message.at };
    }
  }
  return best ? { id: best.id, title: best.title, goal: best.goal, current: best.id === activeId } : null;
}

export function listRecentConversations(limit: number): ListedConversation[] {
  return list()
    .filter((conversation) => conversation.id !== activeId)
    .slice(0, limit)
    .map((conversation) => ({ ...summarize(conversation), agentTask: newestAgentGoal(conversation) }));
}

export function deleteConversation(id: string): ChatIndex {
  save(list().filter((conversation) => conversation.id !== id));
  if (activeId === id) {
    activeId = null;
    liveContext = [];
  }
  if (engagedId === id) engagedId = null;
  changed();
  return getChatIndex();
}

/**
 * Make this conversation the one the next ask continues, restoring its
 * persisted context. No-op (and false) when it doesn't exist.
 */
export function setActiveConversation(id: string): boolean {
  if (activeId === id) return true;
  const found = list().find((conversation) => conversation.id === id);
  if (!found) return false;
  // Buddy's own threads are read, never continued: an ask while one is open starts a fresh chat.
  if (found.background || found.texts) {
    startNewConversation();
    return true;
  }
  activeId = id;
  liveContext = found.context;
  // Merchants noted for fill_payment belong to the conversation that noted them.
  clearNotedMerchants();
  changed();
  return true;
}

/** The next ask starts a fresh conversation. */
export function startNewConversation(): void {
  if (activeId === null) return;
  activeId = null;
  liveContext = [];
  clearNotedMerchants();
  changed();
}

/** The model context for the next request. Do not mutate. */
export function activeContext(): MessageParam[] {
  return liveContext;
}

/** A stored thread's model context (last exchanges, images pruned). Do not mutate. */
export function conversationContext(id: string): MessageParam[] {
  return list().find((conversation) => conversation.id === id)?.context ?? [];
}

/** A turn is starting: pin the conversation its exchange will land in. */
export function beginTurn(): void {
  turnTarget = activeId;
}

/**
 * One of Buddy's own threads, one each per account. "background": every
 * job's report and every suggestion Buddy ran, each line tagged with its
 * source, instead of a chat per job. "texts": the conversation with the
 * user's phone, answered there. Created on first use, and again if it was
 * deleted. Never becomes active or engaged by being created.
 */
export function ownThread(which: OwnThread): string {
  const existing = list().find((conversation) => conversation[which]);
  if (existing) return existing.id;
  const now = Date.now();
  const conversation: StoredConversation = {
    id: randomUUID(),
    title: OWN_TITLES[which],
    createdAt: now,
    updatedAt: now,
    messages: [],
    context: [],
    named: true,
    [which]: true,
  };
  save([...list(), conversation]);
  changed();
  return conversation.id;
}

/**
 * Record one completed exchange into the active conversation, creating it
 * (named from how it opened) when there is none. `turns` extends the model
 * context; empty turns record transcript only (e.g. an agent-task handoff).
 * `links` are the sources the reply's tool results surfaced.
 * `options.agent` marks the line as an agent-task handover the run fills in.
 */
export function recordExchange(
  userText: string,
  assistantText: string,
  turns: MessageParam[],
  links: string[] = [],
  options?: ExchangeOptions,
): void {
  const targetId = turnTarget === undefined ? activeId : turnTarget;
  turnTarget = undefined;
  // The walk remembers the story as memory. It does not keep a chat.
  if (!getSettings().onboardingDone) return;

  const conversations = list();
  let conversation = conversations.find((entry) => entry.id === targetId);
  const fresh = !conversation;
  if (!conversation) {
    const now = Date.now();
    conversation = {
      id: randomUUID(),
      title: PENDING_TITLE,
      createdAt: now,
      updatedAt: now,
      messages: [],
      context: [],
    };
    conversations.push(conversation);
    // A fresh chat becomes the active one — unless the user moved to another
    // thread while Buddy was answering, in which case it lands in the list.
    if (targetId === activeId) activeId = conversation.id;
  }
  engagedId = conversation.id;
  appendExchange(conversations, conversation, userText, assistantText, turns, links, options);
  // The opening exchange is what the conversation is about; later ones
  // don't rename it.
  if (fresh) scheduleName(conversation.id, userText, assistantText);
}

/**
 * Record one completed exchange into a known conversation, leaving the
 * active/engaged bookkeeping alone — the write path for background runs.
 * Nobody was looking, so the thread reads as unread until it is opened.
 * No-op when the conversation was deleted meanwhile.
 */
export function recordExchangeIn(
  conversationId: string,
  userText: string,
  assistantText: string,
  turns: MessageParam[],
  options?: ExchangeOptions,
): void {
  const conversations = list();
  const conversation = conversations.find((entry) => entry.id === conversationId);
  if (!conversation) return;
  conversation.unread = true;
  appendExchange(conversations, conversation, userText, assistantText, turns, [], options);
}

/** What else an exchange's lines carry: the agent handover, the background source, the files the user sent. */
interface ExchangeOptions {
  agent?: boolean;
  source?: MessageSource;
  attachments?: Attachment[];
}

/** The shared tail: transcript lines, model context, save, broadcast. An empty user side (background work) writes no user line. */
function appendExchange(
  conversations: StoredConversation[],
  conversation: StoredConversation,
  userText: string,
  assistantText: string,
  turns: MessageParam[],
  links: string[],
  options?: ExchangeOptions,
): void {
  const now = Date.now();
  if (userText.trim()) {
    conversation.messages.push({
      role: 'user',
      text: userText,
      at: now,
      ...(options?.attachments?.length ? { attachments: options.attachments } : {}),
    });
  }
  if (assistantText.trim()) {
    conversation.messages.push({
      role: 'assistant',
      text: assistantText.trim(),
      at: now,
      ...(links.length > 0 ? { links } : {}),
      ...(options?.agent ? { agent: { thought: '', pending: true } } : {}),
      ...(options?.source ? { source: options.source } : {}),
    });
  }
  if (conversation.id === activeId) {
    liveContext = appendTurns(liveContext, turns);
    conversation.context = withoutImages(liveContext);
  } else {
    conversation.context = withoutImages(appendTurns(conversation.context, turns));
  }
  conversation.updatedAt = now;
  save(conversations);
  changed();
}

// --- Agent task trace --------------------------------------------------------
// The handover line is written before the task runs. These fill its thought
// in as Buddy works, then record what Buddy said when the task ended.

const TRACE_FLUSH_MS = 400;

interface TraceTarget {
  conversationId: string;
  index: number;
}

/** The handover line the running task is filling in. */
let target: TraceTarget | null = null;
let pendingThought: string | null = null;
let traceTimer: NodeJS.Timeout | null = null;
let lastFlushAt = 0;

/** Latch the newest open handover so this run's notes land on that line. */
export function claimAgentTrace(): void {
  if (!target) target = newestPending();
}

/** Buddy's inner reasoning so far. Flushed on a short interval, not per token. */
export function noteAgentThought(thought: string): void {
  if (!target) return;
  pendingThought = thought;
  const due = TRACE_FLUSH_MS - (Date.now() - lastFlushAt);
  if (due <= 0) {
    flushThought();
    return;
  }
  if (traceTimer) return;
  traceTimer = setTimeout(flushThought, due);
}

/**
 * The task is over: store the full thought and what Buddy said, and append
 * that run to the model context. `toolText` is the run's tool results, scanned
 * for links the work log never repeated.
 */
export function finishAgentTrace(thought: string, said: string, toolText = ''): void {
  if (traceTimer) {
    clearTimeout(traceTimer);
    traceTimer = null;
  }
  pendingThought = null;
  const current = target;
  target = null;
  if (!current) return;
  const logged = thought.trim();
  const spoken = said.trim();
  writeTrace(current, { thought: logged, said: spoken, settle: true });
  rememberAgentOutcome(current, logged, spoken, toolText);
}

/**
 * Close a handover this run is not filling in: a second task asked while one
 * was already going, or Escape before the run started. The live line is left alone.
 */
export function settleStrayAgentTrace(said: string): void {
  settlePending(said, target);
}

/** Close handovers a quit left hanging, so they don't read as still running. */
export function settleAbandonedAgentTraces(): void {
  settlePending('The task stopped before it finished.', null);
}

function flushThought(): void {
  traceTimer = null;
  if (!target || pendingThought === null) return;
  const thought = pendingThought;
  pendingThought = null;
  lastFlushAt = Date.now();
  writeTrace(target, { thought });
}

function newestPending(): TraceTarget | null {
  let best: TraceTarget | null = null;
  let bestAt = -1;
  for (const conversation of list()) {
    conversation.messages.forEach((message, index) => {
      if (!message.agent?.pending || message.at < bestAt) return;
      best = { conversationId: conversation.id, index };
      bestAt = message.at;
    });
  }
  return best;
}

function settlePending(said: string, except: TraceTarget | null): void {
  const conversations = list();
  let dirty = false;
  for (const conversation of conversations) {
    let touched = false;
    conversation.messages.forEach((message, index) => {
      if (!message.agent?.pending) return;
      if (except && except.conversationId === conversation.id && except.index === index) return;
      delete message.agent.pending;
      if (!message.agent.said && said) message.agent.said = said;
      touched = true;
    });
    if (!touched) continue;
    conversation.updatedAt = Date.now();
    dirty = true;
  }
  if (!dirty) return;
  save(conversations);
  changed();
}

/**
 * The handover wrote display text only. This is the exchange the next chat
 * turn receives: the request that started the task, then what the run produced.
 */
function rememberAgentOutcome(
  trace: TraceTarget,
  thought: string,
  said: string,
  toolText: string,
): void {
  const conversations = list();
  const conversation = conversations.find((entry) => entry.id === trace.conversationId);
  if (!conversation) return;
  const prior = conversation.messages[trace.index - 1];
  const userText = prior?.role === 'user' ? prior.text : '';
  const turns = agentOutcomeTurns(userText, thought, said, toolText);
  if (turns.length === 0) return;

  // The task's conversation may no longer be the active one. Its stored
  // context is what resuming it restores; the live copy is only the active chat.
  if (conversation.id === activeId) {
    liveContext = appendTurns(liveContext, turns);
    conversation.context = withoutImages(liveContext);
  } else {
    conversation.context = withoutImages(appendTurns(conversation.context, turns));
  }
  conversation.updatedAt = Date.now();
  save(conversations);
  changed();
}

function writeTrace(
  trace: TraceTarget,
  patch: { thought?: string; said?: string; settle?: boolean },
): void {
  const conversations = list();
  const conversation = conversations.find((entry) => entry.id === trace.conversationId);
  const message = conversation?.messages[trace.index];
  if (!conversation || !message?.agent) return;
  const agent = message.agent;
  let dirty = false;
  if (patch.thought !== undefined && patch.thought !== agent.thought) {
    agent.thought = patch.thought;
    dirty = true;
  }
  if (patch.said && patch.said !== agent.said) {
    agent.said = patch.said;
    dirty = true;
  }
  if (patch.settle && agent.pending) {
    delete agent.pending;
    dirty = true;
  }
  if (!dirty) return;
  conversation.updatedAt = Date.now();
  save(conversations);
  changed();
}

/**
 * Name the conversations saved before Buddy summarized them — and retry the
 * ones whose naming failed (no connection, no key). Call once at startup.
 */
export function backfillTitles(): void {
  for (const conversation of list()) {
    if (conversation.named) continue;
    const user = conversation.messages.find((message) => message.role === 'user')?.text ?? '';
    const assistant = conversation.messages.find((message) => message.role === 'assistant')?.text ?? '';
    if (user) scheduleName(conversation.id, user, assistant);
  }
}

/** Names run one after another: a backlog of chats is not a burst of calls. */
let naming: Promise<void> = Promise.resolve();

function scheduleName(id: string, userText: string, assistantText: string): void {
  naming = naming
    .then(async () => {
      // It may have been deleted, or named, while it waited its turn.
      const pending = list().find((entry) => entry.id === id);
      if (!pending || pending.named) return;
      const name = await nameConversation(userText, assistantText);
      const conversations = list();
      const conversation = conversations.find((entry) => entry.id === id);
      if (!conversation) return;
      // Without a name, the clipped first ask still beats "New chat"; leaving
      // `named` unset means the next startup tries again.
      conversation.title = name ?? makeTitle(userText);
      if (name) conversation.named = true;
      save(conversations);
      changed();
    })
    // One failed rename must not take the chats queued behind it down too.
    .catch(() => undefined);
}

/** Apply a transcript correction to the conversation the exchange just landed in, both views. */
export function correctActiveUserText(from: string, to: string): boolean {
  const conversations = list();
  const conversation = conversations.find((entry) => entry.id === engagedId);
  if (!conversation) return correctUserText(liveContext, from, to);
  for (let i = conversation.messages.length - 1; i >= 0; i--) {
    const message = conversation.messages[i]!;
    if (message.role !== 'user' || message.text !== from) continue;
    message.text = to;
    break;
  }
  let fixed: boolean;
  if (conversation.id === activeId) {
    fixed = correctUserText(liveContext, from, to);
    conversation.context = withoutImages(liveContext);
  } else {
    fixed = correctUserText(conversation.context, from, to);
  }
  save(conversations);
  changed();
  return fixed;
}

function list(): StoredConversation[] {
  if (!ownerId) return [];
  return file.get('byUser')?.[ownerId] ?? [];
}

/** Write the list back, newest first, dropping the oldest past the cap. */
function save(conversations: StoredConversation[]): void {
  if (!ownerId) return;
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  file.set('byUser', { ...(file.get('byUser') ?? {}), [ownerId]: sorted.slice(0, MAX_CONVERSATIONS) });
}

/** The goal off a handover line. The display text is "Started an agent task: {goal}". */
function agentGoal(message: ChatMessage): string | null {
  if (!message.agent) return null;
  const goal = message.text.replace(/^Started an agent task:\s*/i, '').trim();
  return goal || null;
}

function newestAgentGoal(conversation: StoredConversation): string | null {
  let best: { goal: string; at: number } | null = null;
  for (const message of conversation.messages) {
    const goal = agentGoal(message);
    if (!goal || (best && message.at <= best.at)) continue;
    best = { goal, at: message.at };
  }
  return best?.goal ?? null;
}

function summarize(conversation: StoredConversation): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
    ...(conversation.background ? { background: true } : {}),
    ...(conversation.texts ? { texts: true } : {}),
    ...(conversation.unread ? { unread: true } : {}),
  };
}

/** The fallback title when naming is unavailable: the first ask, clipped at a word boundary. */
function makeTitle(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= TITLE_LIMIT) return clean || 'New conversation';
  const cut = clean.slice(0, TITLE_LIMIT);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > TITLE_LIMIT / 2 ? cut.slice(0, lastSpace) : cut}…`;
}
