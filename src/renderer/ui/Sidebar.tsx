import type { ReactElement, ReactNode } from 'react';
import { cn } from './cn';

type SidebarItem = {
  id: string;
  label: string;
  /** A small mark before the label. */
  icon?: ReactNode;
  /**
   * Shows a dot after the label: 'warn' when a setting on this page is
   * actively changing behavior, 'danger' when something here needs fixing.
   */
  indicator?: 'warn' | 'danger';
};
export type SidebarGroup = { label?: string; items: readonly SidebarItem[] };

export function Sidebar({
  groups,
  active,
  onSelect,
}: {
  groups: SidebarGroup[];
  active: string;
  onSelect: (id: string) => void;
}): ReactElement {
  return (
    <aside className="flex w-57 shrink-0 flex-col border-r border-line bg-canvas">
      {/* The traffic lights sit in this strip, outside the scroll area. */}
      <div className="app-drag h-14 shrink-0" />
      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1.25 pb-3 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {groups.map((group, index) => (
          <div
            key={group.label ?? group.items[0]?.id ?? index}
            className={cn('flex flex-col gap-0.5', index > 0 && 'mt-3 border-t border-line pt-3')}
          >
            {group.label ? (
              <p className="px-2.5 pb-1 text-[11px] font-medium text-muted">{group.label}</p>
            ) : null}
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className={cn(
                  'app-no-drag flex cursor-pointer items-center gap-2 rounded-md border-0 px-2.5 py-1.75 text-left text-[13px] font-normal',
                  active === item.id ? 'bg-wash text-nav-active' : 'text-nav hover:bg-wash',
                )}
                data-page={item.id}
              >
                {item.icon ? <span className="shrink-0">{item.icon}</span> : null}
                <span className="min-w-0 leading-tight">{item.label}</span>
                {item.indicator ? (
                  <span
                    className={cn(
                      'ml-auto h-1.5 w-1.5 rounded-full',
                      item.indicator === 'danger' ? 'bg-danger' : 'bg-warn',
                    )}
                  />
                ) : null}
              </button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
