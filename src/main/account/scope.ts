/**
 * Chats and suggestions written before accounts were separated live in one
 * file on the Mac. They belong to the signed-in account when they were
 * saved after that account existed. A slack covers a chat started in the
 * same minute as sign-up.
 */
const SAME_SIGNUP_MS = 2 * 60_000;

export function legacyBelongsToAccount(oldest: number | null, createdAt: number | null): boolean {
  if (oldest === null || createdAt === null || !Number.isFinite(createdAt)) return true;
  return oldest >= createdAt - SAME_SIGNUP_MS;
}
