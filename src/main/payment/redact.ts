// Once fill_payment has typed the card into a checkout form, the next window
// read hands those field values straight back — into the model's context, the
// action log, distillation, and the chat handover. This module is the one
// seam they all share: agent.ts passes every action result through here, and
// while a fill has the values on screen, the digits are masked and images are
// withheld. Armed by fill_payment, disarmed when the task ends.

import type { ImageBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { looksLikeCardNumber } from '../about-me';
import type { ToolOutcome } from '../ai/tools';
import type { PaymentCard } from './card';

const MASK = '••••';

/** The exact strings to mask, in every spacing a form might echo them. */
let patterns: RegExp[] = [];
let armed = false;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The number as typed, and as forms usually re-space it (4-4-4-4, Amex 4-6-5). */
function numberPatterns(number: string): RegExp[] {
  // Any spacing or dashes between the exact digits catches every echo.
  const spaced = number.split('').map(escape).join('[ -]?');
  return [new RegExp(spaced, 'g')];
}

function expiryPatterns(expMonth: number, expYear: number): RegExp[] {
  const mm = String(expMonth).padStart(2, '0');
  const yy = String(expYear % 100).padStart(2, '0');
  // 08/27, 8/27, 08/2027, 08 / 27 — the value the fill typed, echoed back.
  return [new RegExp(`\\b0?${Number(mm)}\\s*/\\s*(?:20)?${yy}\\b`, 'g')];
}

/** The CVC only where it reads as a field value; bare 3-digit numbers are prices. */
function cvcPatterns(cvc: string): RegExp[] {
  return [new RegExp(`(=\\s*)${escape(cvc)}\\b`, 'g')];
}

export function armRedaction(card: PaymentCard): void {
  patterns = [
    ...numberPatterns(card.number),
    ...expiryPatterns(card.expMonth, card.expYear),
    ...cvcPatterns(card.cvc),
  ];
  armed = true;
}

export function disarmRedaction(): void {
  armed = false;
  patterns = [];
}

export function isRedactionArmed(): boolean {
  return armed;
}

/** Mask the armed card values, plus anything else that scans as a card number. */
export function redactCardText(text: string): string {
  if (!armed) return text;
  let out = text;
  for (const pattern of patterns) {
    out = out.replace(pattern, (_match, prefix?: string) =>
      typeof prefix === 'string' ? `${prefix}${MASK}` : MASK,
    );
  }
  // The safety net: any other card-shaped number on a payment screen.
  if (looksLikeCardNumber(out)) {
    out = out.replace(/(?:\d[ -]?){13,19}/g, (match) => (looksLikeCardNumber(match) ? MASK : match));
  }
  return out;
}

const IMAGE_NOTE =
  'Screen images are withheld while payment details are on screen. Work from the element list.';

/**
 * The seam agent.ts applies to every action result while armed: text is
 * masked and images are dropped, so no pixel of the filled form reaches the
 * model or the log.
 */
export function redactToolOutcome(outcome: ToolOutcome): ToolOutcome {
  if (!armed) return outcome;
  if (typeof outcome.content === 'string') {
    return { ...outcome, content: redactCardText(outcome.content) };
  }
  const content = outcome.content
    .map((block): TextBlockParam | ImageBlockParam | null =>
      block.type === 'text' ? { ...block, text: redactCardText(block.text) } : null,
    )
    .filter((block): block is TextBlockParam => block !== null);
  if (content.length < outcome.content.length) {
    content.push({ type: 'text', text: IMAGE_NOTE });
  }
  return { ...outcome, content };
}
