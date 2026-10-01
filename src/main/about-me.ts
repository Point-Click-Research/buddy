// Payment card numbers must never be stored in Memory; this is the detector.

/** Visa / Mastercard / Amex / Discover PANs are 13–19 digits. */
const MIN_PAN_DIGITS = 13;
const MAX_PAN_DIGITS = 19;

/** 16 digits in 4-4-4-4 groups, or Amex 4-6-5 — the usual typed card layout. */
const GROUPED_CARD =
  /\b(?:\d{4}[ -]+){3}\d{4}\b|\b\d{4}[ -]+\d{6}[ -]+\d{5}\b/;

export function looksLikeCardNumber(text: string): boolean {
  if (GROUPED_CARD.test(text)) return true;
  for (const match of text.match(/(?:\d[ -]?){13,19}/g) ?? []) {
    const digits = match.replace(/\D/g, '');
    if (digits.length >= MIN_PAN_DIGITS && digits.length <= MAX_PAN_DIGITS && luhnValid(digits)) {
      return true;
    }
  }
  return false;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}
