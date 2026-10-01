import type { ReactElement } from 'react';
import { cn } from './cn';

/** Grey linear shimmer bone. Pass width and height on className. */
export function Skeleton({ className }: { className?: string }): ReactElement {
  return <span className={cn('skeleton', className)} aria-hidden />;
}
