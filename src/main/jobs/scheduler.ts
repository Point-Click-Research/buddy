// The clock for background jobs: one tick a minute runs whatever is due,
// and waking from sleep catches up. An overdue job runs once — its next slot
// is computed from now, before the run — never a burst of make-up runs. A
// run that fails (often the Mac falling asleep mid-request) tries again
// shortly instead of waiting a whole slot, and nothing starts while asleep.
// Jobs run a few at a time; one whose instructions name a Mac tool
// (terminal, tabs, Messages…) shares the user's Mac, so it waits for an idle
// moment and runs alone.

import { powerMonitor } from 'electron';
import { nextRun, retryAt, usesThisMac, type Job } from '../../shared/jobs';
import { isAgentActive } from '../agent/agent';
import { isQuestionPending } from '../agent/control-tools';
import { isConfirmationPending } from '../mcp/confirm';
import { getSettings } from '../settings';
import { getState } from '../state';
import { signInRequired } from '../account/credentials';
import { bridgeOn } from '../texts/send';
import { maybeRunIdeas } from './ideas';
import { maybeOfferMoment } from './moments';
import { runJob } from './run';
import { listJobs, patchJob, seedDefaultJob } from './store';

const TICK_MS = 60_000;
/** How many API-only jobs may run at once. */
const PARALLEL_LIMIT = 3;

const running = new Set<string>();
/** Failures in a row per job, since its last good run. */
const failures = new Map<string, number>();
let localBusy = false;
let locked = false;
/** Between the Mac saying it is going to sleep and waking again. */
let asleep = false;

/** Start the tick. Call once at app launch, after MCP starts. */
export function startJobs(): void {
  // A run that a quit interrupted must not read as still going forever.
  for (const job of listJobs()) {
    if (job.running) patchJob(job.id, { running: false });
  }
  seedDefaultJob();
  powerMonitor.on('lock-screen', () => {
    locked = true;
  });
  powerMonitor.on('unlock-screen', () => {
    locked = false;
  });
  powerMonitor.on('suspend', () => {
    asleep = true;
  });
  powerMonitor.on('resume', () => {
    asleep = false;
    tick();
  });
  setInterval(tick, TICK_MS);
  tick();
}

function tick(): void {
  // A locked screen means nobody to notify, unless the text bridge reaches
  // their phone; airplane mode means no brain.
  // Suggestions and jobs read Mail and the browsers. That asks macOS for
  // control of those apps, so it waits until the walk is finished.
  if (asleep || (locked && !bridgeOn()) || getSettings().airplaneMode || signInRequired() || !getSettings().onboardingDone) return;
  // The suggestions batch: the tick of its slot, or the first tick after
  // Buddy launched (or woke) past it. And the one question the moment
  // calls for, when today's calendar says so.
  void maybeRunIdeas();
  void maybeOfferMoment();
  const now = Date.now();
  for (const job of listJobs()) {
    if (job.paused || running.has(job.id) || job.nextRunAt > now) continue;
    start(job);
  }
}

/** Run one job now, if this moment allows it. A pass leaves it due for the next tick. */
function start(job: Job): void {
  const local = usesThisMac(job.prompt);
  if (local && (localBusy || !userIdle())) return;
  if (!local && running.size >= PARALLEL_LIMIT) return;
  running.add(job.id);
  if (local) localBusy = true;
  patchJob(job.id, {
    nextRunAt: nextRun(job.schedule, new Date()),
    lastRunAt: Date.now(),
    running: true,
  });
  void runJob(job)
    .catch(() => false)
    .then((ok) => {
      running.delete(job.id);
      if (local) localBusy = false;
      const failed = ok ? 0 : (failures.get(job.id) ?? 0) + 1;
      if (failed) failures.set(job.id, failed);
      else failures.delete(job.id);
      patchJob(job.id, {
        running: false,
        ...(failed ? { nextRunAt: retryAt(job.schedule, new Date(), failed) } : {}),
      });
    });
}

/** The Run now button: same guards, just not waiting for the schedule. */
export function runJobNow(id: string): void {
  const job = listJobs().find((entry) => entry.id === id);
  if (job && !running.has(job.id)) start(job);
}

/** Nothing foreground is using the session, the agent, or a card. */
function userIdle(): boolean {
  return (
    getState() === 'idle' && !isAgentActive() && !isConfirmationPending() && !isQuestionPending()
  );
}
