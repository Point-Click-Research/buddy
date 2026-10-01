// Who the unscoped settings on this Mac belong to, the first time accounts
// are separated. One other account: they are that account's. Several: hold
// them until one of those accounts signs in. None: this account has been the
// only one, so the file is already theirs.

export type LegacyPersonalDecision = { kind: 'self' } | { kind: 'give'; id: string } | { kind: 'park' };

export function decideLegacyPersonal(others: readonly string[], foreignHistory: boolean): LegacyPersonalDecision {
  if (others.length === 1) return { kind: 'give', id: others[0]! };
  if (others.length > 1 || foreignHistory) return { kind: 'park' };
  return { kind: 'self' };
}

/** A walk exchange: the hotkey's fixed reply, or the story that belongs in memory instead. */
export function isWalkConversation(
  messages: readonly { role: string; text: string }[],
  story: string,
  hotkeyReply: string,
): boolean {
  const users = messages.filter((message) => message.role === 'user');
  const assistants = messages.filter((message) => message.role === 'assistant');
  if (users.length !== 1 || assistants.length !== 1) return false;
  if (assistants[0]!.text.trim() === hotkeyReply) return true;
  return Boolean(story.trim()) && users[0]!.text.trim() === story.trim();
}
