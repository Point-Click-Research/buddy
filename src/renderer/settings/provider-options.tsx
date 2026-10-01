// Provider rows for MenuSelect, shared by the Voice, Ears, and Brain pages.
// A provider Buddy can already serve is just selectable. "+ Add" appears on
// any other, since a pasted key is the way in.

import type { AccountView, KeyProvider, KeyStatus } from '../../shared/types';
import { providerAccess } from '../../shared/provider-access';
import { buddy } from '../buddy';
import type { MenuSelectOption } from '../ui';

export function keyedOption<T extends KeyProvider>(
  account: AccountView | null,
  keys: KeyStatus,
  id: T,
  label: string,
): MenuSelectOption<T> {
  const access = providerAccess(account, keys[id], id);
  return {
    value: id,
    label,
    disabled: access !== 'ready',
    inertWhenDisabled: access !== 'add',
    detail: access === 'add' ? <span className="font-medium text-ink">+ Add</span> : undefined,
  };
}

/** Where a disabled "+ Add" row sends the user. */
export function openProviders(): void {
  buddy.openSettingsWindow('providers');
}

/** Which Providers tab a "providers:local" jump (URL hash) asked for. */
export function consumeProvidersTab(): 'cloud' | 'local' {
  return window.location.hash.slice(1).split(':')[1] === 'local' ? 'local' : 'cloud';
}
