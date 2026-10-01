import { createContext, useContext, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import type { Settings, SettingsView } from '../../shared/types';
import { buddy } from '../buddy';
import { createBuddyStore } from '../shared/buddy-store';

const SettingsContext = createContext<{
  view: SettingsView;
  patch: (next: Partial<Settings>) => Promise<void>;
} | null>(null);

/** Settings, fetched as the window loads so the first paint can use them. */
export const useSettingsView = createBuddyStore(
  () => buddy.getSettings(),
  (publish) => buddy.onSettingsChanged(publish),
);

export function SettingsProvider({ children }: { children: ReactNode }): ReactElement | null {
  const remote = useSettingsView();
  const [view, setView] = useState<SettingsView | null>(remote);

  useEffect(() => {
    if (remote) setView(remote);
  }, [remote]);

  if (!view) return null;

  const patch = async (next: Partial<Settings>): Promise<void> => {
    // Apply locally first so a textarea caret is not reset when the IPC
    // round-trip later replaces the value (React treats that as a new write
    // and jumps to the end).
    setView((current) =>
      current ? { ...current, settings: { ...current.settings, ...next } } : current,
    );
    setView(await buddy.updateSettings(next));
  };

  return <SettingsContext.Provider value={{ view, patch }}>{children}</SettingsContext.Provider>;
}

export function useSettings(): {
  view: SettingsView;
  patch: (next: Partial<Settings>) => Promise<void>;
} {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}

export function clampNumber(value: string, min: number): number {
  return Math.max(min, Number(value) || 0);
}
