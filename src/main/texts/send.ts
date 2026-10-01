// Reaching the user when they aren't at the Mac: every channel that is on.
// Background jobs and parked approvals speak through here; a reply to a
// message goes back on the channel it came from (bridge.ts). Buddy opening
// the conversation after hours of quiet says hello first, like anyone would;
// a reply, or the next line in an exchange, just says it.

import { signInRequired } from '../account/credentials';
import { createLogger } from '../log';
import type { Channel } from './channel';
import { imessage } from './imessage';
import { plainText } from './parse';
import { errorMessage } from '../../shared/errors';
import { withHello } from '../../shared/greeting';

const log = createLogger('texts');

export const CHANNELS: Channel[] = [imessage];

/** When the last message went either way, on any channel. */
let lastContactAt = 0;

/** A message came in from the phone: the exchange is live. */
export function noteContact(): void {
  lastContactAt = Date.now();
}

/** Some channel to the user's phone is on, and Buddy is allowed to answer (signed in where required). */
export function bridgeOn(): boolean {
  return !signInRequired() && CHANNELS.some((channel) => channel.enabled());
}

/** Message the user on every channel that is on. A failed send is logged, never fatal to the run that sent it. */
export async function textMe(body: string): Promise<void> {
  const text = withHello(body, Date.now() - lastContactAt);
  await Promise.all(CHANNELS.filter((channel) => channel.enabled()).map((channel) => deliver(channel, text)));
}

/** One message on one channel, as plain text, failure logged. */
export async function deliver(channel: Channel, body: string): Promise<void> {
  noteContact();
  try {
    await channel.send(plainText(body));
  } catch (error) {
    log.warn(`${channel.name}: send failed: ${errorMessage(error)}`);
  }
}
