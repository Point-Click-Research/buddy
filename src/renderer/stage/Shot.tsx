import {
  motion,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { useCallback, useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import { BuddyDot } from './BuddyDot';
import { DEFAULT_RADIUS } from './clock';
import { Cursor } from './Cursor';
import { cursorPose, LAND, restTime, sceneAt, stageGeometry, type StageClock } from './timeline';
import './shot.css';

interface Sprite {
  x: MotionValue<number>;
  y: MotionValue<number>;
  opacity: MotionValue<number>;
}

function useSprite(): Sprite {
  return { x: useMotionValue(0), y: useMotionValue(0), opacity: useMotionValue(0) };
}

/**
 * The landing shot: one clock drives the sphere, the cursor, the glow, and
 * the burst. `markRef` is the box the sphere settles on. `onContact` fires
 * the frame the shockwave appears, `onLanded` when the spiral ends, and
 * `onGone` when a clock with an exit has finished scaling the sphere away.
 */
export function Shot({
  clock,
  markRef,
  modelUrl,
  onContact,
  onStart,
  onLanded,
  onGone,
}: {
  clock: RefObject<StageClock>;
  markRef: RefObject<HTMLDivElement | null>;
  modelUrl: string;
  onContact?: () => void;
  /** Once the model is ready and the spiral clock starts. */
  onStart?: () => void;
  onLanded?: () => void;
  onGone?: () => void;
}): ReactElement {
  const reduced = useReducedMotion() ?? false;
  const rootRef = useRef<HTMLDivElement>(null);
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const cues = useRef({ onContact, onStart, onLanded, onGone, contact: false, landed: false, gone: false, started: false });
  cues.current.onContact = onContact;
  cues.current.onStart = onStart;
  cues.current.onLanded = onLanded;
  cues.current.onGone = onGone;

  const glow = useSprite();
  const glowScale = useMotionValue(1);
  const burst = useSprite();
  const burstScale = useMotionValue(0);
  // Unpainted outside its second, so the huge layer costs nothing at rest.
  const burstDisplay = useTransform(burst.opacity, (o) => (o > 0 ? 'block' : 'none'));
  const cursor = useSprite();

  // The mark's box is where the sphere lands. Its centre is read every frame
  // (the layout moves as whatever sits beside it grows); its size only on
  // resize.
  const readHome = useCallback((): number => {
    const rect = markRef.current?.getBoundingClientRect();
    if (!rect) return DEFAULT_RADIUS;
    clock.current.home = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    return rect.width / 2;
  }, [clock, markRef]);

  const measure = useCallback(() => {
    const r = readHome();
    clock.current.geo = stageGeometry(r, window.innerWidth, window.innerHeight);
    setRadius(r);
  }, [clock, readHome]);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  // The model is loaded: measure once more and start the clock. Reduced
  // motion starts it at rest, so the first frame is the resting mark (or none).
  const start = useCallback(() => {
    if (clock.current.start !== null) return;
    measure();
    clock.current.start = performance.now() - (reduced ? restTime(clock.current) * 1000 : 0);
    if (!cues.current.started) {
      cues.current.started = true;
      cues.current.onStart?.();
    }
  }, [clock, measure, reduced]);

  useAnimationFrame(() => {
    readHome();
    clock.current.center = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const frame = sceneAt(clock.current, performance.now());
    if (!frame) return;

    // The glow box is the sphere's full size and scales about its centre,
    // so its shadow shrinks with the sphere down to the desktop dot's halo.
    const r = clock.current.geo.radius;
    glow.x.set(frame.sphere.x - r);
    glow.y.set(frame.sphere.y - r);
    glow.opacity.set(frame.power);
    glowScale.set(frame.sphereRadius / r);

    burst.x.set(frame.sphere.x);
    burst.y.set(frame.sphere.y);
    burst.opacity.set(frame.burstOpacity);
    burstScale.set(0.02 + 0.98 * frame.burst);

    cursor.x.set(frame.cursor.x);
    cursor.y.set(frame.cursor.y);
    cursor.opacity.set(frame.cursorOpacity);

    rootRef.current?.style.setProperty('--disco-hue', frame.hue.toFixed(1));
    rootRef.current?.style.setProperty('--flare', frame.flare.toFixed(3));

    const cue = cues.current;
    // burst is 0 until contact and 1 once the shockwave has finished, so a
    // clock that starts already at rest (reduced motion) does not cue it.
    if (!cue.contact && frame.burst > 0 && frame.burst < 1) {
      cue.contact = true;
      cue.onContact?.();
    }
    if (frame.t >= LAND && !cue.landed) {
      cue.landed = true;
      cue.onLanded?.();
    }
    if (frame.gone >= 1 && !cue.gone) {
      cue.gone = true;
      cue.onGone?.();
    }
  });

  const cursorHeight = cursorPose(radius).height;
  const size = radius * 2;

  return (
    <div ref={rootRef} className="pointer-events-none fixed inset-0 z-0">
      <BuddyDot clock={clock} modelUrl={modelUrl} onReady={start} />
      <motion.div
        aria-hidden
        className="singularity pointer-events-none fixed top-[-130vmax] left-[-130vmax] z-0 size-[260vmax] rounded-full"
        style={{ x: burst.x, y: burst.y, scale: burstScale, opacity: burst.opacity, display: burstDisplay }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none fixed top-0 left-0 z-0 rounded-full"
        style={{
          x: glow.x,
          y: glow.y,
          scale: glowScale,
          opacity: glow.opacity,
          width: size,
          height: size,
          // The contact flare widens and brightens the shadow; the box itself
          // stays sphere-sized so its empty centre never shows.
          boxShadow:
            '0 0 calc(56px + 180px * var(--flare, 0)) calc(18px + 90px * var(--flare, 0)) hsl(var(--disco-hue) 88% 56% / calc(0.38 + 0.5 * var(--flare, 0)))',
        }}
      />
      <Cursor {...cursor} height={cursorHeight} />
    </div>
  );
}
