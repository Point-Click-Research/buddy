// A row of tabs for splitting one settings page into views: underlined, with
// no side padding, so the first label lines up with the content below it.

import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { cn } from './cn';

export function Tabs<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: ReadonlyArray<{ id: T; label: string }>;
  active: T;
  onSelect: (id: T) => void;
}): ReactElement {
  const row = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number; slide: boolean } | null>(null);
  const labels = tabs.map((tab) => tab.label).join('|');

  // One underline that moves to the active tab. Its first placement lands without sliding in from the left.
  useLayoutEffect(() => {
    const place = (): void => {
      const button = row.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!button) return;
      setBar((was) => ({ left: button.offsetLeft, width: button.offsetWidth, slide: was !== null }));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [active, labels]);

  return (
    <div ref={row} className="relative mb-5 flex gap-5 border-b border-line" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onSelect(tab.id)}
          className={cn(
            'cursor-pointer border-0 bg-transparent px-0 pb-2 pt-1 text-[13px] font-medium transition-colors duration-150',
            active === tab.id ? 'text-nav-active' : 'text-nav hover:text-nav-active',
          )}
        >
          {tab.label}
        </button>
      ))}
      {bar ? (
        <span
          aria-hidden
          // On the row's hairline, not above it.
          className={cn(
            'pointer-events-none absolute -bottom-px left-0 h-0.5 rounded-full bg-ink',
            bar.slide && 'transition-[translate,width] duration-200 ease-out motion-reduce:transition-none',
          )}
          style={{ width: bar.width, translate: `${bar.left}px 0` }}
        />
      ) : null}
    </div>
  );
}

export interface TabPanel {
  id: string;
  label: string;
  panel: ReactNode;
}

/** Tabs over their panels, for a page with no deep links into its tabs. A tab that goes away falls back to the first. */
export function TabbedView({ tabs }: { tabs: readonly TabPanel[] }): ReactElement {
  const [active, setActive] = useState(tabs[0]?.id ?? '');
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  return (
    <>
      <Tabs tabs={tabs} active={current?.id ?? ''} onSelect={setActive} />
      {/* Its own box, so the panel's first header sits under the tabs, not a section's height below. */}
      <div key={current?.id} className="fade-in">
        {current?.panel}
      </div>
    </>
  );
}
