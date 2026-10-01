import { describe, expect, it } from 'vitest';
import { toToolOutcome } from '../src/main/agent/tool-result';
import { computerError } from '../src/main/computer/errors';
import type { ActionOutcome, Observation } from '../src/main/computer/provider';

const FRONT = 'TextEdit — Untitled';

const FRAME: Observation = {
  kind: 'screen',
  frameId: 'f7',
  width: 1280,
  height: 800,
  base64: 'jpeg-bytes',
};

/** The blocks of a multi-part result, for readable assertions. */
function blocks(outcome: ReturnType<typeof toToolOutcome>) {
  if (typeof outcome.content === 'string') throw new Error('expected content blocks');
  return outcome.content;
}

function textOf(outcome: ReturnType<typeof toToolOutcome>): string {
  if (typeof outcome.content === 'string') return outcome.content;
  return outcome.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join(' ');
}

describe('a delivered frame', () => {
  it('sends the image and labels it with the frame_id to quote', () => {
    const outcome = toToolOutcome({ observation: FRAME }, FRONT);
    const parts = blocks(outcome);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'jpeg-bytes' },
    });
    expect(textOf(outcome)).toContain('frame_id: f7 (1280x800)');
    expect(textOf(outcome)).toContain('Frontmost app: TextEdit — Untitled');
  });

  it('passes on the provider note about an unverified effect', () => {
    const outcome = toToolOutcome(
      { text: 'The driver suspects this action did nothing.', observation: FRAME },
      FRONT,
    );
    expect(textOf(outcome)).toContain('did nothing');
    expect(textOf(outcome)).toContain('frame_id: f7');
  });
});

describe('an unchanged screen', () => {
  const unchanged: Observation = {
    kind: 'screen',
    frameId: 'f7',
    width: 1280,
    height: 800,
    unchanged: true,
  };

  it('sends no image at all, only the previous frame_id', () => {
    const outcome = toToolOutcome({ observation: unchanged }, FRONT);
    // A string result carries no image block by construction, which is the
    // whole point: an identical screenshot never re-enters the context.
    expect(typeof outcome.content).toBe('string');
    expect(textOf(outcome)).toContain('Screen unchanged since frame f7');
    expect(textOf(outcome)).toContain('Keep using that frame_id');
    expect(textOf(outcome)).not.toContain('jpeg-bytes');
  });

  it('still says where typing would go', () => {
    expect(textOf(toToolOutcome({ observation: unchanged }, FRONT))).toContain('Frontmost app');
  });

  it('treats a missing image as unchanged rather than sending an empty one', () => {
    const outcome = toToolOutcome({ observation: { ...unchanged, unchanged: undefined } }, FRONT);
    expect(typeof outcome.content).toBe('string');
    expect(textOf(outcome)).toContain('unchanged');
  });
});

describe('a window observation', () => {
  const window: Observation = {
    kind: 'window',
    observationId: 's0000001a',
    pid: 501,
    windowId: 9001,
    app: 'TextEdit',
    title: 'Untitled',
    tree: 'e1 | window | Untitled | 214,112 586x488\ne2 | checkbox | bold | =0 | 222,152 20x20',
    shown: 2,
    kept: 2,
    total: 189,
  };

  it('costs no image: the refs are what the model acts on', () => {
    const outcome = toToolOutcome({ observation: window }, FRONT);
    expect(typeof outcome.content).toBe('string');
    expect(textOf(outcome)).toContain('e2 | checkbox | bold');
  });

  it('names the observation the refs belong to, and says they expire', () => {
    const text = textOf(toToolOutcome({ observation: window }, FRONT));
    expect(text).toContain('observation_id s0000001a');
    expect(text).toContain('pid 501, window_id 9001');
    expect(text).toContain('observed again');
  });

  it('points at invoke_menu, since the menus were filtered out', () => {
    expect(textOf(toToolOutcome({ observation: window }, FRONT))).toContain('invoke_menu');
  });

  it('offers expand_element only when something was actually held back', () => {
    expect(textOf(toToolOutcome({ observation: window }, FRONT))).not.toContain('expand_element');
    const capped = toToolOutcome({ observation: { ...window, shown: 300, kept: 480 } }, FRONT);
    expect(textOf(capped)).toContain('300 elements of 480');
    expect(textOf(capped)).toContain('expand_element');
  });

  it('warns when the tree is not to be trusted', () => {
    const degraded = { ...window, degradedReason: 'ax_window_unresolved' };
    const text = textOf(toToolOutcome({ observation: degraded }, FRONT));
    expect(text).toContain('ax_window_unresolved');
    expect(text).toContain('screenshot');
  });
});

describe('other outcomes', () => {
  it('renders an error with its code and recovery hint', () => {
    const error = computerError('STALE_FRAME', 'Frame f1 is no longer current.');
    const outcome = toToolOutcome({ error }, FRONT);
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain('STALE_FRAME');
    expect(outcome.content).toContain('Frame f1 is no longer current.');
    expect(outcome.content).toContain(error.hint);
  });

  it('renders a text-only result, like cursor_position', () => {
    const outcome = toToolOutcome({ text: 'X=640, Y=399' }, FRONT);
    expect(outcome.content).toBe('X=640, Y=399');
    expect(outcome.isError).toBeUndefined();
  });

  it('never returns an empty result', () => {
    expect(toToolOutcome({} as ActionOutcome, FRONT).content).toBe('done');
  });
});
