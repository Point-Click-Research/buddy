export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Shared chrome for text inputs, selects, and textareas. */
export const controlClass =
  "box-border w-full rounded-xs border border-line-soft bg-well text-[13px] text-ink shadow-input outline-none placeholder:text-faint disabled:cursor-default disabled:text-ink disabled:opacity-100";
