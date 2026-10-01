// Whether Buddy can place an order right now, so the prompts only offer to
// buy when Buy with Buddy is ready: agent mode, and a saved card.

import { getSettings } from '../settings';
import { hasPaymentCard } from './card';

export function canCheckout(): boolean {
  const settings = getSettings();
  return settings.agentModeEnabled && !settings.airplaneMode && hasPaymentCard();
}
