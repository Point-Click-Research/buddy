// The iMessage channel. Every few seconds Buddy reads new texts from the
// Messages database: the saved handle, or any of this Mac's own addresses
// (texting yourself files under whichever one the phone picked), never
// anyone else, and never its own replies (it remembers what it sent).
// Replies go out through Messages. Needs Full Disk Access to read.

import { Notification } from 'electron';
import { jxaErrorMessage } from '../apple/jxa';
import { sendIMessage } from '../apple/messages';
import { createLogger } from '../log';
import { requestPermission } from '../permissions';
import { getSettings } from '../settings';
import { errorMessage } from '../../shared/errors';
import type { Channel, Receive } from './channel';
import { latestTextId, NoDiskAccessError, ownHandles, textsAfter } from './inbox';
import { sameHandle } from './parse';

const log = createLogger('texts');

/** Long enough for a report with a couple of links; the full run is in its thread. */
const MAX_TEXT = 1_500;
/** Sent texts remembered for the echo check; more than can be in flight. */
const REMEMBERED = 50;
/** How long an identical text counts as the echo of the one just read. */
const ECHO_MS = 60_000;

/** Last chat.db row read; null until the channel (re)starts, so older texts are never answered. */
let cursor: number | null = null;
/** This Mac's own addresses, read when the channel starts. */
let own: string[] = [];
let lastText = { text: '', at: 0 };
const sent: string[] = [];
let warnedDiskAccess = false;

function handle(): string {
  const settings = getSettings();
  return settings.textBridgeEnabled && !settings.airplaneMode ? settings.textBridgeHandle.trim() : '';
}

async function tick(receive: Receive): Promise<void> {
  const to = handle();
  if (!to) {
    cursor = null;
    return;
  }
  try {
    if (cursor === null) {
      own = await ownHandles();
      cursor = await latestTextId();
      return;
    }
    const { lastId, texts } = await textsAfter(cursor);
    cursor = lastId;
    const senders = [to, ...own];
    for (const { handle: from, text, files } of texts) {
      if ((!text && files.length === 0) || !senders.some((sender) => sameHandle(sender, from))) continue;
      if (text && sent.includes(text)) continue;
      // A note-to-self can land twice, once as sent and once as received.
      const key = text || files.map((file) => file.path).join('\n');
      if (key === lastText.text && Date.now() - lastText.at < ECHO_MS) continue;
      lastText = { text: key, at: Date.now() };
      receive(imessage, text, files);
    }
  } catch (error) {
    if (error instanceof NoDiskAccessError) warnDiskAccess(error.message);
    else throw error;
  }
}

async function send(body: string): Promise<void> {
  const text = body.length > MAX_TEXT ? `${body.slice(0, MAX_TEXT - 1)}…` : body;
  sent.push(text.trim());
  if (sent.length > REMEMBERED) sent.shift();
  await sendIMessage(getSettings().textBridgeHandle.trim(), text);
}

/** Once per launch: the channel is on but can't read, and nobody would know why. */
function warnDiskAccess(message: string): void {
  if (warnedDiskAccess || !Notification.isSupported()) return;
  warnedDiskAccess = true;
  log.warn(message);
  const notification = new Notification({ title: 'Buddy can’t read your texts', body: message });
  notification.on('click', () => void requestPermission('fullDisk'));
  notification.show();
}

async function test(): Promise<{ ok: boolean; message: string }> {
  if (!getSettings().textBridgeHandle.trim()) return { ok: false, message: 'Add your phone number first.' };
  try {
    await latestTextId();
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
  try {
    await send("Hey, it's Buddy. Text me here whenever and I'll take care of it from your Mac.");
  } catch (error) {
    return { ok: false, message: jxaErrorMessage(error, 'Messages') };
  }
  return {
    ok: true,
    message: getSettings().textBridgeEnabled
      ? 'Sent. Check your phone.'
      : 'Sent. Now turn on "Answer my texts" so Buddy replies.',
  };
}

export const imessage: Channel = {
  name: 'iMessage',
  enabled: () => handle() !== '',
  tick,
  send,
  test,
};
