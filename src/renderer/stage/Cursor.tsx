'use client';

import { motion, type MotionValue } from 'motion/react';
import type { ReactElement } from 'react';

/** Traced from the app icon's cursor: a white outline around a black arrow. */
const VIEW_W = 605;
const VIEW_H = 700;

export function Cursor({
  x,
  y,
  opacity,
  height,
}: {
  x: MotionValue<number>;
  y: MotionValue<number>;
  opacity: MotionValue<number>;
  height: number;
}): ReactElement {
  return (
    <motion.svg
      aria-hidden
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      height={height}
      width={(height * VIEW_W) / VIEW_H}
      className="pointer-events-none fixed top-0 left-0 z-20"
      style={{ x, y, opacity, filter: 'drop-shadow(0 6px 14px rgba(0, 0, 0, 0.28))' }}
    >
      <path d="M50 55 515 425 250 465 110 640Z" fill="#fff" />
      <path d="M100 140 410 398 228 430 137 540Z" fill="#000" />
    </motion.svg>
  );
}
