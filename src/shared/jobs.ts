// Background jobs, pure: schedules and their clock math, the commerce job
// templates, and the shapes Ideas and Settings → Jobs share. The scheduler,
// the pages, and the tests all read the same definitions here.

import { CHECKOUT_WORDS } from "./checkout-words";
import { CONNECT_APPS, connectAppLabel } from "./connect-apps";
import { parseInstructions, toolRefs } from "./instructions";
import { registrableDomain } from "./link-text";
import { SIGN_IN_SITES } from "./types";
import type { MomentKind } from "./moments";
import {
  phoneRow,
  row,
  searchReady,
  useCaseChecks,
  type CheckItem,
  type UseCaseId,
  type UseCaseSnap,
} from "./use-cases";

// --- Schedules -----------------------------------------------------------------

/**
 * A job's schedule is one string: `on-demand`, an interval (`every-15m`,
 * `every-6h`), or a clock schedule `<cadence>-[<day>-]<hour>[:<minute>]` at
 * whatever time the user asked for (`daily-10:30`, `weekly-1-9`,
 * `monthly-15-18:45`). The day is a weekday number for weekly (Sunday 0), a
 * date for monthly. An older id with no minute (`daily-9`) is that hour sharp.
 */
export type JobScheduleId = string;

/** The clock cadences: how often, before the time of day. */
export const JOB_CADENCES = [
  { id: "daily", label: "Every day" },
  { id: "weekdays", label: "Weekdays" },
  { id: "weekly", label: "Every week" },
  { id: "monthly", label: "Every month" },
] as const;
export type JobCadence = (typeof JOB_CADENCES)[number]["id"];

/** The schedules that are not a clock: picked as they are. */
export const JOB_INTERVALS = [
  { id: "on-demand", label: "When I ask" },
  { id: "every-15m", label: "Every 15 minutes" },
  { id: "every-1h", label: "Every hour" },
  { id: "every-6h", label: "Every 6 hours" },
] as const;

/** Common schedules, for a model choosing one (the Suggestions run) and for the templates. */
export const JOB_SCHEDULE_PRESETS: readonly JobScheduleId[] = [
  ...JOB_INTERVALS.map((interval) => interval.id),
  "daily-9",
  "daily-18",
  "weekdays-9",
  "weekly-1-9",
  "monthly-1-9",
];

/** Runs only when the user says so: Run now, or "run <job>" to Buddy. */
export const ON_DEMAND: JobScheduleId = "on-demand";

/** nextRunAt of an on-demand job: never due. (Infinity would not survive JSON.) */
export const NEVER = Number.MAX_SAFE_INTEGER;

export interface ClockSchedule {
  kind: JobCadence;
  /** Weekday (0-6) for weekly, date (1-31) for monthly; absent otherwise. */
  day?: number;
  hour: number;
  minute: number;
}

export type ParsedSchedule =
  | { kind: "on-demand" }
  | { kind: "every"; minutes: number }
  | ClockSchedule;

const CLOCK_ID =
  /^(daily|weekdays|weekly|monthly)(?:-(\d{1,2}))?-(\d{1,2})(?::(\d{2}))?$/;

/** What a schedule id means, or null for one that is not a schedule. */
export function parseSchedule(id: unknown): ParsedSchedule | null {
  if (typeof id !== "string") return null;
  if (id === ON_DEMAND) return { kind: "on-demand" };
  const every = /^every-(\d+)(m|h)$/.exec(id);
  if (every)
    return {
      kind: "every",
      minutes: Number(every[1]) * (every[2] === "h" ? 60 : 1),
    };
  const clock = CLOCK_ID.exec(id);
  if (!clock) return null;
  const kind = clock[1] as JobCadence;
  const day = clock[2] === undefined ? undefined : Number(clock[2]);
  const hour = Number(clock[3]);
  const minute = Number(clock[4] ?? 0);
  const needsDay = kind === "weekly" || kind === "monthly";
  if (needsDay !== (day !== undefined) || hour > 23 || minute > 59) return null;
  if (kind === "weekly" && day! > 6) return null;
  if (kind === "monthly" && (day! < 1 || day! > 31)) return null;
  return { kind, hour, minute, ...(day === undefined ? {} : { day }) };
}

/** The id for a clock schedule, the form parseSchedule reads back. */
export function clockScheduleId({
  kind,
  day,
  hour,
  minute,
}: ClockSchedule): JobScheduleId {
  const time = `${hour}:${String(minute).padStart(2, "0")}`;
  return day === undefined ? `${kind}-${time}` : `${kind}-${day}-${time}`;
}

/** A clock schedule with what the user said, and Monday, the 1st, and 9:00 sharp for what they left out. */
export function clockSchedule(
  kind: JobCadence,
  at?: Partial<Omit<ClockSchedule, "kind">>,
): ClockSchedule {
  // Daily and weekdays drop a day carried over from a weekly or monthly pick.
  const day =
    kind === "weekly" || kind === "monthly" ? (at?.day ?? 1) : undefined;
  return {
    kind,
    hour: at?.hour ?? 9,
    minute: at?.minute ?? 0,
    ...(day === undefined ? {} : { day }),
  };
}

/** "HH:MM" (24-hour: a time field, or the model) into an hour and minute, or null. */
export function parseClockTime(
  text: string,
): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour > 23 || minute > 59 ? null : { hour, minute };
}

export function isJobScheduleId(value: unknown): value is JobScheduleId {
  return parseSchedule(value) !== null;
}

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** "10:30 AM", the way a time reads on a card. */
function clockTimeLabel(hour: number, minute: number): string {
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

function ordinal(day: number): string {
  const tens = day % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? "th"
      : (["th", "st", "nd", "rd"][day % 10] ?? "th");
  return `${day}${suffix}`;
}

export function scheduleLabel(id: JobScheduleId): string {
  const parsed = parseSchedule(id);
  if (!parsed) return id;
  if (parsed.kind === "on-demand" || parsed.kind === "every") {
    return JOB_INTERVALS.find((interval) => interval.id === id)?.label ?? id;
  }
  const at = `at ${clockTimeLabel(parsed.hour, parsed.minute)}`;
  switch (parsed.kind) {
    case "daily":
      return `Every day ${at}`;
    case "weekdays":
      return `Weekdays ${at}`;
    case "weekly":
      return `Every ${WEEKDAY_NAMES[parsed.day!]} ${at}`;
    case "monthly":
      return `Monthly on the ${ordinal(parsed.day!)} ${at}`;
  }
}

/**
 * The next moment this schedule fires after `from`, local time. Interval
 * schedules count from `from` itself, so an overdue job caught up at launch
 * runs once and then waits a full interval, never a burst of make-up runs.
 */
export function nextRun(schedule: JobScheduleId, from: Date): number {
  const parsed = parseSchedule(schedule);
  if (!parsed || parsed.kind === "on-demand") return NEVER;
  if (parsed.kind === "every") return from.getTime() + parsed.minutes * 60_000;
  const { kind, day, hour, minute } = parsed;
  const fits = (date: Date): boolean =>
    kind === "weekdays"
      ? date.getDay() >= 1 && date.getDay() <= 5
      : kind === "weekly"
        ? date.getDay() === day
        : kind === "monthly"
          ? date.getDate() === day
          : true;
  const next = new Date(from);
  next.setHours(hour, minute, 0, 0);
  while (next.getTime() <= from.getTime() || !fits(next)) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

/** A failed run tries again this long after, up to MAX_RETRIES times per slot. */
export const RETRY_MS = 10 * 60_000;
export const MAX_RETRIES = 3;

/**
 * When a job runs next after its `failures`-th failure in a row. A failed run
 * (the Mac slept mid-request, the network dropped) must not cost the whole
 * slot: it tries again shortly, a few times, never past the next scheduled
 * slot. An on-demand job waits to be asked again.
 */
export function retryAt(
  schedule: JobScheduleId,
  from: Date,
  failures: number,
): number {
  const scheduled = nextRun(schedule, from);
  if (schedule === ON_DEMAND || failures > MAX_RETRIES) return scheduled;
  return Math.min(scheduled, from.getTime() + RETRY_MS);
}

// --- Jobs ------------------------------------------------------------------------

/** Local abilities (BUILTIN_TOOLS ids): the ones that act on this Mac itself. */
const LOCAL_JOB_TOOL_IDS = [
  "run_command",
  "browser_tabs",
  "messages",
  "mail",
  "notes",
  "shortcuts",
] as const;

/**
 * Whether a job's instructions name a Mac tool, so its runs share the user's
 * Mac: they wait for an idle moment and run alone.
 */
export function usesThisMac(prompt: string): boolean {
  return toolRefs(prompt).some((id) =>
    (LOCAL_JOB_TOOL_IDS as readonly string[]).includes(id),
  );
}

/** What the Jobs form edits; main owns the runtime fields below. */
export interface JobDraft {
  /** Absent = create a new job. */
  id?: string;
  name: string;
  /** What to check and do, written to Buddy like any ask. */
  prompt: string;
  schedule: JobScheduleId;
}

/** One saved background job. */
export interface Job extends Required<Omit<JobDraft, "id">> {
  id: string;
  paused: boolean;
  /** The conversation its runs land in; '' until the first run. */
  conversationId: string;
  nextRunAt: number;
  /** 0 = never ran. */
  lastRunAt: number;
  /** First line of the last run's report; '' = nothing new (or no runs). */
  lastReport: string;
  /** The REMEMBER note carried into the next run (last prices, seen ids). */
  memory: string;
  /** A run is in flight right now. */
  running?: boolean;
}

/** A write a background run parked for the user's decision. */
export interface JobApproval {
  id: string;
  at: number;
  /** The job or idea whose run parked it, for display. */
  source: string;
  /** Where the approved call's result is recorded. */
  conversationId: string;
  /** The registry tool to re-execute, with the exact input the run sent. */
  toolName: string;
  input: unknown;
  /** The confirmation card's text — what the user is approving. */
  title: string;
  detail: string;
  /** Set when "Always allow" has a permission row to write. */
  always?: { serverId: string; toolName: string };
}

export interface JobsView {
  jobs: Job[];
  approvals: JobApproval[];
}

/**
 * The job the user named out loud ("run my paper towels job", "reorder
 * toilet paper"). An exact name wins; otherwise the job sharing the most
 * words with what they said, as long as one job is clearly ahead.
 */
export function matchJob<T extends { name: string }>(
  spoken: string,
  jobs: readonly T[],
): T | null {
  const words = (text: string): string[] =>
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !FILLER.has(word));
  const asked = words(spoken);
  const exact = jobs.find(
    (job) => job.name.trim().toLowerCase() === spoken.trim().toLowerCase(),
  );
  if (exact) return exact;
  const scored = jobs
    .map((job) => ({
      job,
      score: words(job.name).filter((word) => asked.includes(word)).length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  const [best, runnerUp] = scored;
  return runnerUp && runnerUp.score === best!.score ? null : best!.job;
}

/** Words that name the act of running, not the job. */
const FILLER = new Set([
  "run",
  "the",
  "job",
  "now",
  "please",
  "again",
  "start",
]);

// --- Ideas -----------------------------------------------------------------------

/** A product the run found, shown on its card so the user sees the pick itself. */
export interface IdeaProduct {
  url: string;
  /** "$89.99", already formatted; absent when the page showed no price. */
  price?: string;
  seller?: string;
  image?: string;
}

/** One suggestion from the morning Suggestions run. A schedule makes it a job to install. */
export interface Idea {
  id: string;
  kind: UseCaseId;
  title: string;
  /** The act and its object in a few plain words ("book dinner via carota"), so a rewording reads as the same idea. */
  about?: string;
  blurb: string;
  /** How Buddy texts it: a casual line or two, the way a friend would. */
  message?: string;
  /** The exact ask to run (once, or as the installed job's prompt). */
  prompt: string;
  /** Connected-app slug Buddy would use to do it, for the card's chip. */
  app?: string;
  /** The conversation the idea grew out of: its id and title, so the card can say where it came from. */
  source?: { conversationId: string; title: string };
  /** Recurring ideas carry the schedule "Yes" installs them on. */
  schedule?: JobScheduleId;
  /** A real product page the run found for them, when the idea is a pick. */
  product?: IdeaProduct;
  /** Set when Buddy noticed this itself: which kind of moment, and when it has passed. */
  moment?: { kind: MomentKind; until: number };
}

/** What Buddy texts or says for an idea: its own message, else the why-now, then the question. */
export function ideaMessage(
  idea: Pick<Idea, "title" | "blurb" | "message">,
): string {
  return (idea.message || `${idea.blurb} ${idea.title}`).trim();
}

export interface IdeasView {
  ideas: Idea[];
  /** Epoch ms of the last Ideas run; 0 = never. */
  checkedAt: number;
  /** A run is in flight (the morning one or Check now); a second request waits on it. */
  running: boolean;
}

/**
 * Kinds a suggestion may run without Do it when the user has allowed that:
 * a pick to look at, and mail, whose ideas draft (a send inside the run
 * still asks). Purchases, bookings, calls, texts, and anything recurring
 * wait on the deck: a new job is a standing commitment, so it needs a yes.
 */
const SAFE_IDEA_KINDS: ReadonlySet<UseCaseId> = new Set<UseCaseId>([
  "discover",
  "email",
]);

/** Whether the idea may run on its own: a one-time look or draft. */
export function isSafeIdea(idea: Pick<Idea, "kind" | "schedule">): boolean {
  return !idea.schedule && SAFE_IDEA_KINDS.has(idea.kind);
}

/** A suggestion already shown, kept so the next run can refuse to repeat it. */
export interface PastIdea {
  title: string;
  /** The idea's normalized act and object (Idea.about). */
  about?: string;
  /** Product page, when the suggestion was one specific pick. */
  url?: string;
}

const SUGGESTION_STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "your",
  "you",
]);

/** Significant words of a suggestion title. */
function suggestionWords(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !SUGGESTION_STOP.has(word));
}

/**
 * Runs of two or more capitalized words ("Veja Esplar", "Therabody
 * WaveSolo"). The first word is skipped: titles open with a capitalized verb,
 * and "Buy Zach" names no product.
 */
function namedThings(title: string): string[] {
  const names: string[] = [];
  let run: string[] = [];
  const close = (): void => {
    if (run.length > 1) names.push(run.join(" ").toLowerCase());
    run = [];
  };
  for (const word of title.split(/\s+/).slice(1)) {
    const clean = word.replace(/[^\p{L}\p{N}'’-]/gu, "");
    if (/^\p{Lu}/u.test(clean)) run.push(clean);
    else close();
    if (clean !== word) close();
  }
  close();
  return names;
}

/**
 * True when two titles are the same suggestion in different words: the same
 * named thing ("Veja Esplar"), or nearly the same words. A different product
 * that shares a brand ("Anne Satin Coat" and "Anne Satin Dress") stays apart.
 * `shared` is how much of the shorter one's words the other must hold.
 */
export function sameSuggestion(a: string, b: string, shared = 0.8): boolean {
  const names = new Set(namedThings(b));
  if (namedThings(a).some((name) => names.has(name))) return true;
  const left = suggestionWords(a);
  const right = new Set(suggestionWords(b));
  const common = left.filter((word) => right.has(word)).length;
  const smaller = Math.min(left.length, right.size);
  return smaller > 0 && common / smaller >= shared;
}

/** The model writes `about` the same way each time, so two of them need only mostly agree. */
const ABOUT_SHARED = 0.6;

/** True when two product links are the same page, ignoring the query string. */
export function sameProduct(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.host === right.host && left.pathname === right.pathname;
  } catch {
    return a === b;
  }
}

/** True when this suggestion restates one already shown, including a rewording: by title, by what it is about, or by product page. */
export function isRepeatedSuggestion(
  idea: PastIdea,
  earlier: PastIdea[],
): boolean {
  return earlier.some(
    (item) =>
      sameSuggestion(item.title, idea.title) ||
      Boolean(
        item.about &&
        idea.about &&
        sameSuggestion(item.about, idea.about, ABOUT_SHARED),
      ) ||
      sameProduct(item.url, idea.url),
  );
}

// --- Templates ---------------------------------------------------------------------

/**
 * What a job needs before it can work: web search, Buy with Buddy (card,
 * address, computer use), a phone (Bland), a connected app, or a site Buddy's
 * browser must be signed in to.
 */
export type JobNeed =
  | "search"
  | "checkout"
  | "phone"
  | `app:${string}`
  | `site:${string}`;

export interface JobTemplate {
  id: string;
  label: string;
  kind: UseCaseId;
  blurb: string;
  /** [Bracketed] parts are for the user to fill in. */
  prompt: string;
  schedule: JobScheduleId;
  needs: JobNeed[];
}

/** Social sites: a sign-in, but no card or address on the account. */
const SOCIAL_HOSTS = new Set(["linkedin.com", "facebook.com", "instagram.com"]);
/** A bare word this common is not the site. The domain still counts. */
const LABEL_SKIP = new Set(["target"]);
const PHONE_WORDS = /\b(?:call|calls|calling|phone|dial)\b/i;
const SEARCH_WORDS =
  /\b(?:find|search|look (?:for|up)|check (?:the |its |their )?(?:price|stock)|new arrivals|back in stock|research)\b/i;

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The word, or the domain, appears in the text on its own. */
function names(text: string, label: string, host?: string): boolean {
  if (
    host &&
    new RegExp(`(?:^|[^\\w.])${escapeReg(host)}(?:$|[^\\w.])`).test(text)
  )
    return true;
  if (LABEL_SKIP.has(label.toLowerCase())) return false;
  return new RegExp(`\\b${escapeReg(label.toLowerCase())}\\b`).test(text);
}

/**
 * What the instructions need, read off the words: a chip, "amazon.com", or
 * the name itself. Sites Buddy's browser signs in to, connected apps, a
 * phone call, a purchase, and a search. A template's own needs come first.
 */
export function jobNeeds(
  prompt: string,
  base: readonly JobNeed[] = [],
): JobNeed[] {
  const parts = parseInstructions(prompt);
  const text = prompt.toLowerCase();
  const chipped = (source: "site" | "app"): string[] =>
    parts.flatMap((part) =>
      part.kind === "ref" && part.source === source
        ? [source === "site" ? registrableDomain(part.id) : part.id]
        : [],
    );
  const siteHosts = new Set(chipped("site"));
  const appSlugs = new Set(chipped("app"));
  const needs: JobNeed[] = [];
  const add = (need: JobNeed): void => {
    if (!needs.includes(need)) needs.push(need);
  };
  // Sites first: the account row leads, and the purchase rows follow it.
  for (const site of SIGN_IN_SITES) {
    if (siteHosts.has(site.host) || names(text, site.label, site.host))
      add(`site:${site.host}`);
  }
  for (const need of base) add(need);
  if (SEARCH_WORDS.test(text)) add("search");
  for (const app of CONNECT_APPS) {
    if (appSlugs.has(app.slug) || names(text, app.label))
      add(`app:${app.slug}`);
  }
  if (PHONE_WORDS.test(text)) add("phone");
  if (CHECKOUT_WORDS.test(text)) add("checkout");
  return needs;
}

/** Readiness rows for a job's needs, in the same shape as the use-case checks. One row per label. */
export function templateChecks(
  needs: readonly JobNeed[],
  snap: UseCaseSnap,
): CheckItem[] {
  // A store with the card on its account (Amazon, not Instagram) makes the saved card and address moot.
  const accountStore = needs.some(
    (need) => need.startsWith("site:") && !SOCIAL_HOSTS.has(need.slice(5)),
  );
  const signedIn = new Set(snap.signedInHosts ?? []);
  const rows = needs.flatMap((need): CheckItem[] => {
    if (need === "search") {
      const ok = searchReady(snap.servers);
      return [
        {
          label: "Web search",
          ok,
          required: true,
          detail: ok
            ? "Web search is ready."
            : "Web search is included with Buddy.",
          fix: null,
          await: "servers",
        },
      ];
    }
    if (need === "checkout") {
      const purchase = useCaseChecks("purchase", snap);
      return accountStore
        ? purchase.filter((row) => row.label === "Computer use")
        : purchase;
    }
    if (need === "phone") {
      return [
        phoneRow(
          snap.servers,
          true,
          "Buddy can place the call.",
          "Phone calls are included with Buddy.",
        ),
      ];
    }
    if (need.startsWith("site:")) {
      const host = need.slice(5);
      const label =
        SIGN_IN_SITES.find((site) => site.host === host)?.label ?? host;
      const ok = signedIn.has(host);
      return [
        {
          label: `${label} account`,
          ok,
          required: true,
          detail: ok
            ? `Signed in on ${label} in Buddy's browser.`
            : `Sign in to ${label} in Buddy's browser.`,
          fix: ok ? null : { label: "Sign in", page: "browser" },
          await: "signins",
        },
        row(
          snap.agentModeEnabled,
          "Computer use",
          `Buddy can use ${label} in his own browser.`,
          `Turn on Computer Use so Buddy can use ${label} in his own browser.`,
          true,
          { label: "Open Agent", page: "agent" },
        ),
      ];
    }
    const slug = need.slice(4);
    const ok = snap.connectedApps.includes(slug);
    const label = connectAppLabel(slug);
    return [
      {
        label,
        ok,
        required: true,
        detail: ok ? `${label} is connected.` : `Connect ${label}.`,
        fix: ok ? null : { label: "+ Connect", page: "apps" },
        await: "apps",
      },
    ];
  });
  const seen = new Set<string>();
  return rows.filter((item) => !seen.has(item.label) && seen.add(item.label));
}

/** The template every install starts with as its first job. */
export const DEFAULT_JOB = "morning-brief";

/**
 * The shopping loop on a timer (watch, compare to last run, say what
 * changed), plus the chores people hand an assistant: the inbox, the
 * reorder, the call nobody wants to make. Each prompt names the one line
 * the user sees, and says nothing when there is nothing to decide.
 */
export const JOB_TEMPLATES: JobTemplate[] = [
  {
    id: "morning-brief",
    label: "Morning brief",
    kind: "email",
    blurb:
      "Each morning: who needs an answer (reply drafted), what's on today, and one thing to get ahead of a trip or event coming up. Quiet when nothing needs you.",
    prompt:
      "My morning brief, in a few lines, or nothing at all when nothing needs me. " +
      'Email: go through [Gmail](app:gmail) since the last run for messages from people I know that need an answer, or anything due today or tomorrow. Draft (never send) a reply to the one that matters most, in my voice, and tell me who needs an answer and how many are waiting, as a question I can say yes to: "Sam needs an answer on Friday\'s dinner, 2 others waiting. Send the draft?" The drafts stay in this thread; do not archive, label, or clean up anything. ' +
      "Today: read today in [Google Calendar](app:googlecalendar) and give me the day in one line, with anything that clashes or moved. " +
      'Ahead: look over the next two weeks for a trip or an event worth preparing for. When there is one, suggest one thing to get or do for it, with a link: "Lisbon on the 14th. A packable rain shell?" Skip it when nothing is coming, or you already suggested something for that event.',
    schedule: "daily-9",
    needs: ["app:gmail", "app:googlecalendar"],
  },
  {
    id: "reorder",
    label: "Reorder",
    kind: "purchase",
    blurb:
      "Buys something you run out of, from its page: when you say “run <name>”, or on a schedule.",
    prompt:
      'Reorder [quantity] of [product] from [product URL]. Check the page is that exact product and in stock, and that the price is about [usual price]. Then buy it with my saved card, shipped to my saved address. If the price is well above that, stop and ask in one line with the price: "Paper towels are $34, up from $22. Still order?"',
    schedule: ON_DEMAND,
    needs: ["checkout"],
  },
  {
    id: "waitlist-call",
    label: "Waitlist call",
    kind: "call",
    blurb:
      "Calls a dentist, doctor, or restaurant to ask whether an earlier slot opened up.",
    prompt:
      "Call [business and its phone number] and ask whether an earlier [appointment or reservation] has opened up for [name] before [date]. If one has, take it and tell me the new time in one line. If not, ask to stay on the cancellation list and say nothing.",
    schedule: "weekly-1-9",
    needs: ["phone"],
  },
  {
    id: "price-drop",
    label: "Price drop",
    kind: "discover",
    blurb: "Watches a product and asks when the price falls.",
    prompt:
      'Check the current price of [product, with its URL if you have one]. Say nothing until it drops below [target price]. Then one line with the price and the link: "The coat is $89, under your $120. Grab it?"',
    schedule: "every-6h",
    needs: ["search"],
  },
  {
    id: "back-in-stock",
    label: "Back in stock",
    kind: "discover",
    blurb: "Checks a sold-out product and asks the moment it is back.",
    prompt:
      'Check whether [product, size and color, with its URL] is back in stock. Say nothing until it is. Then one line with the price and the link: "The Esplar in 42 is back, $150. Order it?"',
    schedule: "every-1h",
    needs: ["search"],
  },
  {
    id: "new-arrivals",
    label: "New arrivals",
    kind: "discover",
    blurb: "Watches a brand or search for new pieces that match your taste.",
    prompt:
      'Search for new arrivals matching [brand or search, e.g. "linen shirts under $80"]. Say nothing when there is nothing new. Otherwise lead with the one best piece, its price, and the link, as a question: "New linen shirt from Taylor Stitch, $78. Want a look?" List the rest below it.',
    schedule: "daily-9",
    needs: ["search"],
  },
  {
    id: "weekly-outing",
    label: "Weekly outing",
    kind: "book",
    blurb:
      "Books one night out a week: a table, or a call when the place takes no reservations.",
    prompt:
      'Book [dinner, drinks, or an activity] for [who, e.g. Amanda and me] one evening in the week ahead, in [neighborhood]. Pick a place that fits my taste from memory, somewhere we have not been lately. Reserve through [OpenTable](site:opentable.com) or [Resy](site:resy.com). If the place takes neither, find its phone number and call to book. Then one line with the place and time, as a question: "Thursday 7:30 at Via Carota for two. Keep it?"',
    schedule: "weekly-1-9",
    needs: ["site:opentable.com", "site:resy.com", "search", "phone"],
  },
  {
    id: "ride-to-plans",
    label: "Ride to today's plans",
    kind: "book",
    blurb:
      "Each morning: a ride scheduled for the day's in-person events, the cheaper one that still arrives on time.",
    prompt:
      'Check my [Google Calendar](app:googlecalendar) for today\'s in-person events. If there are none, say nothing. For each one, work out the travel time from home with traffic, then compare [Uber](site:uber.com) and [Lyft](site:lyft.com) and schedule the cheaper ride that still arrives [minutes early, e.g. 10] before it starts. Then one line per ride with the pickup time and price: "Uber at 2:15 for Dr. Park, $18. Arrives 2:45."',
    schedule: "daily-9",
    needs: ["site:uber.com", "site:lyft.com", "app:googlecalendar"],
  },
  {
    id: "table-watch",
    label: "Table opening",
    kind: "book",
    blurb: "Checks a booked-out restaurant for an opening on your date.",
    prompt:
      'Check whether [restaurant] has a table for [party size] on [date and time window]. Say nothing until one opens. Then one line with the time and the booking link: "Bobo has 7:30 for two Friday. Book it?"',
    schedule: "every-1h",
    needs: ["search"],
  },
  {
    id: "stay-rate",
    label: "Hotel & rental rates",
    kind: "book",
    blurb: "Watches hotel or rental prices for your dates and flags a deal.",
    prompt:
      'Check nightly rates for [hotel, rental, or area] for [dates]. Say nothing until something good drops below [budget]. Then one line with the nightly rate and the link: "The Ludlow is $240 a night for your dates. Book it?"',
    schedule: "daily-9",
    needs: ["search"],
  },
  {
    id: "order-updates",
    label: "Order updates",
    kind: "email",
    blurb:
      "Watches your inbox for shipping and delivery news on recent orders.",
    prompt:
      'Look through recent email in [Gmail](app:gmail) for order confirmations, shipping notices, and delivery updates. Say nothing when nothing changed since the last run. Otherwise one line with what and when: "Your Nike order lands Thursday."',
    schedule: "daily-9",
    needs: ["app:gmail"],
  },
  {
    id: "return-window",
    label: "Return windows",
    kind: "email",
    blurb: "Asks before a recent purchase becomes final.",
    prompt:
      'Look through recent email in [Gmail](app:gmail) for purchases whose return window closes within the next few days. Say nothing when none do. Otherwise one line with the deadline, as a question: "Nordstrom\'s return closes Thursday. Start it?"',
    schedule: "daily-9",
    needs: ["app:gmail"],
  },
];
