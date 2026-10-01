// Turning a provider outcome into the tool_result the model reads. This is
// where the dedupe pays off: an unchanged screen is reported in one line
// instead of resending an identical image, and every delivered frame is
// labelled with the frame_id a coordinate must quote. A window observation
// costs no image at all — it is the element list the refs belong to.
// Pure module.

import type { ImageBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources/messages';
import type { ToolOutcome } from '../ai/tools';
import { formatComputerError } from '../computer/errors';
import type {
  ActionOutcome,
  ScreenObservation,
  WindowObservationView,
} from '../computer/provider';

/** Where typing goes, repeated on every observation because it can change. */
function focusNote(frontmost: string): string {
  return `Frontmost app: ${frontmost}. type and key go to this app — do not type if it isn't the destination.`;
}

export function toToolOutcome(outcome: ActionOutcome, frontmost: string): ToolOutcome {
  if (outcome.error) return { content: formatComputerError(outcome.error), isError: true };

  const observation = outcome.observation;
  if (!observation) return { content: outcome.text ?? 'done' };
  if (observation.kind === 'window') {
    return { content: join([outcome.text, describeWindow(observation)]) };
  }
  return screenOutcome(outcome.text, observation, frontmost);
}

/**
 * The window's elements, with the observation_id its refs belong to. No
 * image: these refs are the coordinates, and they survive the window being
 * behind another one.
 */
function describeWindow(view: WindowObservationView): string {
  const hidden = view.kept - view.shown;
  return [
    `Window "${view.title}" in ${view.app} — pid ${view.pid}, window_id ${view.windowId}, ` +
      `observation_id ${view.observationId}. ` +
      `${view.shown} elements${hidden > 0 ? ` of ${view.kept} (an overview: rows ending "+N inside" hide that many elements — use expand_element on them)` : ''}, ` +
      `filtered from ${view.total} walked; menus are left out, use invoke_menu. ` +
      'These refs stop working the moment this window is observed again.',
    view.degradedReason
      ? `The accessibility tree is incomplete (${view.degradedReason}) — work from a screenshot instead.`
      : undefined,
    view.tree,
  ]
    .filter(Boolean)
    .join('\n');
}

function screenOutcome(
  text: string | undefined,
  observation: ScreenObservation,
  frontmost: string,
): ToolOutcome {
  // Nothing changed on screen, so the image already in context is the current
  // one. Saying so costs a line; resending it costs a whole screenshot.
  if (observation.unchanged || !observation.base64) {
    return {
      content: join([
        text,
        `Screen unchanged since frame ${observation.frameId}; no new image. Keep using that frame_id.`,
        focusNote(frontmost),
      ]),
    };
  }

  const content: Array<TextBlockParam | ImageBlockParam> = [
    {
      type: 'text',
      text: join([
        text,
        `frame_id: ${observation.frameId} (${observation.width}x${observation.height}). ` +
          'Send this frame_id with any coordinate you measure here.',
        focusNote(frontmost),
      ]),
    },
    {
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: observation.base64 },
    },
  ];
  return { content };
}

function join(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
