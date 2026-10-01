import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { cn } from './cn';

export function LinkButton({
  tone = 'muted',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'muted' | 'ink' | 'danger';
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      className={cn(
        'cursor-pointer border-0 bg-transparent p-0 text-[12px]',
        tone === 'muted' && 'text-muted hover:text-ink',
        tone === 'ink' && 'text-ink hover:text-ink',
        tone === 'danger' && 'text-muted hover:text-danger',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
