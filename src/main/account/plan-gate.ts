// What the signed-in plan holds back. Pasted keys are never gated: they run
// on every plan and in a build with no account service.
import { accountConfigured } from "./config";

let plan: string | null = null;
let readPlan: (() => string | null) | null = null;

/** The signed-in plan, kept in step with /v1/me. Null when signed out or unknown. */
export function setKnownPlan(next: string | null): void {
  plan = next;
}

/** Read the plan from the account cache at the moment it is needed. */
export function bindPlanReader(read: () => string | null): void {
  readPlan = read;
}

/**
 * A waitlist account can talk to Buddy and nothing more: no tools, apps,
 * MCP servers, browser, agent tasks, jobs, or suggestions until it moves
 * up. Buddy still remembers what they tell it. A build with no account
 * service has no waitlist.
 */
export function talkOnly(): boolean {
  if (!accountConfigured()) return false;
  try {
    return (readPlan ? readPlan() : plan) === "waitlist";
  } catch {
    return plan === "waitlist";
  }
}
