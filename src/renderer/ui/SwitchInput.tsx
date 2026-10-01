import type { ReactElement, ReactNode } from 'react';
import { Switch } from './Switch';

export function SwitchInput({
  label,
  subtitle,
  icon,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  subtitle?: ReactNode;
  /** A mark before the label (an app's icon), centered on the text beside it. */
  icon?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Not on this plan: the switch dims and the subtitle says why. */
  disabled?: boolean;
}): ReactElement {
  return (
    <label className={`flex justify-between gap-4 ${disabled ? 'cursor-default' : 'cursor-pointer'} ${icon ? 'items-center' : 'items-start'}`}>
      {icon ? <span className="-mr-1 flex shrink-0">{icon}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col pr-6 leading-normal">
        <span className="font-medium">{label}</span>
        {subtitle ? <span className="text-[13px] text-muted">{subtitle}</span> : null}
      </span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} />
    </label>
  );
}
