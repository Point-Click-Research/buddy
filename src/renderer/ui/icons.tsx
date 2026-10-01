// The pass/fail marks settings pages share: key tests, checklists.

import type { ReactElement } from 'react';

export function CheckIcon(): ReactElement {
  return (
    <svg className="size-3.5 text-ok" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.5 9.5 17 19 7.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function XIcon(): ReactElement {
  return (
    <svg className="size-3.5 text-danger" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
