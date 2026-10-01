// An installed Mac app's icon (Messages, Mail), read from its bundle by main.
// Keeps its space while loading so the row doesn't shift when it lands.

import { useEffect, useState, type ReactElement } from 'react';
import { buddy } from '../buddy';
import { cn } from './cn';

export function AppIcon({ name, className }: { name: string; className?: string }): ReactElement {
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void buddy.getAppIcon(name).then((data) => {
      if (alive) setIcon(data);
    });
    return () => {
      alive = false;
    };
  }, [name]);
  return icon ? (
    <img src={icon} alt="" draggable={false} className={cn('fade-in size-5 shrink-0', className)} />
  ) : (
    <span className={cn('size-5 shrink-0', className)} aria-hidden />
  );
}
