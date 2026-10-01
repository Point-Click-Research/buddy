// Chats, suggestions, and the first-run walk belong to the signed-in account.
// They used to live in one file on the Mac, so a new sign-in kept the
// previous account's threads and skipped a walk that account had already finished.

import Store from 'electron-store';
import { stashPersonal, switchPersonal } from './personal';
import {
  clearOwnedChats,
  conversationAccountIds,
  dropWalkChats,
  hasParkedConversations,
  legacyConversationOldest,
  separateLegacyConversations,
  setConversationOwner,
} from '../chat/conversations';
import {
  claimLegacyJobs,
  hasParkedJobs,
  jobAccountIds,
  legacyJobsOldest,
  parkLegacyJobs,
  setJobsOwner,
} from '../jobs/store';
import { HOTKEY_REPLY } from '../session/asks';
import { getSettings, updateSettings } from '../settings/store';
import { broadcastSettings } from '../settings-view';
import { accountConfigured } from './config';
import { legacyBelongsToAccount } from './scope';

interface ScopeFile {
  /** Accounts that finished the walk on this Mac. */
  onboarded: string[];
  /** Where each account's unfinished walk stands (account id → step id), so a quit mid-walk resumes there. */
  walkStep: Record<string, string>;
  /** The pre-account onboardingDone flag has already been given to its owner. */
  legacyWalkClaimed: boolean;
  /** Accounts whose walk chats have already been taken out of history. */
  walkCleared: string[];
  /** Accounts that have had the tour after the walk. */
  toured: string[];
}

const scope = new Store<ScopeFile>({
  name: 'account-scope',
  defaults: { onboarded: [], walkStep: {}, legacyWalkClaimed: false, walkCleared: [], toured: [] },
});

/** Who the open stores are showing. Null while signed out. */
let bound: string | null = null;

/**
 * Point the local stores at this account. A build with no account service
 * keeps one shared store. Null hides the previous account's data until
 * someone signs in.
 */
export function bindLocalAccount(user: { id: string; createdAt: number } | null): void {
  if (!accountConfigured()) {
    adopt('local', null);
    return;
  }
  adopt(user?.id ?? null, user?.createdAt ?? null);
}

/** The walk just finished for whoever is signed in. */
export function noteFinishedOnboarding(): void {
  if (!bound) return;
  noteWalkStep('');
  if (scope.get('onboarded').includes(bound)) return;
  scope.set('onboarded', [...scope.get('onboarded'), bound]);
}

/** The tour runs once per account. True the first time it is claimed. */
export function claimTour(): boolean {
  if (!bound || scope.get('toured').includes(bound)) return false;
  scope.set('toured', [...scope.get('toured'), bound]);
  return true;
}

/** The tour will play once more for the signed-in account (Settings → Controls, or a dev walk restart). */
export function reopenTour(): void {
  if (!bound) return;
  scope.set('toured', scope.get('toured').filter((id) => id !== bound));
}

/** They stepped back off a finished walk: it is unfinished again, for this account. */
export function reopenWalk(): void {
  if (!bound) return;
  scope.set(
    'onboarded',
    scope.get('onboarded').filter((id) => id !== bound),
  );
}

/**
 * Dev: the signed-in account (or this Mac, with no account) walks from the
 * start again. Returns that account id so the hello can be said again.
 */
export function restartWalk(): string | null {
  reopenWalk();
  noteWalkStep('');
  reopenTour();
  if (getSettings().onboardingDone || getSettings().onboardingStep) {
    updateSettings({ onboardingDone: false, onboardingStep: '', onboardingStory: '', onboardingStorySaved: false });
    broadcastSettings();
  }
  return bound;
}

/** The signed-in account moved to this step of the walk ('' = back at the start, or finished). */
export function noteWalkStep(step: string): void {
  if (!bound) return;
  const { [bound]: _current, ...others } = scope.get('walkStep');
  scope.set('walkStep', step ? { ...others, [bound]: step } : others);
}

function adopt(id: string | null, createdAt: number | null): void {
  if (id === bound) return;
  if (bound) stashPersonal(bound);
  if (!id) {
    bound = null;
    setConversationOwner(null);
    setJobsOwner(null);
    return;
  }
  const oldest = earliestLegacy();
  const foreign = oldest !== null && !legacyBelongsToAccount(oldest, createdAt);
  separateLegacyConversations(id, createdAt);
  if (foreign) parkLegacyJobs();
  else claimLegacyJobs(id);
  const others = otherAccountIds(id);
  const personal = switchPersonal(id, createdAt, others, hasParkedConversations() || hasParkedJobs(), oldest);
  bound = id;
  // The old flag was one per Mac. Give it to the account that owns the
  // unscoped file, once. A later account walks through onboarding itself.
  if (!foreign && !scope.get('legacyWalkClaimed') && getSettings().onboardingDone) noteFinishedOnboarding();
  if (!scope.get('legacyWalkClaimed')) scope.set('legacyWalkClaimed', true);
  setConversationOwner(id);
  setJobsOwner(id);
  if (!scope.get('walkCleared').includes(id)) {
    if (personal === 'cleaned') clearOwnedChats();
    else dropWalkChats(getSettings().onboardingStory, HOTKEY_REPLY);
    scope.set('walkCleared', [...scope.get('walkCleared'), id]);
  }
  const done = scope.get('onboarded').includes(id);
  const step = scope.get('walkStep')[id] ?? '';
  const settings = getSettings();
  if (settings.onboardingDone !== done || settings.onboardingStep !== step) {
    updateSettings({ onboardingDone: done, onboardingStep: step });
    broadcastSettings();
  }
}

/** Every account this Mac has already kept chats, jobs, or a walk for, besides the one signing in. */
function otherAccountIds(id: string): string[] {
  const ids = new Set<string>([
    ...scope.get('onboarded'),
    ...Object.keys(scope.get('walkStep')),
    ...conversationAccountIds(),
    ...jobAccountIds(),
  ]);
  ids.delete(id);
  return [...ids];
}

function earliestLegacy(): number | null {
  const times = [legacyConversationOldest(), legacyJobsOldest()].filter((time): time is number => time !== null);
  if (times.length === 0) return null;
  let oldest = times[0]!;
  for (const time of times) if (time < oldest) oldest = time;
  return oldest;
}
