// The Suggestions run: at the hour picked under Settings → Suggestions, or
// the first time Buddy is awake after it. It reads what Buddy already knows — recent
// conversations, connected apps, the calendar, dates coming up, installed
// jobs — and proposes a handful of specific things it could take on. Its
// tools are the read-only searches and propose_ideas, so the run can look
// but never act; every other input rides in the prompt.

import { randomUUID } from "crypto";
import {
  JOB_SCHEDULE_PRESETS,
  JOB_TEMPLATES,
  ON_DEMAND,
  ideaMessage,
  isJobScheduleId,
  isRepeatedSuggestion,
  isSafeIdea,
  type Idea,
  type IdeaProduct,
  type PastIdea,
} from "../../shared/jobs";
import { USE_CASES } from "../../shared/use-cases";
import type { ToolRegistry } from "../ai/tools";
import { openTabs } from "../apple/browser-tabs";
import { inboxHeaders } from "../apple/mail";
import { getChatIndex, getConversation, ownThread } from "../chat/conversations";
import { CONNECT_APPS } from "../../shared/connect-apps";
import { upcomingOccasions } from "../../shared/occasions";
import {
  calendarAhead,
  gmailHeaders,
  knownConnectedApps,
  listConnectedApps,
} from "../composio/apps";
import { addPlaceSearchTools } from "../exa/place-search";
import { addProductSearchTool } from "../exa/product-search";
import { createLogger } from "../log";
import { getSettings } from "../settings";
import { addCatalogTool } from "../shopify/catalog";
import { NO_EM_DASHES, ONE_LINE_RULE } from "../ai/prompt";
import { withTurnScope } from "../ai/turn-scope";
import {
  autoRunCap,
  slotHours,
  suggestionTimeFor,
  suggestionsDue,
} from "../../shared/suggestions";
import { knownPlan } from "../account/api";
import { talkOnly } from "../account/plan-gate";
import { getApiKey } from "../settings/secrets";
import { runHeadlessTurn } from "./headless";
import { firstLine, reachOut, runBackgroundTurn } from "./run";
import {
  getIdeasView,
  listJobs,
  pastIdeas,
  randomSlotHour,
  rememberIdeas,
  removeIdea,
  setIdeas,
  setIdeasRunning,
} from "./store";
import { errorMessage } from "../../shared/errors";
import { withoutEmDash } from "../../shared/em-dash";

const log = createLogger("ideas");

const RUN_TIMEOUT_MS = 2 * 60_000;
/** How many recent conversations the prompt samples. */
const RECENT_CONVERSATIONS = 10;
/** Already-shown titles quoted in the prompt. The store remembers more than this. */
const PAST_IN_PROMPT = 24;

/** The run in flight, so a Suggest now during the scheduled run joins it instead of starting another. */
let current: Promise<void> | null = null;

/**
 * The cadence: the slots the When setting names, as far as the plan allows.
 * Ticks catch the hour itself; a launch or wake later in the day runs the
 * slot it missed.
 */
export async function maybeRunIdeas(now = new Date()): Promise<void> {
  const settings = getSettings();
  if (!settings.ideasEnabled || talkOnly()) return;
  const hours = slotHours(
    suggestionTimeFor(settings.ideasTime, knownPlan()),
    () => randomSlotHour(now),
  );
  if (!suggestionsDue(hours, getIdeasView().checkedAt, now)) return;
  await refreshIdeas();
}

/** One Suggestions run, now. Also behind the page's Check now button. */
export function refreshIdeas(): Promise<void> {
  // Suggestions are things to take on; a waitlist account can only talk.
  if (talkOnly()) return Promise.resolve();
  if (!current) {
    setIdeasRunning(true);
    current = withTurnScope("job", runIdeas).finally(() => {
      current = null;
      setIdeasRunning(false);
    });
  }
  return current;
}

async function runIdeas(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
  try {
    // What's on screen counts as already suggested, including a batch saved
    // before this memory existed. The run has to offer something else.
    rememberIdeas(getIdeasView().ideas.map(pastOf));
    const collected: Idea[] = [];
    const tools: ToolRegistry = new Map();
    addCatalogTool(tools);
    addProductSearchTool(tools);
    addPlaceSearchTools(tools);
    const canSearch = tools.size > 0;
    // Refresh the connection list once; the readers below and the prompt use the cache.
    await listConnectedApps().catch(() => []);
    const [context, calendar] = await Promise.all([
      liveContext(),
      calendarAhead(),
    ]);
    tools.set("propose_ideas", proposeIdeasTool(collected, context.inboxApp));
    await runHeadlessTurn({
      system: ideasSystem(canSearch),
      prompt: ideasPrompt(context, pastIdeas(), calendar),
      tools,
      signal: controller.signal,
      // A couple of product searches, then the one propose_ideas call.
      maxModelCalls: canSearch ? 4 : 2,
    });
    const fresh = withoutRepeats(collected, pastIdeas()).slice(
      0,
      getSettings().ideasCount,
    );
    if (fresh.length < collected.length) {
      log.info(
        `left out ${collected.length - fresh.length} repeated suggestions`,
      );
    }
    setIdeas(fresh);
    rememberIdeas(fresh.map(pastOf));
    // The timely idea reaches them as a message from Buddy: on the phone and from the dot.
    if (fresh[0] && getSettings().ideasReach) reachOut(ideaMessage(fresh[0]));
    // A pasted key only reads on a paid plan, so it also says whose bill the runs land on.
    if (getSettings().ideasAutoRun)
      void runSafeIdeas(
        fresh,
        autoRunCap(knownPlan(), getApiKey("openrouter") !== null),
      );
  } catch (error) {
    log.warn(`suggestions run failed: ${errorMessage(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The user said safe suggestions need no Do it: a look or a draft runs now
 * as a one-off background turn, reporting in its own thread (and one line
 * by text, with the bridge on). Writes inside a run still park for
 * approval, and a recurring idea waits on the deck: a new job needs a yes.
 * The idea leaves the deck once it is taken. `cap` is how many the plan
 * runs (see autoRunCap); the rest wait on New Chat.
 */
async function runSafeIdeas(
  ideas: Idea[],
  cap = Infinity,
): Promise<void> {
  for (const idea of ideas.filter(isSafeIdea).slice(0, cap)) {
    removeIdea(idea.id);
    try {
      const { report } = await runBackgroundTurn({
        source: { kind: "suggestion", name: idea.title },
        memory: "",
        prompt: idea.prompt,
        conversationId: ownThread("background"),
      });
      if (report) reachOut(firstLine(report));
    } catch (error) {
      log.warn(`suggestion "${idea.title}" failed: ${errorMessage(error)}`);
    }
  }
}

/** Inbox headers and open tabs, read once per run. Suggestions always look at them. */
interface LiveContext {
  inbox: string;
  tabs: string;
  /** Set when the headers came from Gmail, so inbox ideas wear that icon. */
  inboxApp?: string;
}

const INBOX_HEADERS = 40;

async function liveContext(): Promise<LiveContext> {
  // Gmail through Composio when it is connected, since that is where most
  // people's orders land; Apple Mail otherwise.
  const [gmail, tabs] = await Promise.all([
    gmailHeaders(INBOX_HEADERS),
    openTabs(),
  ]);
  const inbox = gmail || (await inboxHeaders(INBOX_HEADERS));
  return { inbox, tabs, inboxApp: gmail ? "gmail" : undefined };
}

function ideasSystem(canSearch: boolean): string {
  return `You are Buddy, the user's assistant on their Mac, drawing up today's suggestions: specific things you could take on for them right now or on a schedule.
An idea names the person, event, message, file, or thing, and the one action you would take. Never suggest "checking" or "looking into" something in the abstract, and never a generic chore (summarize a whole inbox, triage every channel, clean up everything).
Each idea is one question the user can answer with yes: its title is the question ("Order food before your 6pm flight?", "Send Sam the draft about Friday?"), and its blurb is the number that decides it and why now, in one short line. ${ONE_LINE_RULE}
Each idea also carries the message: how you would text it to them, as a friend who handles their stuff would. One or two short sentences: what you noticed first, then the offer as a casual question. You have done nothing yet and cannot act in this run, so never say you did, changed, sent, or put back anything; "I put it back on your calendar" is a lie, "Emily's invite is still on your calendar" is what you saw. Contractions and everyday words; say the day and time the way people do ("tomorrow at 2"). No labels, no "I can draft", no "worth a quick note", no filler, no sign-off. "Your Serende call with Hemsy is tomorrow at 2. Want me to put together a quick agenda to send them first?" "Halloween's coming up and that Scottie dog costume kit is $28. Want me to grab it so there's time to sew it?"
${NO_EM_DASHES}
Order matters: the first idea is the one that reaches them on screen. Put the most time-sensitive one first: something due today or tomorrow beats something due next month. One strong, timely idea is a better batch than six.
Draw ideas from the inputs, in this order. Something coming up comes first: an event on their calendar, or a date in the occasions list, turned into one concrete action before that day (book the dinner, choose the gift for someone you know they shop for, send the message, get ready for the meeting). A date is not a plan they made. If the calendar already has that day, use the event and do not add a second idea for the date alone. Do not invent a gathering they are hosting.
Then a connected app: one thing that app can actually do, grounded in the inbox, a recent chat, or the calendar. Gmail is one reply or one draft, not a briefing of the whole inbox. A calendar idea prepares for one event. A doc, page, file, or pull request is one specific item. Use only apps listed as connected, and only for what their description says they can do.
A recent conversation counts as it ended, not as it began: its title is only the first message, often misheard, and what they and you last said is what they meant and what came of it. When they corrected a name, use the corrected one. When it ended with nothing to buy or do (nothing exists, they decided, it is done), it is settled: no idea from it. Never claim a conversation, site, or search said something its lines do not show.
A purchase, a booking, or a product pick only when the inputs show they were already circling it. At most two ideas in the batch may be product picks. Prefer what is happening in the next couple of weeks over what happened a month ago. An idea with no basis in the inputs is filler; leave it out.
The inbox headers and open tabs are fresh inputs. An order confirmation is a package to track; a reservation is a plan to hold; a product page or a checkout left open is a decision they have not made. Mail from a person is a reply to draft. Mail marked automated, or plainly a system notice (a shutdown, a billing, security, or sign-in alert, a newsletter), is never a reply: nobody reads it. Suggest the one thing the notice asks of them (pay the bill, track the package) only when it asks something; an FYI is left out. You see subjects and titles only, never bodies or page contents: say what the header shows and let the ask do the reading.${
    canSearch
      ? `
When an idea really is a place or a product, run one or two searches first (${PRODUCT_SEARCH_NOTE}) and fill its product field from the result line: the URL, the seller or the place's site, the photo link, and for a product or restaurant the price as shown ($ tiers count). A restaurant or a stay is kind "book"; a product to look at is "discover", and one to buy now is "purchase". Never invent a pick or a price: only what a search returned, and a stay never gets a rate.`
      : ""
  }
Call propose_ideas exactly once with your best ideas, never more than ${getSettings().ideasCount} (fewer strong ideas beat more weak ones). Give ideas that should repeat (a price watch, a morning brief of one inbox) a schedule; leave one-time ideas without one. The prompt lists suggestions already shown. Do not propose those again, and do not rewrite one: the same event, message, product, or errand is the same suggestion in different words. Each idea must be a different action from the others and from that list. If nothing new is grounded in the inputs, call it with an empty list. Do not write any other text.`;
}

const PRODUCT_SEARCH_NOTE =
  "products: catalog_search first when it exists, then product_search, each with a plain query and an optional price cap; restaurants: dining_search; hotels and rentals: lodging_search";

/** Where a suggestion can file: any pillar. A schedule is what makes it a job. */
const IDEA_KINDS = USE_CASES.map((page) => page.id);

/** Everything the run may reason from, gathered without the model's help. */
function ideasPrompt(
  context: LiveContext,
  past: PastIdea[],
  calendar: string,
): string {
  // Numbered so an idea can say which one it grew out of (source_conversation).
  // How it ended, not just its title: the title comes from the first message,
  // which may be a mishearing the user corrected later.
  const recent = recentConversations().map((summary, i) => {
    const messages = getConversation(summary.id)?.messages ?? [];
    const last = (role: "user" | "assistant"): string => {
      const text = messages
        .filter((message) => message.role === role)
        .at(-1)?.text;
      return text ? clip(text) : "";
    };
    const lines = [`${i + 1}. ${summary.title}`];
    if (last("user")) lines.push(`   they last said: "${last("user")}"`);
    if (last("assistant"))
      lines.push(`   you last said: "${last("assistant")}"`);
    return lines.join("\n");
  });
  const apps = (knownConnectedApps() ?? []).map((slug) => {
    const app = CONNECT_APPS.find((entry) => entry.slug === slug);
    return app ? `- ${app.label} (${app.slug}): ${app.blurb}` : `- ${slug}`;
  });
  const jobs = listJobs();
  const jobLines = jobs.map((job) => `- ${job.name} (${job.schedule})`);
  const templates = JOB_TEMPLATES.map(
    (template) => `- ${template.label} (${template.kind}): ${template.blurb}`,
  );
  // The shopper profiles carry the taste a product pick should match.
  const shoppers = getSettings()
    .shoppers.filter((shopper) => shopper.products.length > 0)
    .map((shopper) => `- ${shopper.name}: ${shopper.products.join("; ")}`);
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const occasions = upcomingOccasions();
  return [
    `Today is ${today}.`,
    occasions.length
      ? `Dates coming up (common US dates, not events they scheduled):\n${occasions.map((line) => `- ${line}`).join("\n")}`
      : "",
    calendar,
    `Inbox, newest first (headers only):\n${context.inbox || "(no mail reachable: Gmail is not connected and Mail is not running)"}`,
    `Open browser tabs right now:\n${context.tabs || "(no browser is running)"}`,
    `Recent conversations, newest first:\n${recent.join("\n") || "(none yet)"}`,
    `What they like, per person:\n${shoppers.join("\n") || "(nothing saved yet)"}`,
    `Connected apps:\n${apps.join("\n") || "(none)"}`,
    `Jobs already installed (do not suggest duplicates):\n${jobLines.join("\n") || "(none)"}`,
    `Recurring shapes that work well:\n${templates.join("\n")}`,
    past.length
      ? `Already suggested (do not offer these again, or the same thing rewritten):\n${past
          .slice(-PAST_IN_PROMPT)
          .map((idea) => `- ${idea.title}`)
          .join("\n")}`
      : "",
    "Propose today's ideas. Every one must be a different action from the already-suggested list and from the others you propose. At most two may be product picks.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function recentConversations(): ReturnType<
  typeof getChatIndex
>["conversations"] {
  return getChatIndex().conversations.slice(0, RECENT_CONVERSATIONS);
}

function clip(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > 240 ? `${clean.slice(0, 239)}…` : clean;
}

function pastOf(idea: Pick<Idea, "title" | "about" | "product">): PastIdea {
  return {
    title: idea.title,
    ...(idea.about ? { about: idea.about } : {}),
    ...(idea.product?.url ? { url: idea.product.url } : {}),
  };
}

/** Drop ideas that restate something already shown, or each other. */
function withoutRepeats(ideas: Idea[], past: PastIdea[]): Idea[] {
  const kept: Idea[] = [];
  for (const idea of ideas) {
    const earlier = [...past, ...kept.map(pastOf)];
    if (isRepeatedSuggestion(pastOf(idea), earlier)) continue;
    kept.push(idea);
  }
  return kept;
}

function proposeIdeasTool(collected: Idea[], inboxApp?: string) {
  return {
    definition: {
      name: "propose_ideas",
      description:
        "Save today's suggestions. Call exactly once, with every idea in one list.",
      input_schema: {
        type: "object" as const,
        properties: {
          ideas: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: {
                  type: "string",
                  enum: IDEA_KINDS,
                  description:
                    "What Buddy would do when they say yes. discover: find, compare, or watch products (a pick to look at, a price or stock watch). " +
                    "purchase: buy something: finish a checkout or cart left behind, retry a failed payment, reorder, add to cart and check out. " +
                    "book: tables, travel, stays. call: place a phone call. text: send a text. email: send an email, or read their inbox (order updates, return windows). " +
                    "The test is the act, not the topic: finishing the sock checkout is purchase, watching the sock price is discover, emailing the store about the socks is email.",
                },
                title: {
                  type: "string",
                  description:
                    'The question, answerable with yes, under 50 characters so it fits one line: "Order food before your 6pm flight?"',
                },
                about: {
                  type: "string",
                  description:
                    'The act and its object, three to six plain lowercase words, written the same way every time: "order dinner before flight", "reorder paper towels", "watch price sony headphones". This is how the same idea is recognised when it comes back in other words.',
                },
                blurb: {
                  type: "string",
                  description:
                    'The number that decides it and why now, one short line: "Flight at 6, nothing ordered since morning."',
                },
                message: {
                  type: "string",
                  description:
                    "The text you would send them: situation first, then a casual offer. \"Your flight's at 6 and you haven't eaten. Want me to order something before you head out?\"",
                },
                prompt: {
                  type: "string",
                  description: "The exact ask to run when they say yes.",
                },
                app: {
                  type: "string",
                  description:
                    "Connected-app slugs Buddy would use, comma-separated when more than one (gmail, googlecalendar). Required when an app does the work. Also name each one in the prompt as [Gmail](app:gmail).",
                },
                source_conversation: {
                  type: "number",
                  description:
                    "The number of the recent conversation this idea grew out of, when it did.",
                },
                schedule: {
                  type: "string",
                  enum: JOB_SCHEDULE_PRESETS.filter((id) => id !== ON_DEMAND),
                  description:
                    "Only for ideas that should repeat; makes Yes install a job.",
                },
                product: {
                  type: "object",
                  description:
                    "Only when the idea is a real product, restaurant, or stay a search returned this run.",
                  properties: {
                    url: {
                      type: "string",
                      description:
                        "The product or place's own page URL from the result line.",
                    },
                    price: {
                      type: "string",
                      description:
                        'Exactly as the result showed it: "$89.99" for a product, "$$" for a restaurant. Never for a stay.',
                    },
                    seller: {
                      type: "string",
                      description:
                        'The store or brand, or for a place its area ("West Village").',
                    },
                    image: {
                      type: "string",
                      description:
                        "The photo link from the result line, if one.",
                    },
                  },
                  required: ["url"],
                },
              },
              required: ["kind", "title", "about", "blurb", "message", "prompt"],
            },
          },
        },
        required: ["ideas"],
      },
    },
    execute: (input: unknown) => {
      const record =
        typeof input === "object" && input
          ? (input as Record<string, unknown>)
          : {};
      const items = Array.isArray(record.ideas) ? record.ideas : [];
      for (const item of items) {
        const idea = parseIdea(item, inboxApp);
        if (idea) collected.push(idea);
      }
      return { content: `Saved ${collected.length} ideas.`, endLoop: true };
    },
  };
}

function parseIdea(raw: unknown, inboxApp?: string): Idea | null {
  const item =
    typeof raw === "object" && raw ? (raw as Record<string, unknown>) : {};
  const kind = IDEA_KINDS.find((id) => id === item.kind);
  const words = (value: unknown): string =>
    typeof value === "string" ? withoutEmDash(value.trim()) : "";
  const title = words(item.title);
  const about = words(item.about).toLowerCase();
  const blurb = words(item.blurb);
  const message = words(item.message);
  const prompt = words(item.prompt);
  if (!kind || !title || !prompt) return null;
  const named =
    typeof item.app === "string"
      ? item.app
          .split(/[,\s]+/)
          .filter((slug) => CONNECT_APPS.some((entry) => entry.slug === slug))
      : [];
  if (kind === "email" && inboxApp && !named.includes(inboxApp))
    named.unshift(inboxApp);
  const app = named.length > 0 ? named.join(",") : undefined;
  const product = parseProduct(item.product);
  const sourceIndex = Number(item.source_conversation);
  const source = Number.isInteger(sourceIndex)
    ? recentConversations()[sourceIndex - 1]
    : undefined;
  return {
    id: randomUUID(),
    kind,
    title,
    ...(about ? { about } : {}),
    blurb,
    ...(message ? { message } : {}),
    prompt,
    ...(app ? { app } : {}),
    ...(source
      ? { source: { conversationId: source.id, title: source.title } }
      : {}),
    ...(isJobScheduleId(item.schedule) ? { schedule: item.schedule } : {}),
    ...(product ? { product } : {}),
  };
}

/** A product pick needs a real http(s) page; the rest is optional and trimmed. */
function parseProduct(raw: unknown): IdeaProduct | null {
  const item =
    typeof raw === "object" && raw ? (raw as Record<string, unknown>) : {};
  const url = httpsUrl(item.url);
  if (!url) return null;
  const text = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim()
      ? value.trim().slice(0, 80)
      : undefined;
  const image = httpsUrl(item.image);
  return {
    url,
    ...(text(item.price) ? { price: text(item.price) } : {}),
    ...(text(item.seller) ? { seller: text(item.seller) } : {}),
    ...(image ? { image } : {}),
  };
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
