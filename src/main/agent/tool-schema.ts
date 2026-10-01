// Buddy's own `computer` tool: one action per call, with its schema built
// from the active provider's descriptor. The model can only ask for actions
// that provider can really perform — unsupported families never appear.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { ACTIONS, FIELDS, fieldsOf, JEV_FIELDS, type FieldName } from '../computer/actions';
import type { ComputerDescriptor } from '../computer/provider';

const PREAMBLE =
  'Operate the user\'s computer. One action per call, taking only the fields listed for that ' +
  'action. There are two ways to name a target, and they belong to different actions: an ' +
  'element ref goes to the element actions (click_element, right_click_element, set_value, ' +
  'type_into), and is exact; a coordinate in the pixel space of the screenshot you measured ' +
  'it in goes to the click and scroll actions, and is a guess. Prefer refs.';

const BY_DESCRIPTION =
  'The element actions also take element, the target in plain words ("the Add to cart button"): ' +
  'Buddy reads the window and picks it, so no get_window_state call is needed first. This is the fastest way to act; ' +
  'call it as {action: "click_element", element: "…"}.';

export function buildComputerTool(descriptor: ComputerDescriptor): Tool {
  const used = new Set<FieldName>();
  const lines: string[] = [];

  const withElements = descriptor.families.includes('element');
  for (const name of descriptor.actions) {
    const spec = ACTIONS[name];
    if (!spec) continue;
    const fields = fieldsOf(spec, withElements).filter((field) => descriptor.jev || !JEV_FIELDS.includes(field));
    for (const field of fields) used.add(field);
    const orElement = fields.includes('element') ? ', or element' : '';
    const needs = spec.required?.length ? ` Needs ${list(spec.required)}${orElement}.` : '';
    lines.push(`- ${name}: ${spec.summary}${needs}`);
  }

  const properties: Record<string, unknown> = {
    action: {
      type: 'string',
      enum: [...descriptor.actions],
      description: 'Which action to perform.',
    },
  };
  for (const field of [...used].sort()) properties[field] = FIELDS[field];

  return {
    name: 'computer',
    description: `${PREAMBLE}${used.has('element') ? ` ${BY_DESCRIPTION}` : ''} Available actions:\n${lines.join('\n')}`,
    input_schema: { type: 'object', properties, required: ['action'] },
  } as Tool;
}

/** "a", "a and b", "a, b and c" — so three requirements still read as prose. */
function list(names: readonly string[]): string {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
