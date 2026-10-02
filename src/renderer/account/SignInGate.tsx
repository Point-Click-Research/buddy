// The whole window while this build has a Buddy account and nobody is signed
// in, or, in a build with no account service, until Buddy is first launched.
// The shot itself loads only then: the signed-in window never pulls it.

import { lazy, Suspense, useEffect, useState, type ReactElement } from 'react';
import { buddy } from '../buddy';
import { useSettingsView } from '../home/settings-data';
import { useAccount } from '../shared/account-data';

const SignInScene = lazy(() => import('./SignInScene').then((m) => ({ default: m.SignInScene })));

// Preload listeners cannot be removed. One subscription, fan out to the gate.
let reveals = 0;
const revealSubs = new Set<() => void>();
buddy.onHomeReveal(() => {
  reveals += 1;
  for (const sub of revealSubs) sub();
});

export function SignInGate(): ReactElement | null {
  const account = useAccount();
  const launched = useSettingsView()?.settings.onboardingDone;
  // Closing the chat window hides it without tearing down React. Remount the
  // shot only when that window is shown again. Opening the Google sign-in
  // browser covers the window and must leave the form where it is.
  const [playId, setPlayId] = useState(reveals);
  useEffect(() => {
    const sub = (): void => setPlayId(reveals);
    revealSubs.add(sub);
    return () => {
      revealSubs.delete(sub);
    };
  }, []);
  // The window is built hidden and warmed at launch. The shot (and its sound)
  // waits for the first time the window is actually on screen. Only the first:
  // on macOS a window covering this one also reads as hidden.
  const [shown, setShown] = useState(!document.hidden);
  useEffect(() => {
    if (shown) return;
    const onVisible = (): void => {
      if (!document.hidden) setShown(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [shown]);

  if (!shown || !account) return null;
  if (account.configured ? account.signedIn : launched !== false) return null;
  return (
    <Suspense fallback={<div className="fixed inset-0 z-50 bg-canvas" />}>
      <SignInScene key={playId} launch={!account.configured} />
    </Suspense>
  );
}
