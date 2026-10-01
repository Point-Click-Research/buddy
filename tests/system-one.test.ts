// System One driving the steps: an operation and a target between frontier
// turns, in one Jev request. These pin what it may offer (never a payment or
// a send; the plan's own words for typing; a scroll only toward controls out
// of view), how targets are ranked and capped, when it hands the turn back
// (thin trees, any doubt, done or blocked, a step that changed nothing), that
// a pass hands the model a fresh read, and the shape of the calls the loop
// executes.

import { describe, expect, it } from 'vitest';
import type { Jev, JevAsk, JevChoice } from '../src/main/ai/jev';
import type { RefRow } from '../src/main/computer/tree';
import {
  actionBlock,
  actionSpace,
  decideFastStep,
  fastStep,
  handoffBlock,
  quotedText,
  recentActions,
  words,
} from '../src/main/agent/system-one';
import type { ComputerProvider } from '../src/main/computer/provider';

function row(ref: string, role: string, name: string, extra: Partial<RefRow> = {}): RefRow {
  return {
    ref,
    index: Number(ref.slice(1)),
    token: 't',
    role,
    name,
    value: '',
    enabled: true,
    selected: false,
    bounds: null,
    textBounds: null,
    depth: 1,
    actions: [],
    ...extra,
  };
}

const SPOTIFY: RefRow[] = [
  row('e1', 'statictext', 'Spotify'),
  row('e2', 'link', 'Home'),
  row('e3', 'searchfield', 'What do you want to play?'),
  row('e4', 'button', 'Play'),
  row('e5', 'button', 'Buy Premium'),
  row('e6', 'row', 'This Must Be the Place (Naive Melody) · Talking Heads', { actions: ['AXPress'] }),
  row('e7', 'button', 'Filters', { enabled: false }),
  row('e8', 'link', 'Your Library'),
];

const PLAN = {
  goal: 'Play “This Must Be the Place (Naive Melody)” by Talking Heads in Spotify',
  steps: ['Open Spotify', 'Search for "This Must Be the Place Talking Heads"', 'Click the song in the results', 'Press Play'],
};

/** A Jev answering by question name, and recording what it was asked. */
function jevAnswering(answers: Record<string, JevChoice | null>, asked: Record<string, JevAsk>[] = []): Jev {
  return {
    async choices(_state, asks) {
      asked.push(asks as Record<string, JevAsk>);
      return Object.fromEntries(Object.keys(asks).map((name) => [name, answers[name] ?? null])) as Awaited<
        ReturnType<Jev['choices']>
      >;
    },
    judge: async () => null,
  };
}

const sure = (choice: string): JevChoice => ({ choice, confidence: 0.93 });
const ids = (list: { id: string }[]): string[] => list.map((c) => c.id);

describe('words', () => {
  it('keeps times and counts, which is how a slot or a party size is named', () => {
    expect([...words('Book the 5:00 PM table for 2')]).toEqual(['book', '5:00', 'table', '2']);
  });
});

describe('quotedText', () => {
  it('finds the plan\'s quoted words, straight or curly, once each', () => {
    expect(quotedText(PLAN)).toEqual(['This Must Be the Place (Naive Melody)', 'This Must Be the Place Talking Heads']);
  });
});

describe('actionSpace', () => {
  it('offers the plan\'s text typed into each field, and the clickable rows ranked by the plan\'s words', () => {
    const space = actionSpace(PLAN, SPOTIFY);
    expect(ids(space.types)).toEqual(['type:e3:0', 'type:e3:1']);
    // The song row and Play share words with the plan; Home and Library rank after them.
    expect(ids(space.clicks).slice(0, 2)).toEqual(['click:e6', 'click:e4']);
    expect(ids(space.clicks)).toContain('click:e2');
    expect(ids(space.clicks)).toContain('click:e8');
    expect(space.scrolls).toEqual([]);
  });

  it('ranks a time slot by its digits', () => {
    const resy = [row('e1', 'button', '4:30 PM Dining Room'), row('e2', 'button', '5:00 PM Dining Room'), row('e3', 'button', 'Notify me')];
    const plan = { goal: 'Book Stafili at 5:00 PM for two', steps: ['Click the 5:00 PM slot'] };
    expect(ids(actionSpace(plan, resy).clicks)[0]).toBe('click:e2');
  });

  it('never offers a disabled control, plain text, or anything that spends', () => {
    const clicks = ids(actionSpace(PLAN, SPOTIFY).clicks);
    expect(clicks).not.toContain('click:e1');
    expect(clicks).not.toContain('click:e5');
    expect(clicks).not.toContain('click:e7');
  });

  it('caps the click targets so one Choice reads them', () => {
    const many = Array.from({ length: 80 }, (_, i) => row(`e${i + 10}`, 'link', `Link ${i}`));
    expect(actionSpace(PLAN, many).clicks.length).toBeLessThanOrEqual(32);
  });

  it('offers a scroll toward controls out of view instead of a click on them', () => {
    const view = { x: 0, y: 0, w: 800, h: 600 };
    const rows = [
      row('e0', 'window', 'Page', { bounds: view }),
      row('e1', 'button', 'Play', { bounds: { x: 10, y: 10, w: 80, h: 30 } }),
      row('e2', 'button', 'Play', { bounds: { x: 10, y: 900, w: 80, h: 30 } }),
    ];
    const space = actionSpace(PLAN, rows);
    expect(ids(space.clicks)).toEqual(['click:e1']);
    expect(ids(space.scrolls)).toEqual(['scroll_down']);
    // Everything above: a scroll up, and only up.
    const above = [rows[0]!, row('e3', 'button', 'Play', { bounds: { x: 10, y: -200, w: 80, h: 30 } })];
    expect(ids(actionSpace(PLAN, above).scrolls)).toEqual(['scroll_up']);
  });

  it('carries the plan\'s text on a typing candidate, never anything else', () => {
    const typed = actionSpace(PLAN, SPOTIFY).types.find((c) => c.id === 'type:e3:1')!;
    expect(typed).toMatchObject({ action: 'type_into', ref: 'e3', text: 'This Must Be the Place Talking Heads' });
  });
});

describe('decideFastStep', () => {
  it('asks the operation and each target in one request, and uses only the target that matches', async () => {
    const asked: Record<string, JevAsk>[] = [];
    const jev = jevAnswering({ operation: sure('type'), click_target: sure('click:e6'), type_target: sure('type:e3:1') }, asked);
    const decision = await decideFastStep(jev, PLAN, '', SPOTIFY, 'Spotify');
    expect(decision.pick).toMatchObject({ id: 'type:e3:1', action: 'type_into' });
    expect(asked).toHaveLength(1);
    expect(Object.keys(asked[0]!)).toEqual(['operation', 'click_target', 'type_target']);
    expect(Object.keys(asked[0]!.click_target!.options)).toContain('none');
  });

  it('offers only the operations the window has targets for', async () => {
    const asked: Record<string, JevAsk>[] = [];
    await decideFastStep(jevAnswering({}, asked), PLAN, '', SPOTIFY, '');
    const operations = Object.keys(asked[0]!.operation!.options);
    expect(operations).toEqual(['click', 'type', 'done', 'blocked', 'other']);
    const noField = SPOTIFY.filter((r) => r.role !== 'searchfield');
    await decideFastStep(jevAnswering({}, asked), PLAN, '', noField, '');
    expect(Object.keys(asked[1]!.operation!.options)).not.toContain('type');
    expect(Object.keys(asked[1]!)).not.toContain('type_target');
  });

  it('hands the turn back on other, an unsure operation, a none target, or an unsure target', async () => {
    const base = { operation: sure('click'), click_target: sure('click:e6') };
    const decide = (answers: Record<string, JevChoice | null>) => decideFastStep(jevAnswering(answers), PLAN, '', SPOTIFY, '');
    expect((await decide({ ...base, operation: sure('other') })).pick).toBeNull();
    expect((await decide({ ...base, operation: { choice: 'click', confidence: 0.6 } })).pick).toBeNull();
    expect((await decide({ ...base, click_target: sure('none') })).pick).toBeNull();
    expect((await decide({ ...base, click_target: { choice: 'click:e6', confidence: 0.6 } })).pick).toBeNull();
    expect((await decide({ ...base, operation: null })).pick).toBeNull();
    for (const decision of [await decide({ ...base, operation: sure('other') }), await decide({ ...base, operation: null })]) {
      expect(decision.pause).toBe(false);
    }
  });

  it('done and blocked hand the turn back and stay out until the window changes', async () => {
    const decide = (op: string) => decideFastStep(jevAnswering({ operation: sure(op), click_target: sure('click:e6') }), PLAN, '', SPOTIFY, '');
    expect(await decide('blocked')).toMatchObject({ pick: null, pause: true });
    expect(await decide('done')).toMatchObject({ pick: null, pause: true });
  });

  it('never asks about a thin tree: a canvas is the frontier model\'s', async () => {
    const asked: Record<string, JevAsk>[] = [];
    const decision = await decideFastStep(jevAnswering({}, asked), PLAN, '', SPOTIFY.slice(0, 2), 'Figma');
    expect(decision.pick).toBeNull();
    expect(decision.reason).toMatch(/candidate actions/);
    expect(asked).toHaveLength(0);
  });
});

describe('the calls the loop executes', () => {
  it('is a computer action by observation and ref, with the text only on a type', () => {
    const space = actionSpace(PLAN, SPOTIFY);
    const click = space.clicks.find((c) => c.id === 'click:e6')!;
    expect(actionBlock('obs-3', click, 2)).toEqual({
      type: 'tool_use',
      id: 'systemone_2',
      name: 'computer',
      input: { action: 'click_element', observation_id: 'obs-3', ref: 'e6' },
    });
    const typed = space.types.find((c) => c.id === 'type:e3:1')!;
    expect(actionBlock('obs-3', typed, 3).input).toMatchObject({ action: 'type_into', ref: 'e3', text: 'This Must Be the Place Talking Heads' });
  });

  it('a scroll names its direction and needs no element', () => {
    const view = { x: 0, y: 0, w: 800, h: 600 };
    const rows = [row('e0', 'window', 'Page', { bounds: view }), row('e2', 'button', 'Play', { bounds: { x: 10, y: 900, w: 80, h: 30 } })];
    const [down] = actionSpace(PLAN, rows).scrolls;
    expect(actionBlock('obs-3', down!, 4).input).toEqual({ action: 'scroll', scroll_direction: 'down', scroll_amount: 10 });
  });

  it('the handoff is the read the model would have asked for', () => {
    expect(handoffBlock(5)).toEqual({ type: 'tool_use', id: 'systemone_5_handoff', name: 'computer', input: { action: 'get_window_state' } });
  });

  it('summarizes the last actions for Jev, one line each with how it went', () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({
      index: i + 1,
      timestamp: 0,
      action: 'click_element',
      args: `{"ref":"e${i}"}`,
      reasoning: '',
      result: `clicked e${i}\nwindow tree…`,
      thumbnail: '',
    }));
    const text = recentActions(entries);
    expect(text.split('\n')).toHaveLength(6);
    expect(text).toContain('click_element {"ref":"e7"} -> clicked e7');
    expect(text).not.toContain('window tree');
  });
});

describe('fastStep', () => {
  /** A provider whose window reads as `tree` and resolves to the Spotify rows. */
  function providerReading(tree: string): ComputerProvider {
    return {
      act: async () => ({ observation: { kind: 'window', observationId: 'obs-1', pid: 1, windowId: 1, app: 'Spotify', title: '', tree, shown: 8, kept: 8, total: 8 } }),
      resolveElements: () => ({ observationId: 'obs-1', pid: 1, windowId: 1, app: 'Spotify', title: '', rows: SPOTIFY }),
    } as unknown as ComputerProvider;
  }
  const deps = (tree: string, previousTree?: string, answers: Record<string, JevChoice | null> = { operation: sure('click'), click_target: sure('click:e6') }) => ({
    jev: jevAnswering(answers),
    provider: providerReading(tree),
    plan: () => PLAN,
    log: () => [],
    signal: new AbortController().signal,
    ...(previousTree !== undefined ? { previousTree } : {}),
  });

  it('hands back when the window reads the same as before its last step, and acts when it changed', async () => {
    const same = await fastStep(deps('rows A', 'rows A'), 1);
    expect(same).toMatchObject({ reason: expect.stringMatching(/reads the same/) });
    const changed = await fastStep(deps('rows B', 'rows A'), 2);
    expect(changed).toMatchObject({ pick: { id: 'click:e6' }, tree: 'rows B' });
  });

  it('every pass after a read carries a fresh read for the model, and blocked carries the pause', async () => {
    const same = await fastStep(deps('rows A', 'rows A'), 1);
    expect(same).toMatchObject({ handoff: [handoffBlock(1)] });
    const blocked = await fastStep(deps('rows B', undefined, { operation: sure('blocked') }), 2);
    expect(blocked).toMatchObject({ reason: 'operation blocked 0.93', handoff: [handoffBlock(2)], pause: true });
    const unsure = await fastStep(deps('rows B', undefined, { operation: sure('click'), click_target: sure('none') }), 3);
    expect(unsure).toMatchObject({ handoff: [handoffBlock(3)], pause: false });
  });
});
