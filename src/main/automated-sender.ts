// Mail from a system rather than a person: a no-reply address, a
// notifications feed, a bounce. Nobody reads a reply to it, so inbox lines
// say so and the models never draft one.

const AUTOMATED_LOCAL =
  /^(?:.*[._+-])?(?:no-?reply|do-?not-?reply|donotreply|notify|notifications?|alerts?|automated|mailer-daemon|postmaster|bounces?)(?:[._+-].*)?$/i;

/** True when the sender's address (as shown, "Name <a@b>" or bare) is an automated one. */
export function isAutomatedSender(sender: string): boolean {
  const address = (/<([^>]+)>/.exec(sender)?.[1] ?? sender).trim();
  const at = address.indexOf('@');
  return at > 0 && AUTOMATED_LOCAL.test(address.slice(0, at));
}

/** The sender as an inbox line shows it, tagged when no one is there to reply to. */
export function senderLabel(sender: string): string {
  return isAutomatedSender(sender) ? `${sender} (automated, no reply)` : sender;
}
