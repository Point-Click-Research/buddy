// A card network's mark, from local files so it shows offline and under the
// windows' CSP. Artwork: aaronfagan/svg-credit-card-payment-icons (Apache-2.0).

import type { ReactElement } from 'react';
import type { CardBrand } from '../../shared/card-brand';
import amex from './assets/cards/amex.svg';
import discover from './assets/cards/discover.svg';
import mastercard from './assets/cards/mastercard.svg';
import visa from './assets/cards/visa.svg';
import { cn } from './cn';

const MARKS: Record<Exclude<CardBrand['mark'], ''>, string> = { visa, mastercard, amex, discover };

const MARK_CLASS = 'h-4 w-[25px] shrink-0 rounded-[3px]';

/** Visa, Mastercard, Amex, Discover, in the order Stripe shows them before a number names one. */
const STACK = ['visa', 'mastercard', 'amex', 'discover'] as const;

/** Nothing for a card whose network the digits don't name yet. */
export function CardMark({ brand, className }: { brand: CardBrand; className?: string }): ReactElement | null {
  if (!brand.mark) return null;
  return (
    <img src={MARKS[brand.mark]} alt={brand.name} draggable={false} className={cn(MARK_CLASS, className)} />
  );
}

/** The four networks, shown until the digits name one. */
export function CardBrandStack(): ReactElement {
  return (
    <span className="flex items-center gap-1">
      {STACK.map((mark) => (
        <img key={mark} src={MARKS[mark]} alt="" draggable={false} className={MARK_CLASS} />
      ))}
    </span>
  );
}

/** The back-of-card hint Stripe draws in the security-code field. */
export function CvcIcon(): ReactElement {
  return (
    <svg className="h-3.5 w-6 shrink-0 text-faint" viewBox="0 0 32 22" fill="none" aria-hidden>
      <rect x="0.75" y="0.75" width="30.5" height="20.5" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="1.6" y="4.6" width="28.8" height="3.6" fill="currentColor" />
      <rect x="18" y="11.5" width="11" height="7" rx="1.25" stroke="currentColor" strokeWidth="1.25" />
      <text
        x="23.5"
        y="16.7"
        textAnchor="middle"
        fill="currentColor"
        fontSize="6"
        fontWeight="600"
        fontFamily="-apple-system, system-ui, sans-serif"
      >
        123
      </text>
    </svg>
  );
}
