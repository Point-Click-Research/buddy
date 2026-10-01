// One timely question, from what Buddy already sees: today's calendar, the
// app in front, the clock, recent mail headers. Checked on the scheduler's
// tick with no model call; the calendar is refreshed every so often. A
// moment lands on top of the deck as an idea (one overlay line, and a text
// with the bridge on), is offered once (remembered across relaunches), and
// leaves when answered or passed. How each kind is met is remembered too,
// so a kind that keeps getting a no stops.

import { powerMonitor } from 'electron';
import { ideaMessage, type Idea } from '../../shared/jobs';
import {
  findMoments,
  isFlight,
  momentStopped,
  type MomentEvent,
  type MomentKind,
  type MomentSignals,
} from '../../shared/moments';
import { calendarToday, gmailHeaders } from '../composio/apps';
import { createLogger } from '../log';
import { frontmostApp, frontmostBrowserUrl } from '../reader/frontmost';
import { getSettings } from '../settings';
import { approvalReply } from '../texts/parse';
import { bridgeOn, textMe } from '../texts/send';
import { talkOnly } from '../account/plan-gate';
import { errorMessage } from '../../shared/errors';
import {
  addIdea,
  getIdeasView,
  momentAnswers,
  momentOffered,
  recordMomentAnswer,
  rememberMomentOffered,
  removeIdea,
} from './store';

const log = createLogger('moments');

const MINUTE = 60_000;
const CALENDAR_REFRESH_MS = 10 * MINUTE;
const INBOX_HEADERS = 40;
/** The front app is read only when a plan is this close: an AppleScript call a minute is otherwise waste. */
const NEAR_MS = 30 * MINUTE;

/** What a yes does, for the deck's icon and button. */
const IDEA_KIND: Record<MomentKind, Idea['kind']> = {
  'leave-soon': 'book',
  'running-over': 'text',
  'food-before-flight': 'purchase',
};

let events: MomentEvent[] = [];
let inbox = '';
let refreshedAt = 0;
/** The open moment that went out as a text, so the next word from the phone can answer it. */
let texted: string | null = null;
let checking = false;

/** The scheduler's tick: expire an open moment, or offer one when the signals agree. */
export async function maybeOfferMoment(now = Date.now()): Promise<void> {
  if (!getSettings().ideasEnabled || checking || talkOnly()) return;
  const open = openMoment();
  if (open) {
    if (open.moment!.until <= now) answerIdea(open.id, 'ignored');
    return;
  }
  checking = true;
  try {
    await refreshSignals(now);
    const moment = findMoments(await signals(now)).find(
      (candidate) => !momentOffered(candidate.key) && !momentStopped(momentAnswers(candidate.kind)),
    );
    if (!moment) return;
    rememberMomentOffered(moment.key);
    const idea: Idea = {
      id: moment.key,
      kind: IDEA_KIND[moment.kind],
      title: moment.title,
      blurb: moment.blurb,
      prompt: moment.prompt,
      moment: { kind: moment.kind, until: moment.until },
    };
    addIdea(idea);
    if (bridgeOn()) {
      texted = idea.id;
      await textMe(ideaMessage(idea));
    }
    log.info(`offered ${moment.kind}: ${moment.title}`);
  } catch (error) {
    log.warn(`moment check failed: ${errorMessage(error)}`);
  } finally {
    checking = false;
  }
}

/** Take an idea off the deck, and when it was a moment, remember how it was met. */
export function answerIdea(id: string, answer: 'yes' | 'no' | 'ignored'): void {
  const idea = removeIdea(id);
  if (idea?.moment) recordMomentAnswer(idea.moment.kind, answer);
  if (texted === id) texted = null;
}

/**
 * A text from the phone while a moment is out there: a yes hands back what
 * to run, a no closes it, anything else is the user's own ask and the
 * moment stays open on the deck.
 */
export function takeMomentReply(text: string): { prompt: string } | 'no' | null {
  const open = openMoment();
  if (!open || texted !== open.id) return null;
  const decision = approvalReply(text);
  if (!decision) return null;
  answerIdea(open.id, decision === 'deny' ? 'no' : 'yes');
  return decision === 'deny' ? 'no' : { prompt: open.prompt };
}

function openMoment(): Idea | undefined {
  return getIdeasView().ideas.find((idea) => idea.moment);
}

/** Today's calendar, and the inbox when a flight is on it, every so often. */
async function refreshSignals(now: number): Promise<void> {
  if (now - refreshedAt < CALENDAR_REFRESH_MS) return;
  refreshedAt = now;
  events = await calendarToday();
  inbox = events.some((event) => isFlight(event.title)) ? await gmailHeaders(INBOX_HEADERS) : '';
}

async function signals(now: number): Promise<MomentSignals> {
  const near = events.some(
    (event) => !event.allDay && event.kind === 'plan' && Math.abs(event.start - now) <= NEAR_MS,
  );
  const front = near ? await frontmostApp().catch(() => null) : null;
  const frontUrl = front ? await frontmostBrowserUrl(front).catch(() => null) : null;
  return {
    now,
    events,
    frontApp: front?.name ?? '',
    frontUrl: frontUrl ?? '',
    idleSeconds: powerMonitor.getSystemIdleTime(),
    inbox,
  };
}
