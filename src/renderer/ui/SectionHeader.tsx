import type { ReactElement, ReactNode } from 'react';

export function SectionHeader({
  title,
  description,
}: {
  title: ReactNode;
  description?: ReactNode;
}): ReactElement {
  return (
    <div className="mb-3.5 mt-6.5 first:mt-1">
      <h2 className="m-0 mb-0.5 text-[13px] font-medium">{title}</h2>
      {description ? <p className="m-0 text-[13px] leading-5 text-subtle">{description}</p> : null}
    </div>
  );
}

export function PageHeader({ page }: { page: string }): ReactElement {
  return (
    <header className="app-drag sticky top-0 z-10 flex shrink-0 items-center gap-1.25 border-b border-line bg-canvas/70 px-6 py-4 font-medium backdrop-blur-md">
      <span className="text-muted">Buddy Settings</span>
      <span className="text-muted">/</span>
      <span>{page}</span>
    </header>
  );
}

export function Note({
  children,
  tone,
}: {
  children?: ReactNode;
  tone?: 'ok' | 'fail' | 'warn';
}): ReactElement | null {
  if (!children) return null;
  const color =
    tone === 'ok' ? 'text-ok' : tone === 'fail' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-muted';
  return <p className={`text-[12px] mt-2 ${color}`}>{children}</p>;
}
