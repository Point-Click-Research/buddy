// The jobs store: saved jobs, writes their runs parked for approval, and the
// current Ideas batch. Persistence only — the clock lives in scheduler.ts,
// the runs in run.ts.

import { randomUUID } from 'crypto';
import Store from 'electron-store';
import {
  DEFAULT_JOB,
  JOB_TEMPLATES,
  isJobScheduleId,
  nextRun,
  type Idea,
  type IdeasView,
  type Job,
  type PastIdea,
  type JobApproval,
  type JobDraft,
  type JobsView,
} from '../../shared/jobs';
import { answered, type MomentAnswers, type MomentKind } from '../../shared/moments';
import { pickRandomHour } from '../../shared/suggestions';
import { USE_CASES } from '../../shared/use-cases';

interface JobsStoreShape {
  jobs: Job[];
  approvals: JobApproval[];
  ideas: Idea[];
  /** Epoch ms of the last Ideas run; 0 = never. */
  ideasCheckedAt: number;
  /** Titles (and product pages) of suggestions already shown, newest last. */
  pastIdeas: PastIdea[];
  /** The default job was added. Once per install, so deleting it sticks. */
  seeded: boolean;
  /** How each kind of moment has been met, so a kind that keeps getting a no stops. Absent in older files. */
  momentAnswers?: Partial<Record<MomentKind, MomentAnswers>>;
  /** Moments already offered, by event key, so a relaunch never asks twice. Absent in older files. */
  momentsOffered?: string[];
  /** The hour "once a day, at random" picked for this day, so it is rolled once. */
  randomHour?: { day: string; hour: number };
}

/** Offered keys kept; a day holds a handful of moments at most. */
const MOMENTS_OFFERED = 50;

/** How many past suggestions a later run is held to. Two to three months of mornings. */
const PAST_IDEAS = 240;

const EMPTY: JobsStoreShape = { jobs: [], approvals: [], ideas: [], ideasCheckedAt: 0, pastIdeas: [], seeded: false };

interface JobsFile extends JobsStoreShape {
  /** Per account. The top-level fields are the pre-account file, until claimed or parked. */
  byUser: Record<string, JobsStoreShape>;
  parked: JobsStoreShape | null;
}

const file = new Store<JobsFile>({
  name: 'jobs',
  defaults: { ...EMPTY, byUser: {}, parked: null },
});

/** Account ids that already have jobs on this Mac. */
export function jobAccountIds(): string[] {
  return Object.keys(file.get('byUser') ?? {});
}

/** Jobs set aside for an account this Mac no longer has signed in. */
export function hasParkedJobs(): boolean {
  return file.get('parked') !== null;
}

/** Whose jobs and suggestions are live. Null shows nothing (signed out). */
let ownerId: string | null = null;
let ideasRunning = false;

function current(): JobsStoreShape {
  if (!ownerId) return EMPTY;
  return file.get('byUser')?.[ownerId] ?? EMPTY;
}

/** The slice the rest of this file reads and writes. */
const store = {
  get<K extends keyof JobsStoreShape>(key: K): JobsStoreShape[K] {
    return current()[key];
  },
  set<K extends keyof JobsStoreShape>(key: K, value: JobsStoreShape[K]): void {
    if (!ownerId) return;
    file.set('byUser', { ...(file.get('byUser') ?? {}), [ownerId]: { ...current(), [key]: value } });
  },
};

function legacyShape(): JobsStoreShape {
  return {
    jobs: file.get('jobs'),
    approvals: file.get('approvals'),
    ideas: file.get('ideas'),
    ideasCheckedAt: file.get('ideasCheckedAt'),
    pastIdeas: file.get('pastIdeas'),
    seeded: file.get('seeded'),
  };
}

function legacyHasRows(shape: JobsStoreShape): boolean {
  return shape.jobs.length > 0 || shape.approvals.length > 0 || shape.ideas.length > 0 || shape.pastIdeas.length > 0;
}

function clearLegacy(): void {
  file.set('jobs', []);
  file.set('approvals', []);
  file.set('ideas', []);
  file.set('ideasCheckedAt', 0);
  file.set('pastIdeas', []);
  file.set('seeded', false);
}

/** When the unscoped suggestions last ran, or null when that file has nothing to time. */
export function legacyJobsOldest(): number | null {
  const shape = legacyShape();
  if (!legacyHasRows(shape) || shape.ideasCheckedAt <= 0) return null;
  return shape.ideasCheckedAt;
}

/** Keep the unscoped jobs and suggestions out of every account's list. */
export function parkLegacyJobs(): void {
  const legacy = legacyShape();
  if (!legacyHasRows(legacy)) return;
  file.set('parked', { ...legacy, jobs: legacy.jobs.map((job) => ({ ...job, running: false })) });
  clearLegacy();
}

/** The unscoped jobs and suggestions are this account's. */
export function claimLegacyJobs(userId: string): void {
  const legacy = legacyShape();
  if (!legacyHasRows(legacy)) return;
  const byUser = { ...(file.get('byUser') ?? {}) };
  if (!byUser[userId]) byUser[userId] = legacy;
  file.set('byUser', byUser);
  clearLegacy();
}

/** Show this account's jobs and suggestions. A first look gets the default job. */
export function setJobsOwner(id: string | null): void {
  if (ownerId === id) return;
  ownerId = id;
  ideasRunning = false;
  if (id) seedDefaultJob();
  jobsChanged();
  ideasListener?.(getIdeasView());
}

let jobsListener: ((view: JobsView) => void) | null = null;
let ideasListener: ((view: IdeasView) => void) | null = null;

/** One listener each is enough: ipc.ts broadcasts to every window. */
export function onJobsChanged(cb: (view: JobsView) => void): void {
  jobsListener = cb;
}

export function onIdeasChanged(cb: (view: IdeasView) => void): void {
  ideasListener = cb;
}

function jobsChanged(): void {
  jobsListener?.(getJobsView());
}

export function getJobsView(): JobsView {
  return { jobs: listJobs(), approvals: store.get('approvals') };
}

export function listJobs(): Job[] {
  return store.get('jobs');
}

/** Add (no id) or update (with id) a job, from the form or an accepted idea. */
export function saveJob(draft: JobDraft): Job {
  const jobs = listJobs();
  const existing = jobs.find((job) => job.id === draft.id);
  const schedule = isJobScheduleId(draft.schedule) ? draft.schedule : 'daily-9';
  const job: Job = {
    id: existing?.id ?? randomUUID(),
    name: draft.name.trim() || 'Background job',
    prompt: draft.prompt.trim(),
    schedule,
    paused: existing?.paused ?? false,
    conversationId: existing?.conversationId ?? '',
    // A new or rescheduled job waits a full slot rather than firing at once;
    // Run now covers "right away".
    nextRunAt:
      existing && existing.schedule === schedule
        ? existing.nextRunAt
        : nextRun(schedule, new Date()),
    lastRunAt: existing?.lastRunAt ?? 0,
    lastReport: existing?.lastReport ?? '',
    memory: existing?.memory ?? '',
  };
  store.set(
    'jobs',
    existing ? jobs.map((entry) => (entry.id === job.id ? job : entry)) : [...jobs, job],
  );
  jobsChanged();
  return job;
}

/** First launch: the morning brief, so Jobs never opens empty. */
export function seedDefaultJob(): void {
  if (store.get('seeded')) return;
  store.set('seeded', true);
  const brief = JOB_TEMPLATES.find((template) => template.id === DEFAULT_JOB);
  if (!brief || listJobs().some((job) => job.name === brief.label)) return;
  saveJob({ name: brief.label, prompt: brief.prompt, schedule: brief.schedule });
}

export function deleteJob(id: string): void {
  const job = listJobs().find((entry) => entry.id === id);
  store.set('jobs', listJobs().filter((entry) => entry.id !== id));
  // Its parked approvals die with it; they would land in a deleted thread.
  if (job?.conversationId) {
    store.set(
      'approvals',
      store.get('approvals').filter((approval) => approval.conversationId !== job.conversationId),
    );
  }
  jobsChanged();
}

export function setJobPaused(id: string, paused: boolean): void {
  patchJob(id, { paused });
}

/** Merge runtime fields (nextRunAt, memory, lastReport…) into a stored job. */
export function patchJob(id: string, patch: Partial<Job>): void {
  const jobs = listJobs();
  const job = jobs.find((entry) => entry.id === id);
  if (!job) return;
  store.set('jobs', jobs.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  jobsChanged();
}

// --- Parked approvals -----------------------------------------------------------

export function addApproval(approval: Omit<JobApproval, 'id' | 'at'>): void {
  store.set('approvals', [
    ...store.get('approvals'),
    { ...approval, id: randomUUID(), at: Date.now() },
  ]);
  jobsChanged();
}

/** Remove and return one approval — resolving it consumes it. */
export function takeApproval(id: string): JobApproval | null {
  const approvals = store.get('approvals');
  const found = approvals.find((approval) => approval.id === id) ?? null;
  if (found) {
    store.set('approvals', approvals.filter((approval) => approval.id !== id));
    jobsChanged();
  }
  return found;
}

// --- Ideas ------------------------------------------------------------------------

export function getIdeasView(): IdeasView {
  // A batch saved before a pillar was retired may still file under it.
  const ideas = store.get('ideas').filter((idea) => USE_CASES.some((page) => page.id === idea.kind));
  return { ideas, checkedAt: store.get('ideasCheckedAt'), running: ideasRunning };
}

/** The run's start and end, so every window's Check now button shows the same state. */
export function setIdeasRunning(running: boolean): void {
  ideasRunning = running;
  ideasListener?.(getIdeasView());
}

/** Today's random slot, picked the first time the day is considered and kept. */
export function randomSlotHour(now: Date): number {
  const day = now.toDateString();
  const saved = store.get('randomHour');
  if (saved?.day === day) return saved.hour;
  const hour = pickRandomHour();
  store.set('randomHour', { day, hour });
  return hour;
}

/** A fresh batch replaces whatever was still unanswered; an open moment stays. */
export function setIdeas(ideas: Idea[]): void {
  store.set('ideas', [...store.get('ideas').filter((idea) => idea.moment), ...ideas]);
  store.set('ideasCheckedAt', Date.now());
  ideasListener?.(getIdeasView());
}

/** One idea on top of the deck, outside the morning batch: a moment Buddy noticed. */
export function addIdea(idea: Idea): void {
  store.set('ideas', [idea, ...store.get('ideas')]);
  ideasListener?.(getIdeasView());
}

export function momentAnswers(kind: MomentKind): MomentAnswers | undefined {
  return store.get('momentAnswers')?.[kind];
}

export function momentOffered(key: string): boolean {
  return store.get('momentsOffered')?.includes(key) ?? false;
}

export function rememberMomentOffered(key: string): void {
  store.set('momentsOffered', [...(store.get('momentsOffered') ?? []), key].slice(-MOMENTS_OFFERED));
}

/** Count how a moment of this kind was met. */
export function recordMomentAnswer(kind: MomentKind, answer: 'yes' | 'no' | 'ignored'): void {
  store.set('momentAnswers', { ...store.get('momentAnswers'), [kind]: answered(momentAnswers(kind), answer) });
}

/** Suggestions already shown, so a new run can be required to differ. */
export function pastIdeas(): PastIdea[] {
  return store.get('pastIdeas');
}

/** Remember suggestions that were shown. Exact copies are stored once. */
export function rememberIdeas(ideas: PastIdea[]): void {
  const next = [...store.get('pastIdeas')];
  for (const idea of ideas) {
    const title = idea.title.trim();
    if (!title || next.some((past) => past.title === title)) continue;
    next.push({ ...idea, title });
  }
  store.set('pastIdeas', next.slice(-PAST_IDEAS));
}

/** Remove one idea (dismissed, run, or installed) and return it. */
export function removeIdea(id: string): Idea | null {
  const ideas = store.get('ideas');
  const found = ideas.find((idea) => idea.id === id) ?? null;
  if (found) {
    store.set('ideas', ideas.filter((idea) => idea.id !== id));
    ideasListener?.(getIdeasView());
  }
  return found;
}
