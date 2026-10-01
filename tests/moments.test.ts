import { describe, expect, it } from 'vitest';
import {
  answered,
  clock,
  findMoments,
  inMeeting,
  isQuiet,
  momentStopped,
  type MomentEvent,
  type MomentSignals,
} from '../src/shared/moments';

/** Tue Mar 10 2026, local. */
const at = (hour: number, minute = 0): number => new Date(2026, 2, 10, hour, minute).getTime();

const plan = (title: string, start: number, end: number, patch: Partial<MomentEvent> = {}): MomentEvent => ({
  title,
  start,
  end,
  allDay: false,
  place: '',
  kind: 'plan',
  ...patch,
});

/** At the Mac, in Finder, nothing in the inbox. */
const here = (now: number, events: MomentEvent[], patch: Partial<MomentSignals> = {}): MomentSignals => ({
  now,
  events,
  frontApp: 'Finder',
  frontUrl: '',
  idleSeconds: 10,
  inbox: '',
  ...patch,
});

describe('leave-soon', () => {
  const dinner = plan('Dinner with Sam', at(15), at(16), { place: 'Via Carota' });

  it('asks about a car 20 to 30 minutes before a plan with a place, while they are at the Mac', () => {
    const [moment] = findMoments(here(at(14, 40), [dinner]));
    expect(moment).toMatchObject({ kind: 'leave-soon', until: at(15) });
    // The question first, so a cut-off line still asks it; the number behind it.
    expect(moment!.title).toBe('Book a car to Via Carota?');
    expect(moment!.blurb).toBe("Your 3pm is in 20 min, and you're still at the Mac.");
    expect(moment!.prompt).toContain('Via Carota');
    // One question per event, however many ticks it spans.
    expect(findMoments(here(at(14, 30), [dinner]))[0]!.key).toBe(moment!.key);
  });

  it('stays quiet when it is too early, too late, they are away, they are on a call, or there is nowhere to go', () => {
    expect(findMoments(here(at(14, 20), [dinner]))).toEqual([]);
    expect(findMoments(here(at(14, 50), [dinner]))).toEqual([]);
    expect(findMoments(here(at(14, 40), [dinner], { idleSeconds: 600 }))).toEqual([]);
    expect(findMoments(here(at(14, 40), [dinner], { frontApp: 'zoom.us' }))).toEqual([]);
    expect(findMoments(here(at(14, 40), [plan('Standup', at(15), at(16))]))).toEqual([]);
  });

  it('is urgent: a focus block or the evening does not silence it', () => {
    const focus = plan('Heads down', at(14), at(16), { kind: 'focus' });
    expect(findMoments(here(at(14, 40), [dinner, focus]))).toHaveLength(1);
    const late = plan('Late train', at(22, 30), at(23), { place: 'Penn Station' });
    expect(findMoments(here(at(22, 5), [late]))).toHaveLength(1);
  });
});

describe('running-over', () => {
  const standup = plan('Standup', at(14), at(15));
  const next = plan('Design review', at(15, 30), at(16));

  it('offers to warn the next meeting when the call is still up 5 to 10 minutes past the end', () => {
    const [moment] = findMoments(here(at(15, 6), [standup, next], { frontApp: 'zoom.us' }));
    expect(moment).toMatchObject({ kind: 'running-over', until: at(15, 15) });
    expect(moment!.title).toBe("Tell the 3:30pm you're running late?");
    expect(moment!.blurb).toBe('Your 2pm is 6 min over; Design review is at 3:30pm.');
    // A Meet tab counts as the call too.
    expect(
      findMoments(here(at(15, 6), [standup, next], { frontApp: 'Google Chrome', frontUrl: 'https://meet.google.com/abc' })),
    ).toHaveLength(1);
  });

  it('needs the call in front and something next to warn', () => {
    expect(findMoments(here(at(15, 6), [standup, next]))).toEqual([]);
    expect(findMoments(here(at(15, 6), [standup], { frontApp: 'zoom.us' }))).toEqual([]);
    expect(findMoments(here(at(15, 2), [standup, next], { frontApp: 'zoom.us' }))).toEqual([]);
  });
});

describe('food-before-flight', () => {
  const flight = plan('Flight to SFO', at(18), at(21));

  it('asks 2 to 4 hours out, in the afternoon, when nothing was ordered', () => {
    const [moment] = findMoments(here(at(14, 30), [flight]));
    expect(moment).toMatchObject({ kind: 'food-before-flight', until: at(17) });
    expect(moment!.title).toBe('Want food before your flight?');
    expect(moment!.blurb).toBe("Your flight leaves at 6pm, about 4 hours from now, and nothing's ordered today.");
    expect(findMoments(here(at(15), [plan('UA 1523', at(18), at(21))]))).toHaveLength(1);
  });

  it('stays quiet once food is on its way, inside a meeting, at night, or too far out', () => {
    expect(findMoments(here(at(14, 30), [flight], { inbox: '- unread · Sweetgreen · Your order is confirmed' }))).toEqual([]);
    expect(findMoments(here(at(14, 30), [flight, plan('Standup', at(14), at(15))]))).toEqual([]);
    expect(findMoments(here(at(23), [plan('Flight to LHR', at(25), at(30))]))).toEqual([]);
    expect(findMoments(here(at(12), [flight]))).toEqual([]);
  });
});

describe('quiet and calls', () => {
  it('a timed plan, a focus block, or a day away in progress is quiet; an all-day plan is not', () => {
    expect(isQuiet(at(14, 30), [plan('Standup', at(14), at(15))])).toBe(true);
    expect(isQuiet(at(14, 30), [plan('Heads down', at(14), at(15), { kind: 'focus' })])).toBe(true);
    expect(isQuiet(at(14, 30), [plan('PTO', at(0), at(24), { kind: 'away', allDay: true })])).toBe(true);
    expect(isQuiet(at(14, 30), [plan('Halloween', at(0), at(24), { allDay: true })])).toBe(false);
    expect(isQuiet(at(15, 30), [plan('Standup', at(14), at(15))])).toBe(false);
  });

  it('recognizes the call by app or by tab', () => {
    expect(inMeeting('Microsoft Teams', '')).toBe(true);
    expect(inMeeting('Safari', 'https://us02web.zoom.us/j/1')).toBe(true);
    expect(inMeeting('Safari', 'https://example.com/zoom.us')).toBe(false);
    expect(inMeeting('Finder', 'not a url')).toBe(false);
  });

  it('writes the clock the way people say it', () => {
    expect(clock(at(15))).toBe('3pm');
    expect(clock(at(9, 5))).toBe('9:05am');
    expect(clock(at(0))).toBe('12am');
  });
});

describe('backing off', () => {
  it('stops a kind after three nos or two passes, and a yes clears the slate', () => {
    let answers = answered(undefined, 'no');
    answers = answered(answers, 'no');
    expect(momentStopped(answers)).toBe(false);
    expect(momentStopped(answered(answers, 'no'))).toBe(true);
    expect(momentStopped(answered(answered(undefined, 'ignored'), 'ignored'))).toBe(true);
    expect(momentStopped(answered(answers, 'yes'))).toBe(false);
    expect(momentStopped(undefined)).toBe(false);
  });
});
