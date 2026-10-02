// Extra usage past a paid plan's pool. The API refuses the first brain call
// of a new talk or task with on_demand_required; this asks the one question
// on the card (a texted turn asks the phone), turns extra usage on for a
// yes, and the call is sent again. A no holds for the run, so later turns
// get the message instead of the card again; the switch under Account is
// always there.

import type { ConfirmCard } from '../../shared/types';
import { requestConfirmation } from '../mcp/confirm';
import { readBudget } from '../ai/budget-message';
import { setOnDemand } from './api';

const ON_DEMAND_CARD: ConfirmCard = {
  title: "Keep going past this month's included usage?",
  detail:
    'Extra usage is billed at the end of the month at model cost, on your Buddy invoice. You can turn it off any time under Settings → Account.',
};

let declined = false;

/** The API asked before this call; a yes turns extra usage on. */
export function isOnDemandRequired(error: unknown): boolean {
  return readBudget(error)?.onDemand === true;
}

export async function offerOnDemand(signal: AbortSignal): Promise<boolean> {
  if (declined) return false;
  const approved = await requestConfirmation(ON_DEMAND_CARD, signal);
  if (!approved) {
    declined = true;
    return false;
  }
  await setOnDemand(true);
  return true;
}
