// Whether a cloud provider can be picked. A saved key always works. Otherwise
// a signed-in account uses Buddy's key when that provider is on the plan,
// and a missing key means "go add one".

export type ProviderAccess = 'ready' | 'add' | 'pending';

export function providerAccess(
  account: { signedIn: boolean; managed: readonly string[] } | null,
  hasKey: boolean,
  id: string,
): ProviderAccess {
  if (hasKey) return 'ready';
  if (!account) return 'pending';
  if (account.signedIn && account.managed.includes(id)) return 'ready';
  return 'add';
}
