// A centered dialog over a blurred backdrop. Esc or a backdrop click closes.
// A footer is a bar over the dialog's bottom edge, translucent over a blur:
// a long form scrolls under its actions, which never scroll away.
// It renders into <body>, so no ancestor's opacity, transform, or
// pointer-events can reach it, and it enters and leaves with motion
// (.modal-* in styles.css).

import { useEffect, useLayoutEffect, useRef, type ReactElement, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

/** How long the leaving copy stays; matches .modal-leaving in styles.css. */
const LEAVE_MS = 160;

export function Modal({
  title,
  subtitle,
  mark,
  onClose,
  children,
  footer,
}: {
  title: string;
  /** A quiet line directly under the title, closer than the body. */
  subtitle?: ReactNode;
  /** A mark beside the title, the same one a list row uses. */
  mark?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** The dialog's actions, right-aligned; give one mr-auto to send it left. */
  footer?: ReactNode;
}): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  useLeaveMotion(root);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6 backdrop-blur-[3px]"
      onMouseDown={onClose}
    >
      <div
        className="modal-dialog relative flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-base border border-line bg-raised shadow-card"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* With a footer, the content ends a bar's height (57px) plus the usual 20px above the edge. */}
        <div
          data-modal-scroll
          className={cn('flex min-h-0 flex-col gap-3.5 overflow-y-auto p-5', footer ? 'pb-19.25' : null)}
        >
          <div className="flex items-center gap-3">
            {mark}
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
              {subtitle ? <p className="m-0 text-[12px] leading-4 text-muted">{subtitle}</p> : null}
            </div>
          </div>
          {children}
        </div>
        {footer ? (
          <div className="absolute inset-x-0 bottom-0 z-10 flex h-14.25 items-center justify-end gap-2 border-t border-line bg-raised/70 px-5 backdrop-blur-xl">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Callers close a modal by unmounting it, so the exit plays on a copy of its
 * last frame, left in place until the fade ends. StrictMode's rehearsal
 * unmount remounts before the microtask runs, so it leaves no copy.
 */
function useLeaveMotion(root: RefObject<HTMLDivElement | null>): void {
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    const node = root.current;
    return () => {
      mounted.current = false;
      if (!node) return;
      const copy = snapshot(node);
      queueMicrotask(() => {
        if (mounted.current) return;
        document.body.append(copy.node);
        copy.restoreScroll();
        window.setTimeout(() => copy.node.remove(), LEAVE_MS);
      });
    };
  }, [root]);
}

/** A non-interactive clone showing what the user last saw: typed values and scroll included. */
function snapshot(node: HTMLElement): { node: HTMLElement; restoreScroll: () => void } {
  const copy = node.cloneNode(true) as HTMLElement;
  copy.classList.add('modal-leaving');
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  const fields = 'input, textarea, select';
  const live = node.querySelectorAll<HTMLInputElement>(fields);
  copy.querySelectorAll<HTMLInputElement>(fields).forEach((field, index) => {
    field.value = live[index]?.value ?? field.value;
  });
  const scroll = node.querySelector('[data-modal-scroll]')?.scrollTop ?? 0;
  return {
    node: copy,
    restoreScroll: () => {
      const pane = copy.querySelector('[data-modal-scroll]');
      if (pane) pane.scrollTop = scroll;
    },
  };
}
