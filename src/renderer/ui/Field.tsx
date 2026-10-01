import type { ReactElement, ReactNode } from 'react';

export function Field({
  label,
  subtitle,
  info,
  error,
  children,
}: {
  label?: ReactNode;
  subtitle?: ReactNode;
  /** Muted helper text directly under the control (not under the label). */
  info?: ReactNode;
  /** Red helper text directly under the control (not under the label). */
  error?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const infoLine =
    info != null && info !== '' ? (
      <p className="m-0 text-[12px] leading-5 text-muted">{info}</p>
    ) : null;
  const errorLine =
    error != null && error !== '' ? (
      <p className="m-0 text-[12px] leading-5 text-danger" role="alert">
        {error}
      </p>
    ) : null;
  return (
    <div className="flex flex-col gap-[5px]">
      {label ? <span className="font-medium">{label}</span> : null}
      {subtitle ? <p className="-mt-[3px] text-[13px] leading-5 text-muted mb-2">{subtitle}</p> : null}
      {children}
      {infoLine}
      {errorLine}
    </div>
  );
}
