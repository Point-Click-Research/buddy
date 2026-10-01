// One way to message Buddy from a phone. The bridge (bridge.ts) owns the
// conversation: what a message means, the reply, the texted approvals. A
// channel only carries messages: it delivers the user's to the bridge and
// Buddy's back to the user. iMessage is the one channel today; a second
// (Telegram, say) is another file shaped like imessage.ts.

import type { IncomingFile } from './inbox';

/** The bridge's entry point: a message from the user on this channel, and any files sent with it. */
export type Receive = (channel: Channel, text: string, files: IncomingFile[]) => void;

export interface Channel {
  /** What the logs call it. Every channel's asks land in the one texts thread. */
  name: string;
  /** On, configured, and allowed right now (airplane mode off). */
  enabled(): boolean;
  /** Called every few seconds while Buddy runs: poll, connect, or nothing. */
  tick(receive: Receive): Promise<void>;
  /** Deliver one message to the user. Throws what the transport threw. */
  send(text: string): Promise<void>;
  /** Settings' Send test: prove both directions work, in the user's words. */
  test(): Promise<{ ok: boolean; message: string }>;
}
