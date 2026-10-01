// Buddy's own SVG path parser.
//
// The model may hand over a path string, which is the one place it writes
// something that looks like markup. So it is parsed here rather than trusted:
// only the commands below, only numbers as arguments, and a cap on length.
// Anything else — a script, an unknown letter, a stray identifier — is
// refused with the reason. The output is rebuilt from the parsed numbers, so
// whatever the model actually wrote never reaches the renderer verbatim.
//
// Coordinates arrive in a screenshot's pixel space and leave in overlay DIP.
//
// Pure module, heavily unit-tested.

import type { Point } from '../../shared/drawing';

/** How many arguments each command takes, and which of them are coordinates. */
const COMMANDS: Record<string, { args: number; kind: 'xy' | 'x' | 'y' | 'arc' | 'none' }> = {
  M: { args: 2, kind: 'xy' },
  L: { args: 2, kind: 'xy' },
  H: { args: 1, kind: 'x' },
  V: { args: 1, kind: 'y' },
  C: { args: 6, kind: 'xy' },
  S: { args: 4, kind: 'xy' },
  Q: { args: 4, kind: 'xy' },
  T: { args: 2, kind: 'xy' },
  A: { args: 7, kind: 'arc' },
  Z: { args: 0, kind: 'none' },
};

export const MAX_COMMANDS = 300;

/** How a pixel-space path maps onto the display it is drawn on. */
export interface PathTransform {
  /** Display points per screenshot pixel. */
  scale: Point;
  /** Where the screenshot's origin sits in overlay coordinates. */
  origin: Point;
}

export type ParseResult = { d: string; commands: number } | { error: string };

/**
 * Parse a path and rewrite it into overlay coordinates.
 *
 * Absolute commands are moved and scaled; relative ones (lowercase) are only
 * scaled, since a delta has no origin. Arc radii scale per axis and the
 * flags pass through untouched.
 */
export function parseSvgPath(input: unknown, transform: PathTransform): ParseResult {
  if (typeof input !== 'string' || input.trim() === '') {
    return { error: 'svg_path needs d: a path string.' };
  }
  if (input.length > 8_000) return { error: 'that path is too long to read.' };

  // One pass over letters and numbers. Anything else is not a path.
  const tokens = input.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens) return { error: 'that is not a path: no commands found.' };

  const rebuilt: string[] = [];
  let count = 0;
  let index = 0;
  let command = '';

  while (index < tokens.length) {
    const token = tokens[index]!;
    if (isCommand(token)) {
      const upper = token.toUpperCase();
      if (!COMMANDS[upper]) {
        return {
          error: `"${token}" is not a path command Buddy accepts. Use only M L H V C S Q T A Z.`,
        };
      }
      command = token;
      index++;
    } else if (!command) {
      return { error: 'that path starts with a number; it must start with a command.' };
    }

    const spec = COMMANDS[command.toUpperCase()]!;
    const absolute = command === command.toUpperCase();

    if (spec.args === 0) {
      rebuilt.push(command);
      count++;
      continue;
    }

    const args: number[] = [];
    for (let i = 0; i < spec.args; i++) {
      const value = tokens[index + i];
      // A single letter is the next command; "2e2" is a number that
      // happens to contain one.
      if (value === undefined || isCommand(value)) {
        return { error: `${command} needs ${spec.args} numbers; got ${i}.` };
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return { error: `"${value}" is not a usable number.` };
      args.push(parsed);
    }
    index += spec.args;

    rebuilt.push(command, ...mapArgs(args, spec.kind, absolute, transform).map((n) => String(short(n))));
    count++;
    if (count > MAX_COMMANDS) {
      return { error: `that path has more than ${MAX_COMMANDS} commands.` };
    }
  }

  if (count === 0) return { error: 'that path has no commands.' };
  return { d: rebuilt.join(' '), commands: count };
}

/** Move and scale one command's arguments into overlay coordinates. */
function mapArgs(
  args: readonly number[],
  kind: 'xy' | 'x' | 'y' | 'arc' | 'none',
  absolute: boolean,
  { scale, origin }: PathTransform,
): number[] {
  const mapX = (value: number): number => value * scale.x + (absolute ? origin.x : 0);
  const mapY = (value: number): number => value * scale.y + (absolute ? origin.y : 0);

  if (kind === 'x') return args.map(mapX);
  if (kind === 'y') return args.map(mapY);
  if (kind === 'arc') {
    // rx ry rotation large-arc sweep x y — the radii scale, the flags and
    // the rotation are not lengths and pass through.
    const [rx = 0, ry = 0, rotation = 0, large = 0, sweep = 0, x = 0, y = 0] = args;
    return [rx * scale.x, ry * scale.y, rotation, large, sweep, mapX(x), mapY(y)];
  }
  // Coordinate pairs, however many of them.
  return args.map((value, position) => (position % 2 === 0 ? mapX(value) : mapY(value)));
}

/** A path command is always a single letter. */
function isCommand(token: string): boolean {
  return token.length === 1 && /[A-Za-z]/.test(token);
}

function short(value: number): number {
  return Math.round(value * 100) / 100;
}
