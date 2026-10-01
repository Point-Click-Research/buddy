// The landing shot in the middle of the window: the spiral, the burst, then
// the sphere scales away and the sign-in fades up where it was. Mounted only
// while the sign-in gate is up.

import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import modelUrl from '../stage/buddy-dot.glb?url';
import { HOLD, Shot, useStageClock } from '../stage';
import { useSettingsView } from '../home/settings-data';
import humUrl from '../recorder/sounds/sign-in-hum.mp3';
import finishedUrl from '../recorder/sounds/task-finished.mp3';
import { cn } from '../ui';
import { SignInForm } from './SignInForm';

const humSound = new Audio(humUrl);
/** The library's bloom. It starts the frame the shockwave appears. */
const burstSound = new Audio(finishedUrl);

export function SignInScene(): ReactElement {
  const reduced = useReducedMotion() ?? false;
  const clock = useStageClock(HOLD);
  const markRef = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(false);
  const sfx = useRef(true);
  sfx.current = useSettingsView()?.settings.sfxEnabled ?? true;
  const ready = reduced || gone;

  useEffect(
    () => () => {
      humSound.pause();
      burstSound.pause();
    },
    [],
  );

  const playHum = (): void => {
    if (!sfx.current) return;
    humSound.currentTime = 0;
    void humSound.play().catch(() => {});
  };

  const playBurst = (): void => {
    if (!sfx.current) return;
    humSound.pause();
    burstSound.currentTime = 0;
    void burstSound.play().catch(() => {});
  };

  return (
    <div className="app-drag fixed inset-0 z-50 grid place-items-center bg-canvas">
      {ready ? null : (
        <Shot
          clock={clock}
          markRef={markRef}
          modelUrl={modelUrl}
          onStart={playHum}
          onContact={playBurst}
          onGone={() => setGone(true)}
        />
      )}
      <div ref={markRef} className="col-start-1 row-start-1 size-32" />
      <div
        className={cn(
          'app-no-drag relative z-10 col-start-1 row-start-1 flex w-72 flex-col items-center gap-5 transition-[opacity,filter,transform] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
          ready ? 'translate-y-0 opacity-100 blur-none' : 'pointer-events-none translate-y-1.5 opacity-0 blur-[6px]',
        )}
        inert={!ready}
      >
        <h1 className="m-0 text-[25px] font-medium">Sign in to Buddy</h1>
        <SignInForm fill />
      </div>
    </div>
  );
}
