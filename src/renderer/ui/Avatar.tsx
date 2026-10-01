// The account's avatar: the first initial on ink, or a person mark when there
// is no name to take a letter from.

import { User } from 'lucide-react';
import type { ReactElement } from 'react';
import { cn } from './cn';

const SIZES = {
  sm: { box: 'size-7 text-[12px]', mark: 'size-3.5' },
  lg: { box: 'size-11 text-[17px]', mark: 'size-5' },
} as const;

export function Avatar({ name, size = 'sm' }: { name: string; size?: keyof typeof SIZES }): ReactElement {
  const initial = name.trim()[0]?.toUpperCase();
  const { box, mark } = SIZES[size];
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center rounded-full bg-ink font-semibold text-on-ink', box)}
      aria-hidden
    >
      {initial ?? <User className={mark} strokeWidth={2} />}
    </span>
  );
}
