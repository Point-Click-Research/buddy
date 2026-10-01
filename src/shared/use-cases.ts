// What each kind of ask needs before Buddy can do it. Pure: the brain's
// prompt, the job form, and tests all call this, and nothing here reaches
// for Electron. There is no page per use case: when an ask is missing a
// piece, Buddy opens the Settings page that holds it.

import { isExaServer } from "./search-servers";
import { isBlandServer, type BuyerProfile } from "./types";

/** The kinds of ask, each with one example the prompt quotes. */
export const USE_CASES = [
  { id: "discover", label: "Discover", example: "Find me a white linen shirt under $80." },
  { id: "purchase", label: "Purchase", example: "Buy this." },
  { id: "book", label: "Book", example: "Book a table for two Friday night." },
  { id: "call", label: "Call", example: "Call the restaurant and book a table for two at 7." },
  { id: "text", label: "Text", example: "Text Sam I'm running ten minutes late." },
  { id: "email", label: "Email", example: "What's in my inbox this morning?" },
] as const;

export type UseCaseId = (typeof USE_CASES)[number]["id"];

export interface ServerSnap {
  name: string;
  url: string;
  enabled: boolean;
  status: string;
}

export interface UseCaseSnap {
  disabledBuiltinTools: string[];
  screenAwareness: boolean;
  /** Draw to point while talking — the circle-a-product gesture. */
  marksEnabled: boolean;
  /** Computer use may drive the user's own browser (bookings). */
  agentModeEnabled: boolean;
  servers: ServerSnap[];
  /** A payment card is saved under Settings → Checkout Forms. */
  hasCard: boolean;
  shopifyKey: boolean;
  /** Buy with Buddy shipping address. */
  shipping: BuyerProfile;
  connectedApps: string[];
  /** Hosts from SIGN_IN_SITES that Buddy's browser is already signed in to. */
  signedInHosts?: string[];
}

export interface CheckItem {
  label: string;
  ok: boolean;
  /** Required rows must be ready. Recommended rows are extra. */
  required: boolean;
  detail: string;
  /** The Settings page that turns this on. Null when the row is ready or nothing needs setting. */
  fix: { label: string; page: string } | null;
  /** This row's ok depends on a fetch that may still be in flight. */
  await?: "servers" | "apps" | "signins";
}

const NATIVE = { label: "Open Built-in", page: "native" };
const APPS = { label: "+ Connect", page: "apps" };
const BUY = { label: "+ Add", page: "buy" };
const KEYS = { label: "+ Add", page: "providers" };

export function row(
  ok: boolean,
  label: string,
  ready: string,
  missing: string,
  required: boolean,
  fix: { label: string; page: string } | null,
  awaiting?: "servers" | "apps",
): CheckItem {
  return {
    ok,
    label,
    required,
    detail: ok ? ready : missing,
    fix: ok ? null : fix,
    ...(awaiting ? { await: awaiting } : {}),
  };
}

function tool(
  snap: UseCaseSnap,
  id: string,
  label: string,
  ready: string,
  missing: string,
  required = true,
): CheckItem {
  return row(
    !snap.disabledBuiltinTools.includes(id),
    label,
    ready,
    missing,
    required,
    NATIVE,
  );
}

/** Exa is connected — the piece most jobs and pillars share. */
export function searchReady(servers: ServerSnap[]): boolean {
  return servers.some(
    (server) =>
      server.enabled && server.status === "connected" && isExaServer(server),
  );
}

function blandReady(servers: ServerSnap[]): boolean {
  return servers.some(
    (server) => server.status === "connected" && isBlandServer(server),
  );
}

/** Contacts, recommended: a name becomes a number before the call or the text. */
function contactsRow(snap: UseCaseSnap, act: "calling" | "texting"): CheckItem {
  return tool(
    snap,
    "contacts",
    "Contacts",
    `Looks people up by name before ${act}.`,
    `Turn Contacts on so a name is enough when ${act}.`,
    false,
  );
}

/** The Bland row, as the use-case checks and the job templates both show it. */
export function phoneRow(
  servers: ServerSnap[],
  required: boolean,
  ready: string,
  missing: string,
): CheckItem {
  return row(blandReady(servers), "Phone calls", ready, missing, required, null, "servers");
}

/** Any app that can hold an itinerary or shortlist. */
const PLAN_APPS = ["google_maps", "googlesheets", "notion"];

export function buyerComplete(buyer: BuyerProfile): boolean {
  return [
    buyer.firstName,
    buyer.lastName,
    buyer.email,
    buyer.phone,
    buyer.address1,
    buyer.city,
    buyer.province,
    buyer.postalCode,
  ].every((part) => part.trim().length > 0);
}

/** What one kind of ask needs, row by row. */
export function useCaseChecks(id: string, snap: UseCaseSnap): CheckItem[] {
  const searchRow = (label: string, required: boolean): CheckItem =>
    row(
      searchReady(snap.servers),
      label,
      "Web search is ready.",
      "Web search is included with Buddy.",
      required,
      null,
      "servers",
    );

  switch (id) {
    case "discover":
      return [
        searchRow("Product search", true),
        tool(
          snap,
          "browser_tabs",
          "Browser tabs",
          "Buddy can open a product page in your browser.",
          "Turn Browser tabs on so Buddy can walk you through options.",
        ),
        row(
          snap.shopifyKey,
          "Shopify Catalog",
          "Structured product search across Shopify merchants.",
          "Add a Shopify Catalog key for structured product search.",
          false,
          KEYS,
        ),
        row(
          snap.screenAwareness && snap.marksEnabled,
          "Circle to find similar",
          "Circle a product photo and ask for something like it.",
          "Turn on Eyes and Draw to point to circle a product photo.",
          false,
          snap.screenAwareness
            ? { label: "+ Turn on", page: "summon" }
            : { label: "+ Turn on", page: "eyes" },
        ),
      ];
    case "purchase":
      return [
        row(
          snap.hasCard,
          "Payment card",
          "A card is saved for checkout.",
          "Add a payment card.",
          true,
          BUY,
        ),
        row(
          buyerComplete(snap.shipping),
          "Shipping address",
          "Name, email, phone, and a US address are saved.",
          "Fill in the shipping address.",
          true,
          BUY,
        ),
        row(
          snap.agentModeEnabled,
          "Computer use",
          "Buddy can check out in his own browser.",
          "Turn on Computer Use so Buddy can check out in his own browser.",
          true,
          { label: "Open Agent", page: "agent" },
        ),
      ];
    case "book":
      return [
        searchRow("Web search", true),
        row(
          snap.agentModeEnabled,
          "Computer use",
          "Buddy can book through your own logged-in browser.",
          "Turn on Computer Use so Buddy can book through your browser.",
          false,
          { label: "+ Turn on", page: "agent" },
        ),
        phoneRow(
          snap.servers,
          false,
          "Buddy can call to make a reservation.",
          "Phone calls are included with Buddy.",
        ),
        row(
          PLAN_APPS.some((slug) => snap.connectedApps.includes(slug)),
          "Itinerary apps",
          "Maps, Sheets, or Notion keeps the plan.",
          "Connect Google Maps, Sheets, or Notion to save itineraries.",
          false,
          APPS,
          "apps",
        ),
      ];
    case "call":
      return [
        phoneRow(snap.servers, true, "Calling is connected.", "Phone calls are included with Buddy."),
        contactsRow(snap, "calling"),
      ];
    case "text":
      return [
        tool(
          snap,
          "messages",
          "Messages",
          "Buddy can text from Messages.",
          "Turn Messages on to send texts.",
        ),
        contactsRow(snap, "texting"),
      ];
    case "email":
      return [
        tool(
          snap,
          "mail",
          "Apple Mail",
          "Buddy can read your inbox and draft replies in Mail.",
          "Turn Mail on to read your inbox and draft replies.",
        ),
        row(
          snap.connectedApps.includes("gmail"),
          "Gmail",
          "Gmail is connected: Buddy can also archive, clear junk, and send.",
          "Connect Gmail so Buddy can also archive, clear junk, and send.",
          false,
          APPS,
          "apps",
        ),
      ];
    default:
      return [];
  }
}

/**
 * Setup the user can still do, for the guide prompt: each missing piece with
 * the Settings page open_settings shows for it. Pieces Buddy provides itself
 * (search and calls) are left out: there is nothing to set. Empty when every
 * row is done. skipApps when this turn doesn't yet know which apps are
 * connected.
 */
export function useCaseNudgeBlock(
  snap: UseCaseSnap,
  options?: { skipApps?: boolean },
): string {
  const lines: string[] = [];
  for (const useCase of USE_CASES) {
    const missing = useCaseChecks(useCase.id, snap).filter(
      (item) =>
        !item.ok &&
        item.fix !== null &&
        // Composio rows stay unsaid until a connected-apps list has landed;
        // nagging about Gmail before we know is a false alarm.
        !(options?.skipApps && item.fix.page === "apps"),
    );
    if (missing.length === 0) continue;
    const bits = missing.map((item) => {
      const kind = item.required ? "required" : "recommended";
      // The detail says what the piece does; a bare label like "Bland" tells the model nothing.
      return `${item.label} (${kind}, page "${item.fix?.page}" — ${item.detail.replace(/\.$/, "")})`;
    });
    lines.push(`- ${useCase.label} — “${useCase.example}”: ${bits.join("; ")}.`);
  }
  if (lines.length === 0) return "";
  return `When what they just asked matches one of these and a required piece is still missing, call open_settings with that piece's page so it is in front of them, say in one short sentence what to add there, then do what you still can. Mention a recommended piece only when the required ones for that ask are already done, only once, and without opening Settings for it. Leave the rest unsaid.
${lines.join("\n")}`;
}
