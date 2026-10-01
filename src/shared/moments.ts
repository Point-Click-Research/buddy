// The moments Buddy notices on its own, from signals it already has: the
// calendar, the app in front, the clock, recent mail headers. Each one is a
// question the user can answer with a word, offered once, only when the
// timing is tight and the signals agree. Pure: main/jobs/moments.ts feeds
// it and the tests call it directly.

export type MomentKind = 'leave-soon' | 'running-over' | 'food-before-flight';

/** One calendar entry, as the watcher needs it. */
export interface MomentEvent {
  title: string;
  /** Epoch ms. */
  start: number;
  end: number;
  allDay: boolean;
  /** A street address or a place name; '' for a link or nothing. */
  place: string;
  /** A meeting or plan, a focus block, or out of office. */
  kind: 'plan' | 'focus' | 'away';
}

export interface MomentSignals {
  now: number;
  events: MomentEvent[];
  /** The app in front; '' when unreadable. */
  frontApp: string;
  /** The front browser tab's URL when the front app is a browser; '' otherwise. */
  frontUrl: string;
  /** Seconds since the last keyboard or mouse input. */
  idleSeconds: number;
  /** Recent inbox headers, one per line. */
  inbox: string;
}

/** A moment worth one question. */
export interface Moment {
  kind: MomentKind;
  /** The event it grew out of: the same moment is never offered twice. */
  key: string;
  /** The question. */
  title: string;
  /** The number that decides it and why now. */
  blurb: string;
  /** What a yes runs. */
  prompt: string;
  /** Epoch ms after which it has passed; an unanswered moment leaves then. */
  until: number;
}

const MINUTE = 60_000;
/** Someone touched the Mac this recently: they are here, at the screen. */
const IN_USE_SECONDS = 180;

/** Apps that are the meeting itself. */
const MEETING_APPS = new Set(['zoom.us', 'zoom', 'microsoft teams', 'facetime', 'webex']);
const MEETING_HOSTS = /(^|\.)(meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|whereby\.com)$/i;
const FLIGHT = /\bflight\b|✈/i;
/** "UA 1523", "DL204": case matters, or "to 2026" would read as a flight. */
const AIRLINE_CODE = /\b[A-Z]{2} ?\d{3,4}\b/;
const ORDERED = /\b(order|receipt|delivery|delivered|on its way)\b/i;

/** A flight on the calendar: named, or an airline code like "UA 123". */
export function isFlight(title: string): boolean {
  return FLIGHT.test(title) || AIRLINE_CODE.test(title);
}

/**
 * The moments the signals support right now, most urgent first. The caller
 * drops the keys already offered and the kinds the user has turned down.
 */
export function findMoments(signals: MomentSignals): Moment[] {
  const found: Moment[] = [];
  const timed = signals.events.filter((event) => event.kind === 'plan' && !event.allDay);
  const late = isLate(signals.now);
  for (const event of timed) {
    const leave = leaveSoon(event, signals);
    if (leave) found.push(leave);
    const over = runningOver(event, timed, signals);
    if (over) found.push(over);
  }
  // Food is never urgent: it respects a meeting in progress and the evening.
  if (!late && !isQuiet(signals.now, signals.events)) {
    for (const event of timed) {
      const food = foodBeforeFlight(event, signals);
      if (food) found.push(food);
    }
  }
  return found;
}

/** Inside a timed plan, a focus block, or out of office: no nudge unless it is urgent. */
export function isQuiet(now: number, events: MomentEvent[]): boolean {
  return events.some(
    (event) => (event.kind !== 'plan' || !event.allDay) && event.start <= now && now < event.end,
  );
}

/** The evening and the small hours. */
export function isLate(now: number): boolean {
  const hour = new Date(now).getHours();
  return hour >= 22 || hour < 7;
}

/** True when the app in front, or the page in it, is a video call. */
export function inMeeting(frontApp: string, frontUrl: string): boolean {
  if (MEETING_APPS.has(frontApp.trim().toLowerCase())) return true;
  try {
    return frontUrl !== '' && MEETING_HOSTS.test(new URL(frontUrl).hostname);
  } catch {
    return false;
  }
}

/** A plan with a place starts in 20 to 30 minutes and they are still at the Mac. */
function leaveSoon(event: MomentEvent, signals: MomentSignals): Moment | null {
  const minutes = Math.round((event.start - signals.now) / MINUTE);
  if (!event.place || minutes < 20 || minutes > 30) return null;
  if (signals.idleSeconds > IN_USE_SECONDS || inMeeting(signals.frontApp, signals.frontUrl)) return null;
  const at = clock(event.start);
  return {
    kind: 'leave-soon',
    key: `leave-soon:${event.start}:${event.title}`,
    title: `Book a car to ${event.place}?`,
    blurb: `Your ${at} is in ${minutes} min, and you're still at the Mac.`,
    prompt: `Book me a car to ${event.place} for my ${at} ${event.title}. Check the ETA first and tell me when I need to leave.`,
    until: event.start,
  };
}

/**
 * A meeting ended 5 to 10 minutes ago, the call is still in front, and
 * something else starts within the hour: the people waiting can be told.
 */
function runningOver(event: MomentEvent, timed: MomentEvent[], signals: MomentSignals): Moment | null {
  const minutes = Math.round((signals.now - event.end) / MINUTE);
  if (minutes < 5 || minutes > 10 || !inMeeting(signals.frontApp, signals.frontUrl)) return null;
  const next = timed
    .filter((other) => other.start >= event.end && other.start - signals.now <= 60 * MINUTE)
    .sort((a, b) => a.start - b.start)[0];
  if (!next) return null;
  const at = clock(event.start);
  const nextAt = clock(next.start);
  return {
    kind: 'running-over',
    key: `running-over:${event.start}:${event.title}`,
    title: `Tell the ${nextAt} you're running late?`,
    blurb: `Your ${at} is ${minutes} min over; ${next.title} is at ${nextAt}.`,
    prompt: `My ${at} ${event.title} ran over and I'm still in it. Let the people in my ${nextAt} ${next.title} know I'm running a few minutes late.`,
    until: event.end + 15 * MINUTE,
  };
}

/** A flight leaves in 2 to 4 hours, it is past late morning, and nothing was ordered. */
function foodBeforeFlight(event: MomentEvent, signals: MomentSignals): Moment | null {
  if (!isFlight(event.title)) return null;
  const minutes = (event.start - signals.now) / MINUTE;
  if (minutes < 120 || minutes > 240 || new Date(signals.now).getHours() < 11) return null;
  if (ORDERED.test(signals.inbox)) return null;
  const at = clock(event.start);
  const hours = Math.round(minutes / 60);
  return {
    kind: 'food-before-flight',
    key: `food-before-flight:${event.start}:${event.title}`,
    title: 'Want food before your flight?',
    blurb: `Your flight leaves at ${at}, about ${hours} hours from now, and nothing's ordered today.`,
    prompt: `My flight is at ${at}. Order me food to have before I leave: my usual if my dining notes name one, otherwise ask me what I want.`,
    until: event.start - 60 * MINUTE,
  };
}

/** "3pm", "3:30pm". */
export function clock(at: number): string {
  const date = new Date(at);
  const hour = date.getHours() % 12 || 12;
  const minutes = date.getMinutes();
  return `${hour}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}${date.getHours() < 12 ? 'am' : 'pm'}`;
}

// --- Backing off -------------------------------------------------------------------

/** How a kind of moment was met, over time. */
export interface MomentAnswers {
  no: number;
  ignored: number;
}

/** Nos in a row before a kind stops; passes (no answer) count sooner. */
const STOP_AFTER_NO = 3;
const STOP_AFTER_IGNORED = 2;

export function momentStopped(answers: MomentAnswers | undefined): boolean {
  return Boolean(answers && (answers.no >= STOP_AFTER_NO || answers.ignored >= STOP_AFTER_IGNORED));
}

/** A yes clears the slate; a no or a pass counts toward stopping. */
export function answered(
  answers: MomentAnswers | undefined,
  answer: 'yes' | 'no' | 'ignored',
): MomentAnswers {
  if (answer === 'yes') return { no: 0, ignored: 0 };
  const current = answers ?? { no: 0, ignored: 0 };
  return answer === 'no' ? { ...current, no: current.no + 1 } : { ...current, ignored: current.ignored + 1 };
}
