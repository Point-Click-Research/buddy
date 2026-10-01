// Card brand by leading digits, and the light formatting a card form does as
// the user types. Display and typing help only: validation (Luhn, expiry
// range) lives in main, and nothing here is ever used to decide a payment.

export interface CardBrand {
  name: string;
  /** Which network mark the UI draws; '' for an unknown card. */
  mark: 'visa' | 'mastercard' | 'amex' | 'discover' | '';
  /** Digit grouping when formatted: 4-4-4-4 for most, 4-6-5 for Amex. */
  groups: number[];
  /** Security code length. */
  cvcLength: number;
}

const BRANDS: Array<CardBrand & { test: RegExp }> = [
  { test: /^4/, name: 'Visa', mark: 'visa', groups: [4, 4, 4, 4], cvcLength: 3 },
  { test: /^(5[1-5]|2[2-7])/, name: 'Mastercard', mark: 'mastercard', groups: [4, 4, 4, 4], cvcLength: 3 },
  { test: /^3[47]/, name: 'Amex', mark: 'amex', groups: [4, 6, 5], cvcLength: 4 },
  { test: /^6/, name: 'Discover', mark: 'discover', groups: [4, 4, 4, 4], cvcLength: 3 },
];

const GENERIC: CardBrand = { name: 'Card', mark: '', groups: [4, 4, 4, 4], cvcLength: 3 };

/** The brand the digits so far point at; generic until the first digit tells. */
export function cardBrand(number: string): CardBrand {
  const digits = number.replace(/\D/g, '');
  return BRANDS.find((brand) => brand.test.test(digits)) ?? GENERIC;
}

/** The brand a saved summary ("Visa •••• 4242") names; generic when it names none. */
export function cardBrandNamed(summary: string): CardBrand {
  return BRANDS.find((brand) => summary.startsWith(brand.name)) ?? GENERIC;
}

/** "4242424242424242" -> "4242 4242 4242 4242", capped at the brand's length. */
export function formatCardNumber(raw: string): string {
  const brand = cardBrand(raw);
  const max = brand.groups.reduce((sum, size) => sum + size, 0);
  const digits = raw.replace(/\D/g, '').slice(0, Math.max(max, 19));
  const parts: string[] = [];
  let at = 0;
  for (const size of brand.groups) {
    if (at >= digits.length) break;
    parts.push(digits.slice(at, at + size));
    at += size;
  }
  if (at < digits.length) parts.push(digits.slice(at));
  return parts.join(' ');
}

/** "1227" -> "12/27"; typing a lone "1" or "12" leaves the slash for the next digit. */
export function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export function formatCvc(raw: string, brand: CardBrand): string {
  return raw.replace(/\D/g, '').slice(0, brand.cvcLength);
}
