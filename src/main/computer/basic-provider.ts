// The v2 provider, kept as the fallback: nut.js synthetic input plus
// Electron screen capture. It does the screen family only — full-screen
// pixels on one display — so it has no window, element, browser or
// background abilities to advertise.

import { actionsForFamilies, CLICK_BUTTONS, unknownFields, wrongFieldsDetail } from './actions';
import { clamp, invalid, locateTarget, number, readPoint, readRegion, sleep, text, unsupported } from './args';
import { createDisplayFrames, type DisplayFrames } from './display-capture';
import { computerError, type ComputerError } from './errors';
import { formatCombo, parseKeyCombo } from './keys';
import type { DriverSafetyHooks } from './claim';
import { createNutDriver, type InputDriver } from './nut-driver';
import {
  SETTLE_MS,
  type ActionFamily,
  type ActionOutcome,
  type ComputerAction,
  type ComputerDescriptor,
  type ComputerProvider,
  type Point2D,
} from './provider';
import { errorMessage } from '../../shared/errors';

const FAMILIES: readonly ActionFamily[] = ['screen'];

/** One scroll-wheel "click" in nut.js scroll units. */
const SCROLL_UNITS_PER_CLICK = 100;
const MAX_WAIT_SECONDS = 30;
const MAX_KEY_REPEAT = 50;
const MAX_SCROLL_CLICKS = 50;
/** About one screenful: three clicks left the model inching down long pages. */
const DEFAULT_SCROLL_CLICKS = 10;

/** Everything the provider touches outside itself, so tests can fake it. */
export interface BasicIo {
  driver: InputDriver;
  frames: DisplayFrames;
  /** How long to let the UI settle before the post-action observation. */
  settleMs: number;
}

/** The real io: nut.js input and Electron captures of one display. */
export function basicIoForDisplay(displayId: number, hooks: DriverSafetyHooks): BasicIo {
  return {
    driver: createNutDriver(hooks),
    frames: createDisplayFrames(displayId),
    settleMs: SETTLE_MS,
  };
}

export function createBasicProvider(io: BasicIo): ComputerProvider {
  const descriptor: ComputerDescriptor = {
    id: 'basic',
    label: 'Basic (screen only)',
    families: FAMILIES,
    actions: actionsForFamilies(FAMILIES),
  };

  return {
    descriptor: () => descriptor,
    snapshot: () => io.frames.screenshot(),
    locate: ({ input }) => locateTarget(input, io.frames),
    // No element family, so nothing to anchor a drawing to.
    elementBox: () => null,
    resolveElements: () => null,
    // No window family either, so an action's target window is unknowable —
    // and the background family this feeds is never offered here anyway.
    targetApp: () => null,
    close: async () => undefined,

    async act({ name, input }: ComputerAction): Promise<ActionOutcome> {
      if (!descriptor.actions.includes(name)) {
        return { error: computerError('UNSUPPORTED_ACTION', `"${name}" is not available on this provider.`) };
      }
      // No element family here, so a ref on key is an unknown field like any other.
      const extra = unknownFields(name, input, false);
      if (extra.length > 0) {
        return { error: computerError('INVALID_REQUEST', wrongFieldsDetail(name, extra)) };
      }
      try {
        return await run(name, input, io);
      } catch (error) {
        const detail = errorMessage(error);
        return { error: computerError('DRIVER_UNAVAILABLE', detail) };
      }
    },
  };
}

async function run(
  name: string,
  input: Record<string, unknown>,
  io: BasicIo,
): Promise<ActionOutcome> {
  /** Let the UI settle, then observe: the model sees what the action did. */
  const observeAfter = async (): Promise<ActionOutcome> => {
    await sleep(io.settleMs);
    return { observation: await io.frames.screenshot() };
  };

  const checkFrame = (frameId: unknown): ComputerError | null => io.frames.checkFrame(frameId);

  /** A coordinate in the frame the model named -> a screen point. */
  const screenPoint = (
    field: string,
  ): { point: Point2D } | { error: ComputerError } | { absent: true } => {
    const read = readPoint(input, field, checkFrame);
    if ('error' in read || 'absent' in read) return read;
    return { point: io.frames.toScreen(read.point[0], read.point[1]) };
  };

  switch (name) {
    case 'screenshot':
      return { observation: await io.frames.screenshot() };

    case 'zoom': {
      const region = readRegion(input, checkFrame);
      if ('error' in region) return { error: region.error };
      return { observation: await io.frames.zoom(region.region) };
    }

    case 'cursor_position': {
      const position = io.frames.toImage(await io.driver.cursorPosition());
      return { text: `X=${Math.round(position.x)}, Y=${Math.round(position.y)}` };
    }

    case 'wait': {
      const seconds = clamp(number(input['duration']) ?? 1, 0, MAX_WAIT_SECONDS);
      await sleep(seconds * 1000);
      return { observation: await io.frames.screenshot() };
    }

    case 'mouse_move': {
      const to = screenPoint('coordinate');
      if ('error' in to) return { error: to.error };
      if ('absent' in to) return invalid('mouse_move needs coordinate: [x, y].');
      await io.driver.moveMouse(to.point.x, to.point.y);
      return observeAfter();
    }

    case 'left_click_drag': {
      const from = screenPoint('start_coordinate');
      const to = screenPoint('coordinate');
      if ('error' in from) return { error: from.error };
      if ('error' in to) return { error: to.error };
      if ('absent' in from || 'absent' in to) {
        return invalid('left_click_drag needs start_coordinate and coordinate.');
      }
      await io.driver.drag(from.point, to.point);
      return observeAfter();
    }

    case 'left_mouse_down':
      await io.driver.mouseDown('left');
      return { text: 'The left button is down.' };

    case 'left_mouse_up':
      await io.driver.mouseUp('left');
      return observeAfter();

    case 'scroll': {
      const direction = text(input['scroll_direction']);
      const clicks = clamp(number(input['scroll_amount']) ?? DEFAULT_SCROLL_CLICKS, 1, MAX_SCROLL_CLICKS);
      const at = screenPoint('coordinate');
      if ('error' in at) return { error: at.error };
      if ('point' in at) await io.driver.moveMouse(at.point.x, at.point.y);
      const amount = clicks * SCROLL_UNITS_PER_CLICK;
      if (direction === 'up') await io.driver.scroll(0, -amount);
      else if (direction === 'down') await io.driver.scroll(0, amount);
      else if (direction === 'left') await io.driver.scroll(-amount, 0);
      else if (direction === 'right') await io.driver.scroll(amount, 0);
      else return invalid('scroll needs scroll_direction: up, down, left or right.');
      return observeAfter();
    }

    case 'type': {
      const value = text(input['text']);
      if (!value) return invalid('type needs text.');
      await io.driver.typeText(value);
      return observeAfter();
    }

    case 'key': {
      const combo = parseKeyCombo(text(input['text']));
      if (!combo) return invalid('key needs text: one key with optional modifiers, e.g. "cmd+s".');
      const repeat = clamp(number(input['repeat']) ?? 1, 1, MAX_KEY_REPEAT);
      for (let i = 0; i < repeat; i++) {
        await io.driver.pressKeys(formatCombo(combo));
        if (repeat > 1) await sleep(40);
      }
      return observeAfter();
    }

    default: {
      // A click. Modifier-held clicks are the one thing nut.js can't express.
      const click = CLICK_BUTTONS[name]!;
      if (Array.isArray(input['modifiers']) && input['modifiers'].length > 0) {
        return unsupported('Modifier-held clicks are not supported; click, then press keys.');
      }
      const at = screenPoint('coordinate');
      if ('error' in at) return { error: at.error };
      if ('point' in at) await io.driver.moveMouse(at.point.x, at.point.y);
      await io.driver.click(click.button, click.count);
      return observeAfter();
    }
  }
}

