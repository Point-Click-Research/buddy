// Message Buddy from anywhere. The channel (iMessage) carries the messages;
// this is the conversation. A message answers whatever Buddy last asked (a
// plan, a card, a question from a running task, a parked job approval), or
// it is a new turn in that channel's thread, answered on the same channel.
// Parked job approvals go out to every channel that is on, one at a time,
// oldest first.
//
// A sleeping Mac can't answer, so while a channel is on Buddy keeps it from
// idle-sleeping; the display still sleeps until a task needs it. With the lid
// closed and no display the Mac sleeps anyway, and messages wait until it wakes.

import { powerSaveBlocker } from 'electron';
import type { RemoteUser } from '../agent/control-tools';
import { friendlyApiError } from '../ai/api-errors';
import { resolveApproval, type ApprovalDecision } from '../jobs/approvals';
import { takeMomentReply } from '../jobs/moments';
import { ownThread } from '../chat/conversations';
import { firstLine } from '../jobs/run';
import { getJobsView } from '../jobs/store';
import { createLogger } from '../log';
import { errorMessage } from '../../shared/errors';
import { ATTACHMENT_LIMITS } from '../../shared/attachments';
import type { Channel } from './channel';
import { textedDrafts } from './files';
import { imessage } from './imessage';
import type { IncomingFile } from './inbox';
import { approvalReply } from './parse';
import { bridgeOn, CHANNELS, deliver, noteContact, textMe } from './send';
import { runTextTurn } from './turn';

const log = createLogger('texts');

const POLL_MS = 5_000;
/** Work running this long with nothing texted yet: say so. A chat reply never does. */
const ACK_MS = 8_000;
/** A question Buddy texted waits this long for the reply before the turn goes on without one. */
const REPLY_TIMEOUT_MS = 10 * 60_000;

/** The parked job approval Buddy texted about and is waiting on. */
let awaiting: string | null = null;
/** A question a running turn texted (a plan, a card, ask_user): the whole next message answers it. */
let pendingReply: ((text: string) => void) | null = null;
let asksRunning = 0;
let ticking = false;
/**
 * Files texted on their own ("here", then "send this to Sanna"), held for
 * the next text on the channel. A photo alone is not an ask; the words
 * after it say what to do with it. Stale after HOLD_MS.
 */
const heldFiles = new Map<Channel, { files: IncomingFile[]; at: number }>();
const HOLD_MS = 30 * 60_000;
let keepAwakeId: number | null = null;

/** Start the clock. Call once at app launch; channels that are off idle. */
export function startTextBridge(): void {
  if (process.platform !== 'darwin') return;
  setInterval(() => void tick(), POLL_MS);
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  const on = bridgeOn();
  syncKeepAwake(on);
  if (!on) awaiting = null;
  try {
    for (const channel of CHANNELS) {
      await channel.tick(receive).catch((error) => log.warn(`${channel.name}: ${errorMessage(error)}`));
    }
    // A turn's own asks come first; a parked job approval waits for a quiet moment.
    if (on && asksRunning === 0) await textNextApproval();
  } finally {
    ticking = false;
  }
}

/** A message from the user: the answer to what Buddy asked, a word on a moment it offered, or a turn in the thread. */
function receive(channel: Channel, text: string, files: IncomingFile[]): void {
  noteContact();
  if (files.length > 0) {
    const held = heldFiles.get(channel);
    const kept = held && Date.now() - held.at < HOLD_MS ? held.files : [];
    heldFiles.set(channel, { files: [...kept, ...files].slice(-ATTACHMENT_LIMITS.count), at: Date.now() });
  }
  if (!text) return;
  if (pendingReply) {
    pendingReply(text);
    return;
  }
  const decision = awaiting ? approvalReply(text) : null;
  if (awaiting && decision) {
    void answerApproval(channel, awaiting, decision);
    return;
  }
  const moment = takeMomentReply(text);
  if (moment === 'no') void deliver(channel, 'Got it.');
  else void ask(channel, moment ? moment.prompt : text);
}

async function answerApproval(channel: Channel, id: string, decision: ApprovalDecision): Promise<void> {
  awaiting = null;
  if (!isPending(id)) {
    await deliver(channel, 'Looks like that one already got handled on your Mac.');
    return;
  }
  if (decision === 'deny') {
    await resolveApproval(id, decision);
    await deliver(channel, 'Got it, skipping that.');
    return;
  }
  // The call's own output is raw data (JSON, an API error); the text says how it went.
  const { ok, result } = await resolveApproval(id, decision);
  await deliver(channel, ok ? 'Done, that went through.' : `That didn't go through: ${firstLine(result)}`);
}

async function ask(channel: Channel, prompt: string): Promise<void> {
  asksRunning += 1;
  // Every text for this ask goes out in order: the acknowledgment, what
  // Buddy says and asks as it works, then the outcome.
  let outbox = Promise.resolve();
  let sent = false;
  const send = (text: string): Promise<void> => {
    sent = true;
    outbox = outbox.then(() => deliver(channel, text));
    return outbox;
  };
  const user: RemoteUser = {
    say: (text) => void send(text),
    ask: (question, options) =>
      awaitReply(send(options.length > 0 ? `${question}\nReply with one: ${options.join(' / ')}` : question)),
  };
  // "On it" is for a tool or task that is actually running. A conversation
  // that is just slow to answer stays quiet until the reply itself.
  let working = false;
  const acknowledge = (): void => {
    if (working && !sent) user.say('On it.');
  };
  let pendingAck: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    pendingAck = null;
    acknowledge();
  }, ACK_MS);
  const onWork = (): void => {
    working = true;
    if (pendingAck === null) acknowledge();
  };
  try {
    const conversationId = ownThread('texts');
    const held = heldFiles.get(channel);
    heldFiles.delete(channel);
    const files = held && Date.now() - held.at < HOLD_MS ? await textedDrafts(held.files) : [];
    const reply = await runTextTurn({ prompt, files, conversationId, user, onWork });
    if (reply) user.say(reply);
  } catch (error) {
    log.warn(`ask failed: ${errorMessage(error)}`);
    user.say(firstLine(friendlyApiError(error)));
  } finally {
    if (pendingAck) clearTimeout(pendingAck);
    await outbox;
    asksRunning -= 1;
  }
}

/** Once the question has gone out, the whole next message is its answer; null when none comes in time. */
function awaitReply(delivered: Promise<void>): Promise<string | null> {
  return new Promise((resolve) => {
    const finish = (text: string | null): void => {
      clearTimeout(timer);
      pendingReply = null;
      resolve(text);
    };
    const timer = setTimeout(() => finish(null), REPLY_TIMEOUT_MS);
    void delivered.then(() => {
      pendingReply = finish;
    });
  });
}

/** Send the oldest parked approval, unless one is already out and still unanswered. */
async function textNextApproval(): Promise<void> {
  if (awaiting && isPending(awaiting)) return;
  const next = getJobsView().approvals[0];
  awaiting = next?.id ?? null;
  if (!next) return;
  const lead = `${next.source} wants to: ${next.title}`;
  const options = next.always ? 'YES to go ahead, NO to skip, ALWAYS to stop asking about this.' : 'YES to go ahead, NO to skip.';
  await textMe([lead, next.detail, options].filter(Boolean).join('\n'));
}

/** Still parked: not yet resolved here, in the job's conversation, or with its job deleted. */
function isPending(id: string): boolean {
  return getJobsView().approvals.some((approval) => approval.id === id);
}

/** Awake to read texts whenever a channel is on; the lid being open is the user's choice to allow it. */
function syncKeepAwake(on: boolean): void {
  if (on && keepAwakeId === null) {
    keepAwakeId = powerSaveBlocker.start('prevent-app-suspension');
  } else if (!on && keepAwakeId !== null) {
    powerSaveBlocker.stop(keepAwakeId);
    keepAwakeId = null;
  }
}

/** Settings' Send test. */
export function testTextBridge(): Promise<{ ok: boolean; message: string }> {
  return imessage.test();
}
