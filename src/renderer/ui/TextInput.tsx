import type { InputHTMLAttributes, ReactElement, ReactNode } from 'react';
import { cn, controlClass } from './cn';
import { Field } from './Field';
import { Button } from './Button';

export function TextInput({
  label,
  subtitle,
  info,
  error,
  action,
  adornment,
  adornmentPad,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode;
  subtitle?: ReactNode;
  /** Shown in muted text directly under the input (not under the label). */
  info?: ReactNode;
  /** Shown in red directly under the input (not under the label). */
  error?: ReactNode;
  action?: { label: string; onClick: () => void; variant?: 'primary' | 'secondary'; disabled?: boolean };
  /** Sits inside the input at its right edge (a brand mark, a unit). */
  adornment?: ReactNode;
  /** Right-padding class when the adornment is wider than one mark. */
  adornmentPad?: string;
}): ReactElement {
  const bare = (
    <input
      className={cn(
        controlClass,
        'h-9 px-3',
        Boolean(adornment) && (adornmentPad ?? 'pr-9'),
        action && 'min-w-0 flex-1',
        className,
      )}
      {...props}
    />
  );
  const input = adornment ? (
    <div className={cn('relative', action && 'min-w-0 flex-1')}>
      {bare}
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">{adornment}</span>
    </div>
  ) : (
    bare
  );
  const control = action ? (
    <div className="flex items-center gap-2">
      {input}
      {/* The input's height, so the pair reads as one control. */}
      <Button variant={action.variant} className="h-9" disabled={action.disabled} onClick={action.onClick}>
        {action.label}
      </Button>
    </div>
  ) : (
    input
  );
  if (
    !label &&
    !subtitle &&
    (info == null || info === '') &&
    (error == null || error === '')
  ) {
    return control;
  }
  return (
    <Field label={label} subtitle={subtitle} info={info} error={error}>
      {control}
    </Field>
  );
}

export function InlineInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>): ReactElement {
  return (
    <input
      className={cn(
        'h-7 w-full border-0 bg-transparent p-0 text-[13px] font-medium text-ink outline-none placeholder:text-faint',
        className,
      )}
      {...props}
    />
  );
}
