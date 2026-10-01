// The saved payment card: number, expiry, CVC, and name, kept as one
// safeStorage blob (Keychain-backed on macOS) under the 'card' app secret.
// This is the only module that decrypts it. The digits go from here to a
// checkout form via fill_payment and nowhere else — never to a model, the
// action log, or Memory.

import { looksLikeCardNumber } from '../about-me';
import { getAppSecret, setAppSecret } from '../settings';
import { cardBrand } from '../../shared/card-brand';
import type { PaymentCardDraft } from '../../shared/types';

export interface PaymentCard {
  /** Digits only. */
  number: string;
  /** 1–12. */
  expMonth: number;
  /** Four digits. */
  expYear: number;
  /** 3–4 digits. */
  cvc: string;
  /** Name on card. */
  name: string;
}

/**
 * Parse and validate the Settings form. Throws with a message the form can
 * show; the thrown message never contains the digits themselves.
 */
export function parseCardDraft(draft: PaymentCardDraft): PaymentCard {
  const number = String(draft.number ?? '').replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(number) || !looksLikeCardNumber(number)) {
    throw new Error("That doesn't look like a valid card number.");
  }
  const expiry = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(String(draft.expiry ?? '').trim());
  const expMonth = expiry ? Number(expiry[1]) : 0;
  if (!expiry || expMonth < 1 || expMonth > 12) {
    throw new Error('Expiry must be MM/YY.');
  }
  const expYear = expiry[2]!.length === 2 ? 2000 + Number(expiry[2]) : Number(expiry[2]);
  const cvc = String(draft.cvc ?? '').trim();
  if (!/^\d{3,4}$/.test(cvc)) {
    throw new Error('The security code is the 3 or 4 digits on the card.');
  }
  const name = String(draft.name ?? '').trim().slice(0, 80);
  if (!name) throw new Error('The name on the card is required.');
  return { number, expMonth, expYear, cvc, name };
}

/** Validate and store the card, or clear it with null. Throws on a bad draft. */
export function savePaymentCard(draft: PaymentCardDraft | null): void {
  setAppSecret('card', draft ? JSON.stringify(parseCardDraft(draft)) : '');
}

export function loadPaymentCard(): PaymentCard | null {
  const raw = getAppSecret('card');
  if (!raw) return null;
  try {
    const card = JSON.parse(raw) as PaymentCard;
    return card && typeof card.number === 'string' && card.number ? card : null;
  } catch {
    return null;
  }
}

export function hasPaymentCard(): boolean {
  return loadPaymentCard() !== null;
}

/** "Visa •••• 4242" for the settings page and the approval card; '' when none. */
export function cardSummary(): string {
  const card = loadPaymentCard();
  return card ? `${cardBrand(card.number).name} •••• ${card.number.slice(-4)}` : '';
}
