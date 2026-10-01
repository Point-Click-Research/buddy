// The jobs, by voice or text. create_job saves one the user described ("make
// a job that reorders paper towels every month"), after a card they approve:
// a job acts later with nobody watching.
//
// run_job runs a saved one because the user asked ("run my paper towels
// job"). With nobody at the screen it starts as a background run and reports
// the way a scheduled one does. In a live turn the job's instructions come
// back for the model to carry out right there, with everything the
// foreground has: a purchase can check out in Buddy's browser, which no
// background run can.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { type ToolOutcome, type ToolRegistry, toolArgs } from '../ai/tools';
import { instructionsForModel } from '../../shared/instructions';
import {
  JOB_CADENCES,
  JOB_INTERVALS,
  clockSchedule,
  clockScheduleId,
  isJobScheduleId,
  matchJob,
  parseClockTime,
  scheduleLabel,
  type JobCadence,
  type JobScheduleId,
} from '../../shared/jobs';
import { requestConfirmation } from '../mcp/confirm';
import { runJobNow } from './scheduler';
import { listJobs, patchJob, saveJob } from './store';

const CREATE_JOB: Tool = {
  name: 'create_job',
  description:
    'Save a background job the user asked for: something to check or do on a schedule ("every morning", "every week"), ' +
    'or on their word ("a job I can run to reorder paper towels"). The user approves a card before it is saved. ' +
    'Write the instructions to your future self the way they would ask it, with every specific they gave (product, URL, price, person, number).',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short, what they would call it ("Paper towels").' },
      instructions: { type: 'string', description: 'What to check or do each run, in plain words.' },
      schedule: {
        type: 'string',
        enum: [...JOB_INTERVALS.map((interval) => interval.id), ...JOB_CADENCES.map((cadence) => cadence.id)],
        description:
          'How often. on-demand when they will say "run <name>" themselves; daily, weekdays, weekly, or monthly run at `time`.',
      },
      time: {
        type: 'string',
        description:
          'For daily, weekdays, weekly, and monthly: the time of day they asked for, exactly, as 24-hour HH:MM ("10:00", "18:30"). Never round it. 09:00 when they named no time.',
      },
      day: {
        type: 'integer',
        description: 'For weekly: the weekday, 0 (Sunday) to 6. For monthly: the date, 1 to 28. Monday or the 1st when they named none.',
      },
    },
    required: ['name', 'instructions', 'schedule'],
  },
};

/**
 * The schedule id from the tool's pieces: an interval as given, or a cadence
 * at the time (and day) they said. An error sentence when a piece is malformed.
 */
function scheduleFrom(args: Record<string, unknown>): JobScheduleId | { error: string } {
  const schedule = args['schedule'];
  if (JOB_INTERVALS.some((interval) => interval.id === schedule)) return schedule as JobScheduleId;
  if (!JOB_CADENCES.some((cadence) => cadence.id === schedule)) {
    return { error: 'schedule must be one of the listed values.' };
  }
  const time = typeof args['time'] === 'string' && args['time'].trim() ? parseClockTime(args['time']) : { hour: 9, minute: 0 };
  if (!time) return { error: 'time must be 24-hour HH:MM, like "10:00" or "18:30".' };
  const day = typeof args['day'] === 'number' && Number.isInteger(args['day']) ? args['day'] : undefined;
  const id = clockScheduleId(clockSchedule(schedule as JobCadence, { ...time, day }));
  return isJobScheduleId(id) ? id : { error: 'day must be a weekday 0-6 for weekly, or a date 1-28 for monthly.' };
}

const RUN_JOB: Tool = {
  name: 'run_job',
  description:
    'Run one of the user\'s saved jobs (Settings → Jobs) because they asked for it: "run my paper towels job", ' +
    '"reorder toilet paper", "do the morning brief now". Pass the words they used; matching is loose. ' +
    'The result is either that it started in the background, or the job\'s instructions for you to do right now.',
  input_schema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'The job, as the user named it.' } },
    required: ['name'],
  },
};

export function addJobTools(registry: ToolRegistry, options: { headless: boolean }): void {
  registry.set('create_job', {
    definition: CREATE_JOB,
    waitsForUser: true,
    execute: (input, signal) => createJob(input, signal),
  });
  registry.set('run_job', {
    definition: RUN_JOB,
    execute: (input) => Promise.resolve(runJob(input, options.headless)),
  });
}

function runJob(input: unknown, headless: boolean): ToolOutcome {
  const args = toolArgs(input);
  const spoken = typeof args['name'] === 'string' ? args['name'].trim() : '';
  const jobs = listJobs();
  if (jobs.length === 0) {
    return { content: 'The user has no saved jobs. They can ask you to make one, or add it under Settings → Jobs.', isError: true };
  }
  const job = matchJob(spoken, jobs);
  if (!job) {
    const names = jobs.map((entry) => `"${entry.name}"`).join(', ');
    return { content: `No saved job clearly matches "${spoken}". The saved jobs are: ${names}. Ask which they meant.`, isError: true };
  }
  if (headless) {
    if (job.running) return { content: `"${job.name}" is already running; its report is on the way.` };
    runJobNow(job.id);
    return { content: `Started "${job.name}" in the background. Its report will reach the user when it is done; nothing more to do here.` };
  }
  patchJob(job.id, { lastRunAt: Date.now(), lastReport: 'Ran in chat.' });
  return {
    content:
      `The job "${job.name}" is yours to do now, in this turn, with everything you have here (a purchase is a proposed task in Buddy's browser). Its instructions:\n${instructionsForModel(job.prompt)}` +
      (job.memory ? `\nIts note from the last run: ${job.memory}` : ''),
  };
}

async function createJob(input: unknown, signal: AbortSignal): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const text = (key: string): string => (typeof args[key] === 'string' ? (args[key] as string).trim() : '');
  const name = text('name');
  const instructions = text('instructions');
  if (!name || !instructions) {
    return { content: 'create_job needs a name, instructions, and a schedule.', isError: true };
  }
  const schedule = scheduleFrom(args);
  if (typeof schedule !== 'string') return { content: `create_job: ${schedule.error}`, isError: true };
  const approved = await requestConfirmation(
    { title: `Create the job “${name}”?`, detail: `${scheduleLabel(schedule)}\n${instructions}` },
    signal,
  );
  if (!approved) return { content: 'The user declined; no job was saved.' };
  const job = saveJob({ name, prompt: instructions, schedule });
  const when = job.schedule === 'on-demand' ? `It runs when they say "run ${job.name}".` : `It runs ${scheduleLabel(job.schedule).toLowerCase()}.`;
  return { content: `Saved the job "${job.name}" under Settings → Jobs. ${when}` };
}
