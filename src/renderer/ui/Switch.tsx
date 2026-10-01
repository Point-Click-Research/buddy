import type { ReactElement } from 'react';
import { cn } from './cn';

export function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[25px] w-[49px] shrink-0 cursor-pointer overflow-hidden rounded-full p-[2px] disabled:cursor-default disabled:opacity-40',
        checked ? 'bg-success' : 'bg-track',
      )}
    >
      <span
        className={cn(
          'block h-[21px] w-[32px] rounded-full bg-knob shadow-knob transition-transform duration-150',
          checked && 'translate-x-[13px]',
        )}
      />
    </button>
  );
}
