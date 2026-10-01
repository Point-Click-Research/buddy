import { Children, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { solidHexColor, DISCO_COLOR, isDiscoColor } from '../../shared/color';
import { cn } from './cn';

export function Table({
  columns,
  children,
  empty = 'None yet',
}: {
  columns: Array<{ key: string; label: string; width?: string }>;
  children?: ReactNode;
  empty?: ReactNode;
}): ReactElement {
  const rows = Children.toArray(children);
  return (
    <TableFrame
      header={columns.map((column) => (
        <span
          key={column.key}
          className={cn(
            column.key === '#' && 'w-8.25 shrink-0 text-center',
            column.key !== '#' &&
              column.key !== 'action' &&
              (column.width ? 'shrink-0 px-3' : 'min-w-0 flex-1 px-3'),
            column.key === 'action' && 'shrink-0 px-3.5 text-right',
          )}
          style={column.width ? { width: column.width } : undefined}
        >
          {column.label}
        </span>
      ))}
    >
      {rows.length > 0 ? (
        rows
      ) : (
        <div className="flex min-h-10 items-center">
          <span className="w-8.25 shrink-0" />
          <span className="min-w-0 flex-1 px-3 font-medium text-faint">{empty}</span>
        </div>
      )}
    </TableFrame>
  );
}

/**
 * The table's shell: a header lip on the wash, and the rows on a raised panel
 * flush with its sides and bottom, the way New Chat's composer sits in its tray.
 */
export function TableFrame({
  header,
  children,
  className,
}: {
  header: ReactNode;
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div className={cn('rounded-base border border-line bg-wash shadow-card', className)}>
      <div className="flex h-9.5 items-center font-medium text-muted">{header}</div>
      {/* Over the frame's border, so the two share one edge instead of doubling it. */}
      <div className="-mx-px -mb-px rounded-base border border-line bg-raised shadow-knob">{children}</div>
    </div>
  );
}

export function TableRow({
  index,
  main,
  mainWidth,
  second,
  detail,
  action,
  title,
}: {
  index: string | number;
  main: ReactNode;
  /** Fixes the main cell's width; pair with the matching column's width. */
  mainWidth?: string;
  /** A second data cell, filling the space after a fixed-width main cell. */
  second?: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  title?: string;
}): ReactElement {
  return (
    <div className="flex min-h-10 items-center border-line py-2.5 not-first:border-t">
      <span className="w-8.25 shrink-0 text-center font-medium">{index}</span>
      <span
        className={cn('overflow-hidden px-3', mainWidth ? 'shrink-0' : 'min-w-0 flex-1')}
        style={mainWidth ? { width: mainWidth } : undefined}
        title={title}
      >
        <span className={cn('block font-medium', !detail && 'truncate')}>{main}</span>
        {detail ? <span className="mt-0.5 block text-[12px] leading-4 text-muted">{detail}</span> : null}
      </span>
      {second !== undefined && (
        <span className="min-w-0 flex-1 overflow-hidden px-3 font-medium">{second}</span>
      )}
      {/* A button in a one-line row sits as far from the edge as from the row's top and bottom. */}
      <span
        className={cn(
          'flex shrink-0 items-center justify-end gap-2.5 text-[12px] font-medium text-muted',
          detail ? 'px-3.5' : 'px-2.5',
        )}
      >
        {action}
      </span>
    </div>
  );
}

export function ColorSwatch({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastHex = useRef(solidHexColor(value));
  const disco = isDiscoColor(value);
  if (!disco) lastHex.current = value;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={disco ? 'Disco' : value}
        onClick={() => setOpen((prev) => !prev)}
        className="h-5.5 w-5.5 cursor-pointer overflow-hidden rounded-[7px] border border-line p-0 focus-visible:border-focus"
      >
        <span
          className={cn('block h-full w-full', disco && 'disco-swatch')}
          style={disco ? undefined : { background: value }}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute bottom-full right-0 z-50 mb-1 min-w-37 overflow-hidden rounded-lg border border-line bg-raised py-1 shadow-card"
        >
          <label
            className={cn(
              'flex w-full cursor-pointer items-center justify-between gap-6 px-3 py-1.5 text-left text-[13px] text-ink hover:bg-wash',
              !disco && 'font-medium',
            )}
          >
            <span>Color</span>
            <input
              type="color"
              value={lastHex.current}
              aria-label={`${label} color`}
              onChange={(event) => onChange(event.target.value)}
              className="h-4.5 w-4.5 cursor-pointer rounded-[5px] border border-line bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[4px] [&::-webkit-color-swatch]:border-none"
            />
          </label>
          <button
            type="button"
            role="option"
            aria-selected={disco}
            onClick={() => {
              onChange(DISCO_COLOR);
              setOpen(false);
            }}
            className={cn(
              'flex w-full cursor-pointer items-center justify-between gap-6 border-0 bg-transparent px-3 py-1.5 text-left text-[13px] text-ink hover:bg-wash',
              disco && 'font-medium',
            )}
          >
            <span>Disco</span>
            <span className="h-4.5 w-4.5 shrink-0 overflow-hidden rounded-[5px] border border-line">
              <span className="disco-swatch block h-full w-full" />
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
