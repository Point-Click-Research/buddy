import type { TextareaHTMLAttributes, ReactElement, ReactNode } from 'react';
import { cn, controlClass } from './cn';
import { Field } from './Field';

export function Textarea({
  label,
  subtitle,
  mono,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: ReactNode;
  subtitle?: ReactNode;
  mono?: boolean;
}): ReactElement {
  const area = (
    <textarea
      className={cn(
        controlClass,
        'min-h-20 resize-y px-3 py-3 leading-4.5',
        mono && 'font-mono text-[12px] leading-[1.55]',
        className,
      )}
      {...props}
    />
  );
  if (!label && !subtitle) return area;
  return (
    <Field label={label} subtitle={subtitle}>
      {area}
    </Field>
  );
}
