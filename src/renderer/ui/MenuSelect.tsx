// A custom select: the picked label on the trigger, and a dropdown whose
// rows carry a right-justified detail ("Connected", "+ Add", "Free"). Rows
// can be disabled for selection while still clickable, so a missing
// provider can jump the user to the page that adds it.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { cn, controlClass } from './cn';
import { Field } from './Field';

export interface MenuSelectOption<T extends string = string> {
  value: T;
  label: string;
  /** Right-justified status in the dropdown row. */
  detail?: ReactNode;
  /** A line under the label that wraps; the menu then matches the trigger's width. */
  description?: string;
  /** A mark before the label. */
  icon?: ReactNode;
  /** Not selectable; clicking runs onDisabledPick unless inertWhenDisabled. */
  disabled?: boolean;
  /** Disabled row closes the menu without onDisabledPick (e.g. unavailable, not missing key). */
  inertWhenDisabled?: boolean;
}

/**
 * Fixed to the trigger, so a table cell or scroll pane cannot clip the list.
 * A menu of described rows is exactly the trigger's width, so its lines wrap.
 */
function menuPosition(anchor: DOMRect, compact: boolean, fitted: boolean): CSSProperties {
  const gap = 4;
  const roomBelow = window.innerHeight - anchor.bottom;
  const openUp = roomBelow < 160 && anchor.top > roomBelow;
  return {
    position: 'fixed',
    zIndex: 80,
    minWidth: anchor.width,
    ...(fitted ? { width: anchor.width } : {}),
    ...(openUp
      ? { bottom: window.innerHeight - anchor.top + gap }
      : { top: anchor.bottom + gap }),
    ...(compact ? { right: window.innerWidth - anchor.right } : { left: anchor.left }),
  };
}

export function MenuSelect<T extends string>({
  label,
  subtitle,
  info,
  error,
  value,
  options,
  onSelect,
  onDisabledPick,
  compact,
  wide,
  searchable,
  footer,
  placeholder,
  end,
}: {
  label?: ReactNode;
  subtitle?: ReactNode;
  /** Shown faint on the trigger while the value matches no option (e.g. ''). */
  placeholder?: string;
  /** Shown in muted text directly under the select control (not under the label). */
  info?: ReactNode;
  /** Shown in red directly under the select control (not under the label). */
  error?: ReactNode;
  value: T;
  options: ReadonlyArray<MenuSelectOption<T>>;
  onSelect: (value: T) => void;
  /** A disabled row was clicked (e.g. jump to Providers to add the key). */
  onDisabledPick?: (value: T) => void;
  compact?: boolean;
  /** Wider menu for long model names. */
  wide?: boolean;
  /** Filter box at the top of the menu. */
  searchable?: boolean;
  /** Pinned under the list (e.g. Enter manually). */
  footer?: MenuSelectOption<T>;
  /** Sits on the closed control, left of the chevron. Not a nested button. */
  end?: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const described = options.some((option) => option.description);
  /** Some rows have a mark: every row keeps the slot, so the labels line up. */
  const marked = described && options.some((option) => option.icon);

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }
    const place = (): void => {
      const anchor = rootRef.current?.getBoundingClientRect();
      if (anchor) setMenuStyle(menuPosition(anchor, Boolean(compact), described));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, compact, described]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const needle = query.trim().toLowerCase();
  const shown =
    searchable && needle
      ? options.filter(
        (option) =>
          option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle),
      )
      : options;
  const current = options.find((option) => option.value === value) ?? (footer?.value === value ? footer : undefined);

  const menu =
    open && menuStyle
      ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={menuStyle}
            className={cn(
              'app-no-drag flex flex-col overflow-hidden rounded-[8px] border border-line bg-raised shadow-card',
              !described && (wide ? 'w-max max-w-[440px]' : 'w-max max-w-[340px]'),
            )}
          >
            {searchable && (
              <div className="px-2 pb-1 mt-2">
                <input
                  autoFocus
                  value={query}
                  placeholder="Filter"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.preventDefault();
                  }}
                  className={cn(controlClass, 'h-7 px-2')}
                />
              </div>
            )}
            <div className={cn('overflow-x-hidden overflow-y-auto', described ? 'max-h-96 p-1' : 'max-h-64')}>
              {shown.length ? (
                shown.map((option) => {
                  const select = (): void => {
                    setOpen(false);
                    if (option.disabled) {
                      if (!option.inertWhenDisabled) onDisabledPick?.(option.value);
                      return;
                    }
                    onSelect(option.value);
                  };
                  const rowClass = cn(
                    'flex w-full cursor-pointer border-0 text-left text-[13px] hover:bg-wash',
                    described
                      ? cn('items-center gap-3 rounded-md px-2 py-1.5', option.value === value ? 'bg-wash' : 'bg-transparent')
                      : 'items-center justify-between gap-6 bg-transparent px-3 py-1.5',
                    option.disabled ? 'text-faint' : 'text-ink',
                    option.value === value && !described && 'font-medium',
                  );
                  // A detail can be its own control (a preview). It sits beside
                  // the row, so clicking it does not pick the option.
                  if (!described && option.detail) {
                    return (
                      <div key={option.value} className="flex w-full items-center hover:bg-wash">
                        <button
                          type="button"
                          role="option"
                          aria-selected={option.value === value}
                          aria-disabled={option.disabled}
                          onClick={select}
                          className={cn(
                            'flex min-w-0 flex-1 cursor-pointer items-center border-0 bg-transparent px-3 py-1.5 text-left text-[13px]',
                            option.disabled ? 'text-faint' : 'text-ink',
                            option.value === value && 'font-medium',
                          )}
                        >
                          <span className="min-w-0 truncate">{option.label}</span>
                        </button>
                        <span className="flex shrink-0 items-center pr-2 text-[12px] text-muted">{option.detail}</span>
                      </div>
                    );
                  }
                  return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    aria-disabled={option.disabled}
                    onClick={select}
                    title={described ? option.description : undefined}
                    className={rowClass}
                  >
                    {described ? (
                      <>
                        {marked ? (
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-plain-white text-muted shadow-knob">
                            {option.icon}
                          </span>
                        ) : null}
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium leading-5">{option.label}</span>
                          {option.description ? (
                            <span className="truncate text-[12px] leading-4 text-muted">{option.description}</span>
                          ) : null}
                        </span>
                        {option.value === value ? <Check className="size-3.5 shrink-0 text-ink" aria-hidden /> : null}
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 truncate">{option.label}</span>
                        {option.detail && (
                          <span className="max-w-1/2 shrink-0 truncate text-[12px] text-muted">{option.detail}</span>
                        )}
                      </>
                    )}
                  </button>
                  );
                })
              ) : (
                <div className="px-3 py-1.5 text-[13px] text-muted">No matches</div>
              )}
            </div>
            {footer && (
              <button
                type="button"
                role="option"
                aria-selected={footer.value === value}
                onClick={() => {
                  setOpen(false);
                  onSelect(footer.value);
                }}
                className={cn(
                  'mt-1 w-full cursor-pointer border-0 border-t border-line bg-transparent px-3 py-2 text-left text-[13px] text-ink hover:bg-wash',
                  footer.value === value && 'font-medium',
                )}
              >
                {footer.label}
              </button>
            )}
          </div>,
          document.body,
        )
      : null;

  const chevron = (
    <svg className="size-3 shrink-0 text-muted" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  const withEnd = Boolean(end) && !compact;
  const toggle = (): void => setOpen((prev) => !prev);
  const control = (
    <div
      ref={rootRef}
      className={cn(compact && 'inline-block', withEnd && cn(controlClass, 'flex h-9 items-center'))}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        className={
          withEnd
            ? 'flex h-full min-w-0 flex-1 cursor-pointer items-center border-0 bg-transparent px-3 text-left text-[13px] text-ink'
            : compact
              ? 'flex h-6.5 cursor-pointer items-center gap-1 border-0 bg-transparent px-2 text-[12px] font-medium text-muted'
              : cn(controlClass, 'flex h-9 cursor-pointer items-center justify-between gap-2 px-3 text-left')
        }
      >
        <span className={cn('flex min-w-0 items-center gap-2', !current && placeholder && 'text-faint')}>
          {marked && current?.icon ? <span className="flex shrink-0 text-muted">{current.icon}</span> : null}
          <span className="truncate">{current?.label ?? (placeholder || value)}</span>
        </span>
        {withEnd ? null : chevron}
      </button>
      {withEnd ? (
        <>
          {end}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={toggle}
            className="flex h-full cursor-pointer items-center border-0 bg-transparent pr-3 pl-1"
          >
            {chevron}
          </button>
        </>
      ) : null}
      {menu}
    </div>
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
