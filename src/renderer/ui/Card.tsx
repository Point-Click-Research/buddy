import type { ReactElement, ReactNode } from 'react';
import { cn } from './cn';

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col gap-[18px] rounded-base border border-line bg-raised p-4 shadow-card',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Vertical stack of cards with consistent spacing (settings sections). */
export function CardStack({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return <div className={cn('flex flex-col gap-3.5', className)}>{children}</div>;
}

export function Subform({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="mt-3.5 flex flex-col gap-3.5 rounded-base border border-dashed border-line p-4">
      {children}
    </div>
  );
}

export function Actions({
  children,
  align = 'end',
}: {
  children: ReactNode;
  align?: 'start' | 'end';
}): ReactElement {
  return (
    <div className={cn('mt-3 flex items-center gap-2', align === 'start' ? 'justify-start' : 'justify-end')}>
      {children}
    </div>
  );
}
