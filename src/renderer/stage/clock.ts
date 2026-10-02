import { useRef, type RefObject } from 'react';
import { LAND, stageGeometry, type StageClock } from './timeline';

/** The mark's radius before it has been measured. */
export const DEFAULT_RADIUS = 64;

/** `leaveAfter`: seconds after landing the sphere scales away; omit to stay. */
export function useStageClock(leaveAfter?: number): RefObject<StageClock> {
  return useRef<StageClock>({
    start: null,
    home: { x: 0, y: 0 },
    center: { x: 0, y: 0 },
    geo: stageGeometry(DEFAULT_RADIUS, 1280, 800),
    exit: leaveAfter === undefined ? null : LAND + leaveAfter,
  });
}
