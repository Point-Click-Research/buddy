import { describe, expect, it } from 'vitest';
import { buildComputerTool } from '../src/main/agent/tool-schema';
import { ACTIONS, actionsForFamilies, cleanArgs, targetingOf, unknownFields } from '../src/main/computer/actions';
import type { ComputerDescriptor } from '../src/main/computer/provider';

function descriptor(overrides: Partial<ComputerDescriptor> = {}): ComputerDescriptor {
  const families = overrides.families ?? (['screen'] as const);
  return {
    id: 'basic',
    label: 'test',
    families,
    actions: actionsForFamilies(families),
    ...overrides,
  };
}

/** The action names of every family Buddy has not implemented yet. */
const OTHER_FAMILY_ACTIONS = Object.entries(ACTIONS)
  .filter(([, spec]) => spec.family !== 'screen')
  .map(([name]) => name);

// A model sent key with a ref three times running and was refused each time,
// though what it meant (press Return in that field) is a fine thing to ask
// for. Where a provider can focus an element, key takes one; a read may carry
// a stray ref because it acts nowhere; and a screen-only provider still refuses.
// GPT models under OpenRouter send every property of the flat schema on
// every call: blanks for most, the first option for enums. key
// {"text":"cmd+n"} arrived with fifteen such fields and list_windows with
// scroll_direction "up" and until "appears"; each was refused three times
// running for "not taking" them.
describe('cleanArgs', () => {
  const padding = {
    clipboard_text: '',
    coordinate: [0, 0],
    duration: 0,
    modifiers: [],
    observation_id: '',
    ref: '',
    path: [],
    scroll_amount: 0,
    scroll_direction: 'up',
    until: 'appears',
  };

  it('drops the blanks and the defaulted enums a padded call carries, keeping what the model meant', () => {
    expect(cleanArgs('key', { text: 'cmd+n', repeat: 0, ...padding })).toEqual({ text: 'cmd+n' });
    expect(cleanArgs('list_windows', padding)).toEqual({});
    expect(unknownFields('list_windows', cleanArgs('list_windows', padding))).toEqual([]);
  });

  it('keeps an enum the action takes, padded call or not', () => {
    expect(cleanArgs('scroll', { ...padding, coordinate: [40, 50], frame_id: 'f1', scroll_direction: 'down' })).toEqual({
      coordinate: [40, 50],
      frame_id: 'f1',
      scroll_direction: 'down',
    });
  });

  it('never drops a real targeting field, so a ref on a click is still refused', () => {
    const cleaned = cleanArgs('left_click', { ...padding, coordinate: [40, 50], frame_id: 'f1', ref: 'e3' });
    expect(cleaned.ref).toBe('e3');
    expect(unknownFields('left_click', cleaned)).toEqual(['ref']);
  });

  it('leaves an unpadded call alone, wrong fields included', () => {
    expect(cleanArgs('key', { text: 'Return', until: 'gone' })).toEqual({ text: 'Return', until: 'gone' });
  });
});

describe('unknownFields', () => {
  it('lets key name a field to focus where elements exist, and not on a screen-only provider', () => {
    const keyed = { text: 'Return', observation_id: 'o1', ref: 'e3' };
    expect(unknownFields('key', keyed)).toEqual([]);
    expect(unknownFields('key', keyed, false)).toEqual(['observation_id', 'ref']);
    expect(unknownFields('key', { text: 'Return', coordinate: [1, 2] })).toEqual(['coordinate']);
  });

  it('ignores a stray ref on a read and still refuses one on a click', () => {
    expect(unknownFields('get_window_state', { observation_id: 'o1', ref: 'e3' })).toEqual([]);
    expect(unknownFields('left_click', { coordinate: [1, 2], frame_id: 'f', ref: 'e3' })).toEqual(['ref']);
  });
});

describe('actionsForFamilies', () => {
  it('only returns actions from the families given', () => {
    const screen = actionsForFamilies(['screen']);
    expect(screen).toContain('left_click');
    for (const name of OTHER_FAMILY_ACTIONS) expect(screen).not.toContain(name);
  });

  it('drops actions the provider is missing, even inside a supported family', () => {
    const actions = actionsForFamilies(['screen'], ['left_mouse_down', 'left_mouse_up']);
    expect(actions).toContain('left_click');
    expect(actions).not.toContain('left_mouse_down');
    expect(actions).not.toContain('left_mouse_up');
  });

  it('returns nothing for a provider with no families', () => {
    expect(actionsForFamilies([])).toEqual([]);
  });
});

describe('buildComputerTool', () => {
  it('exposes exactly the descriptor actions and nothing else', () => {
    const tool = buildComputerTool(descriptor());
    const schema = tool.input_schema as {
      properties: { action: { enum: string[] } };
      required: string[];
    };
    expect(tool.name).toBe('computer');
    expect(schema.properties.action.enum).toEqual(actionsForFamilies(['screen']));
    expect(schema.required).toEqual(['action']);
  });

  it('never exposes an action a provider cannot perform', () => {
    const narrowed = descriptor({ actions: actionsForFamilies(['screen'], ['left_mouse_down', 'left_mouse_up']) });
    const tool = buildComputerTool(narrowed);
    const schema = tool.input_schema as { properties: { action: { enum: string[] } } };
    expect(schema.properties.action.enum).not.toContain('left_mouse_down');
    // And the description doesn't advertise it either.
    expect(tool.description).not.toContain('left_mouse_down');
    expect(tool.description).toContain('left_click');
  });

  it('only includes the argument fields its actions actually read', () => {
    // A screenshot-only provider needs no coordinates or text at all.
    const tool = buildComputerTool(descriptor({ actions: ['screenshot'] }));
    const schema = tool.input_schema as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toEqual(['action']);

    const clicking = buildComputerTool(descriptor({ actions: ['left_click', 'key'] }));
    const clickingSchema = clicking.input_schema as { properties: Record<string, unknown> };
    expect(Object.keys(clickingSchema.properties).sort()).toEqual(
      ['action', 'coordinate', 'frame_id', 'modifiers', 'repeat', 'text'].sort(),
    );
    expect(clickingSchema.properties['region']).toBeUndefined();
  });

  it('tells the model which fields each action requires, as readable prose', () => {
    const tool = buildComputerTool(descriptor({ actions: ['left_click_drag', 'zoom', 'type'] }));
    expect(tool.description).toContain('Needs start_coordinate, coordinate and frame_id.');
    expect(tool.description).toContain('Needs region and frame_id.');
    expect(tool.description).toContain('Needs text.');
  });

  it('offers element actions only to a provider that has the element family', () => {
    // The no-fallback rule, enforced at the schema: a screen-only provider
    // must not be shown a ref-based action it would have to refuse.
    const screenOnly = buildComputerTool(descriptor()).input_schema as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(screenOnly.properties)).not.toContain('ref');

    const withElements = descriptor({
      families: ['screen', 'window', 'element'],
      actions: actionsForFamilies(['screen', 'window', 'element']),
    });
    const tool = buildComputerTool(withElements);
    const schema = tool.input_schema as { properties: { action: { enum: string[] } } };
    expect(schema.properties.action.enum).toEqual(
      expect.arrayContaining(['get_window_state', 'click_element', 'set_value', 'invoke_menu']),
    );
    expect(tool.description).toContain('Needs observation_id, ref and value.');
  });

  it('names how an action found its target, for the agent log', () => {
    expect(targetingOf({ element: 'the Ellipse tool' })).toBe('jev');
    expect(targetingOf({ condition: 'the export finished' })).toBe('jev');
    expect(targetingOf({ observation_id: 'o1', ref: 'e4' })).toBe('ref');
    expect(targetingOf({ coordinate: [10, 20], frame_id: 'f1' })).toBe('coordinate');
    expect(targetingOf({ start_coordinate: [1, 2], coordinate: [3, 4] })).toBe('coordinate');
    expect(targetingOf({ text: 'cmd+z' })).toBe('none');
    expect(targetingOf({ element: '  ' })).toBe('none');
  });

  it('offers element in plain words, and wait_for conditions, only with Jev', () => {
    const families = ['screen', 'window', 'element'] as const;
    const actions = actionsForFamilies(families);
    const without = buildComputerTool(descriptor({ families, actions }));
    const withJev = buildComputerTool(descriptor({ families, actions, jev: true }));
    const fields = (tool: ReturnType<typeof buildComputerTool>): string[] =>
      Object.keys((tool.input_schema as { properties: Record<string, unknown> }).properties);

    expect(fields(without)).not.toContain('element');
    expect(fields(without)).not.toContain('condition');
    expect(without.description).toContain('Needs observation_id and ref.');
    expect(without.description).not.toContain('plain words');

    expect(fields(withJev)).toEqual(expect.arrayContaining(['element', 'condition']));
    expect(withJev.description).toContain('Needs observation_id and ref, or element.');
    expect(withJev.description).toContain('no get_window_state call is needed first');
  });

  it('offers frame_id wherever a coordinate can be sent', () => {
    // A coordinate is meaningless without the frame it was measured in, so
    // the two fields always travel together.
    for (const name of ['left_click', 'mouse_move', 'left_click_drag', 'scroll', 'zoom']) {
      const schema = buildComputerTool(descriptor({ actions: [name] })).input_schema as {
        properties: Record<string, unknown>;
      };
      expect(schema.properties['frame_id'], name).toBeDefined();
    }
  });
});
