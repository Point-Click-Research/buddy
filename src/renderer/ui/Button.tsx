import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { cn } from './cn';

type ButtonType = 'primary' | 'secondary';

export function Button({
  variant = 'primary',
  className,
  children,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonType;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type={type}
      className={cn(
        // Primary: a gradient sheen and tokened edge shadows, the plastic
        // depth. Secondary: flat, with a ring and a soft drop. Both sink 1px
        // when pressed; the tokens tune them per scheme.
        'h-8 shrink-0 cursor-pointer rounded-xs px-3 text-[13px] font-medium transition-all duration-100 active:translate-y-px active:shadow-button-pressed disabled:cursor-default disabled:opacity-40',
        variant === 'primary' &&
          'bg-ink bg-linear-to-b from-white/20 to-transparent text-on-ink shadow-button hover:bg-ink-hover',
        variant === 'secondary' &&
          'bg-button-secondary text-ink shadow-button-secondary hover:bg-button-secondary-hover',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
