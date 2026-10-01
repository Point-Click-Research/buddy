// The shapes the Buddy API returns and the desktop reads. The API keeps the
// same file; a change here has to land there too, or the two stop agreeing.

import { z } from 'zod';

/**
 * What a plan buys is counted per local day: talk turns (null = unlimited)
 * and agent tasks. waitlist: where a new account starts; fast models, a few
 * asks a day, no tasks. free: the public tier at launch, and where a
 * cancelled subscription lands. early: off the waitlist by referral; every
 * model, a few tasks a day, until launch. pro ($20), plus ($60), and max
 * ($200): paid; every model, unlimited talk and tasks inside an included
 * pool of model use, own keys, and past the pool, extra usage at cost once
 * they turn it on. They differ only in the size of the pool.
 */
export const PLAN_IDS = ['waitlist', 'free', 'early', 'pro', 'plus', 'max'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Each plan as the user reads it. */
export const PLAN_NAMES: Record<PlanId, string> = {
  waitlist: 'Waitlist',
  free: 'Free',
  early: 'Early',
  pro: 'Pro',
  plus: 'Pro+',
  max: 'Max',
};

/** Plans Stripe can sell, smallest pool first. */
export const UPGRADE_PLANS = ['pro', 'plus', 'max'] as const;
export type UpgradePlan = (typeof UPGRADE_PLANS)[number];

/** The subscription plans: own keys, a pool, extra usage. */
export function isPaidPlan(plan: PlanId | null): plan is UpgradePlan {
  return UPGRADE_PLANS.includes(plan as UpgradePlan);
}

/** The plan above this one among those for sale, or null at the top (or off the ladder). */
export function nextPlanUp(plan: PlanId | null, forSale: readonly UpgradePlan[]): UpgradePlan | null {
  const rank = isPaidPlan(plan) ? UPGRADE_PLANS.indexOf(plan) : -1;
  return forSale.find((candidate) => UPGRADE_PLANS.indexOf(candidate) > rank) ?? null;
}

/**
 * The hidden cost guard's period: Waitlist and Early refill at local
 * midnight, the rest last the month. The meters the user sees are daily on every plan.
 */
export function resetsDaily(plan: PlanId): boolean {
  return plan === 'waitlist' || plan === 'early';
}

/** Waitlisted accounts a code can move onto early; plans that already have a code to share. */
export const REFERRAL_FROM: readonly PlanId[] = ['waitlist'];
export const REFERRAL_GIVERS: readonly PlanId[] = ['free', 'early', ...UPGRADE_PLANS];

// --- Meters --------------------------------------------------------------------------

/** What a proxied brain call is part of; the API counts distinct turns per scope per day. */
export const TURN_SCOPES = ['talk', 'task', 'job'] as const;
export type TurnScope = (typeof TURN_SCOPES)[number];
/** The desktop sends these on every proxied brain call. */
export const TURN_HEADER = 'x-buddy-turn';
export const SCOPE_HEADER = 'x-buddy-scope';

/** Scopes a plan meters. Jobs are background and cheap; the cost guard covers them. */
export const METERED_SCOPES = { talk: 'talk', task: 'tasks' } as const satisfies Partial<Record<TurnScope, string>>;
export type MeterName = (typeof METERED_SCOPES)[keyof typeof METERED_SCOPES];

/** Used today against the day's limit; null limit means unlimited. */
export const MeterSchema = z.object({ used: z.number().int().nonnegative(), limit: z.number().int().nonnegative().nullable() });
export type Meter = z.infer<typeof MeterSchema>;

export const MetersSchema = z.object({
  talk: MeterSchema,
  tasks: MeterSchema,
  /** ISO time the day's meters refill: the user's local midnight. */
  resetsAt: z.string(),
});
export type Meters = z.infer<typeof MetersSchema>;

/** The 402 body when the day's talk or tasks are used up. */
export const LimitExceededSchema = z.object({
  error: z.literal('limit_exceeded'),
  plan: z.enum(PLAN_IDS),
  meter: z.enum(['talk', 'tasks']),
  used: z.number().int(),
  limit: z.number().int(),
  resetsAt: z.string(),
});
export type LimitExceeded = z.infer<typeof LimitExceededSchema>;

/** Buddy credit the referrer earns when someone joins with their code. */
export const REFERRAL_CREDIT_CENTS = 500;

/** GET /v1/referral/mine: this account's code to hand out, or null while waitlisted. */
export const MyReferralSchema = z.object({
  code: z.string().nullable(),
  uses: z.number().int().nonnegative(),
});

/** The header the desktop sends its IANA time zone in, so a daily allowance resets at its midnight. */
export const TIMEZONE_HEADER = 'x-buddy-timezone';

/** POST /v1/referral: a waitlist code from someone already in. */
export const ReferralSchema = z.object({ code: z.string().min(1) });
export const ReferralResultSchema = z.object({ plan: z.enum(PLAN_IDS) });

/**
 * Where each provider's passthrough lives under the API origin. The desktop
 * points the provider's own SDK (or fetch) here with the session token where
 * the key would go; the API swaps in Buddy's key and forwards.
 */
export const PROXY_PATHS = {
  openrouter: '/v1/openrouter',
  elevenlabs: '/v1/elevenlabs',
  jev: '/v1/jev',
} as const;
export type ProxiedProvider = keyof typeof PROXY_PATHS;

/** GET /v1/me: who is signed in, what they get, what they have used. */
export const MeSchema = z.object({
  userId: z.string(),
  plan: z.enum(PLAN_IDS),
  /** Model ids the proxy accepts on this plan (prefix match). */
  models: z.array(z.string()),
  period: z.object({ start: z.string(), end: z.string() }),
  /** The period's model use against the plan's pool. Shown on the paid plans; a hidden guard elsewhere. */
  usage: z.object({ spentCents: z.number().int(), budgetCents: z.number().int() }),
  /**
   * Extra usage past the pool, billed at cost at the end of the month. Off
   * until the person turns it on; null when this deployment cannot bill it.
   */
  onDemand: z.boolean().nullable(),
  meters: MetersSchema,
  /** Which of Buddy's keys this deployment holds, so the desktop knows what it can route. */
  managed: z.array(z.string()),
  /** Stripe is set up, so Upgrade and Manage billing work. */
  billing: z.boolean(),
  /** Plans Stripe has a price for, so Upgrade offers only those. */
  upgrades: z.array(z.enum(UPGRADE_PLANS)),
});
export type Me = z.infer<typeof MeSchema>;

/** The 402 body when the period's budget is spent. */
export const BudgetExceededSchema = z.object({
  error: z.literal('budget_exceeded'),
  plan: z.enum(PLAN_IDS),
  spentCents: z.number().int(),
  budgetCents: z.number().int(),
  resetsAt: z.string(),
});
export type BudgetExceeded = z.infer<typeof BudgetExceededSchema>;

/** The 402 body when a paid plan's pool is spent and extra usage is off: a yes keeps going. */
export const OnDemandRequiredSchema = BudgetExceededSchema.extend({ error: z.literal('on_demand_required') });
export type OnDemandRequired = z.infer<typeof OnDemandRequiredSchema>;

/** The 403 body when the plan does not include the requested model. */
export const ModelNotAllowedSchema = z.object({
  error: z.literal('model_not_allowed'),
  model: z.string(),
  models: z.array(z.string()),
});
export type ModelNotAllowed = z.infer<typeof ModelNotAllowedSchema>;

// --- Purchases ---------------------------------------------------------------------

/** What a purchase was for, as the model files it at the confirmation page. */
export const PURCHASE_CATEGORIES = [
  'clothing',
  'shoes',
  'beauty',
  'electronics',
  'home',
  'groceries',
  'food_delivery',
  'travel',
  'tickets',
  'subscriptions',
  'gifts',
  'other',
] as const;
export type PurchaseCategory = (typeof PURCHASE_CATEGORIES)[number];

/** Where Buddy placed the order: its own browser window, or the user's browser. */
export const PURCHASE_CHANNELS = ['buddy_browser', 'user_browser'] as const;

/** POST /v1/purchases: an order Buddy placed, as the confirmation page showed it. No item names. */
export const PurchaseSchema = z.object({
  /** The store's registrable domain ("koio.co"). */
  merchant: z.string().min(1).max(253),
  amountCents: z.number().int().nonnegative(),
  /** ISO 4217, upper case. */
  currency: z.string().regex(/^[A-Z]{3}$/),
  category: z.enum(PURCHASE_CATEGORIES),
  itemCount: z.number().int().positive(),
  channel: z.enum(PURCHASE_CHANNELS),
});
export type Purchase = z.infer<typeof PurchaseSchema>;

// --- Apps (Composio through the API) ---------------------------------------------

export const AppConnectionSchema = z.object({
  slug: z.string(),
  status: z.enum(['active', 'expired']),
});
export const AppConnectionsSchema = z.array(AppConnectionSchema);

export const AppLinkSchema = z.object({ url: z.string() });

export const AppSearchSchema = z.object({
  /** One line per tool: "SLUG — description". */
  lines: z.array(z.string()),
});

export const AppExecuteSchema = z.object({
  /** The tool's result as JSON text, clipped. */
  text: z.string(),
  error: z.string().nullable(),
});

export const AppToolSchema = z.object({ readOnly: z.boolean() });

/** A file to hand an app tool, as the desktop sends it to the API: the bytes, base64. */
export const AppAttachBodySchema = z.object({
  slug: z.string().min(1).max(120),
  args: z.record(z.string(), z.unknown()),
  files: z
    .array(z.object({ name: z.string().min(1).max(255), mediaType: z.string().min(1).max(100), base64: z.string().min(1) }))
    .min(1)
    .max(10),
});
/** The tool's arguments with the uploaded files in their place. */
export const AppAttachSchema = z.object({ args: z.record(z.string(), z.unknown()) });

/** What Composio hands back for an uploaded file, and what a file-taking tool parameter wants. */
export interface AppFileUpload {
  name: string;
  mimetype: string;
  s3key: string;
}

/** The subset of a Composio tool's input schema that says which parameters take files. */
export interface AppFileSchema {
  properties?: Record<string, { file_uploadable?: boolean; type?: string; items?: unknown }>;
}

/** A tool's toolkit: what its schema says, else the slug's prefix ("GMAIL_SEND_EMAIL" → "gmail"). */
export function toolkitOf(toolSlug: string, fromSchema?: string): string {
  return fromSchema ?? toolSlug.split('_')[0]!.toLowerCase();
}

/**
 * The arguments with the uploads placed in the tool's file parameter: a
 * list parameter takes them all, a single one takes the first. The first
 * file-taking parameter the schema names that the caller left empty wins;
 * null when the tool takes no file at all.
 */
export function placeAppFiles(
  schema: AppFileSchema | undefined,
  args: Record<string, unknown>,
  uploads: AppFileUpload[],
): Record<string, unknown> | null {
  const entries = Object.entries(schema?.properties ?? {}).filter(([, prop]) => prop.file_uploadable);
  if (entries.length === 0 || uploads.length === 0) return null;
  const [key, prop] = entries.find(([name]) => args[name] === undefined || args[name] === '') ?? entries[0]!;
  const list = prop.type === 'array' || prop.items !== undefined;
  return { ...args, [key]: list ? uploads : uploads[0] };
}

// --- Billing -----------------------------------------------------------------------

export const BillingLinkSchema = z.object({ url: z.string() });
/** POST /v1/billing/checkout: which plan to buy. Absent means Pro. */
export const CheckoutSchema = z.object({ plan: z.enum(UPGRADE_PLANS).default('pro') });
/** POST /v1/billing/on-demand: extra usage past the pool, on or off. Paid plans only. */
export const OnDemandSchema = z.object({ on: z.boolean() });
export const OnDemandResultSchema = z.object({ onDemand: z.boolean() });

/** POST /download-link: a phone visitor asks for the download on their Mac. */
export const DownloadLinkSchema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)) });
