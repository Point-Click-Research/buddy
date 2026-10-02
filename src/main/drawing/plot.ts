// Plotting a function of x.
//
// The expression comes from the model, so it is checked against an allowlist
// of names before mathjs ever compiles it, and evaluated with a scope that
// holds nothing but x. mathjs itself refuses most mischief, but "it throws"
// is not a security model.
//
// The sampling is the interesting part. A curve like tan(x) or 1/x does not
// go to infinity politely — near an asymptote it returns 1.6e16, a finite
// number — so the curve is broken both at values that aren't finite and at
// jumps too large to be real, rather than drawing a vertical line through
// the asymptote.

import { compile } from 'mathjs';
import type { Point } from '../../shared/drawing';

export const MAX_SAMPLES = 400;
export const DEFAULT_SAMPLES = 200;

/**
 * Names an expression may use: arithmetic, the standard functions, the two
 * constants, and the variable.
 */
const ALLOWED = new Set([
  'x',
  'pi',
  'e',
  'tau',
  'abs',
  'sqrt',
  'cbrt',
  'exp',
  'log',
  'log2',
  'log10',
  'ln',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'floor',
  'ceil',
  'round',
  'sign',
  'min',
  'max',
  'pow',
  'mod',
  'hypot',
]);

/** A run of joined-up samples; a break starts a new one. */
type Segment = Point[];

export type PlotResult = { segments: Segment[] } | { error: string };

/**
 * Sample `expression` across `xRange`, mapping into the box in overlay
 * coordinates. `yRange` fixes the vertical scale so the axes and the curve
 * agree.
 */
export function samplePlot(params: {
  expression: unknown;
  xRange: [number, number];
  yRange: [number, number];
  samples: number;
  box: { x: number; y: number; width: number; height: number };
}): PlotResult {
  const { expression, xRange, yRange, samples, box } = params;
  if (typeof expression !== 'string' || expression.trim() === '') {
    return { error: 'plot needs expression: a formula in x, for example "sin(x) * x^2".' };
  }
  const unknown = namesIn(expression).find((name) => !ALLOWED.has(name));
  if (unknown) {
    return {
      error: `"${unknown}" is not something plot understands. Use x, the standard maths functions, pi and e.`,
    };
  }

  let evaluate: (scope: { x: number }) => unknown;
  try {
    const compiled = compile(expression);
    evaluate = (scope) => compiled.evaluate(scope);
  } catch {
    return { error: `"${expression}" is not a formula I can read.` };
  }

  const [xLow, xHigh] = xRange;
  const [yLow, yHigh] = yRange;
  const toScreen = (x: number, y: number): Point => ({
    x: box.x + ((x - xLow) / (xHigh - xLow)) * box.width,
    // Screen y grows downward, so the range is flipped.
    y: box.y + (1 - (y - yLow) / (yHigh - yLow)) * box.height,
  });

  // A jump bigger than the whole plot is an asymptote, not a line.
  const jumpLimit = (yHigh - yLow) * 1.5;

  const segments: Segment[] = [];
  let current: Segment = [];
  let previousY: number | null = null;

  for (let i = 0; i < samples; i++) {
    const x = xLow + ((xHigh - xLow) * i) / (samples - 1);
    let y: number;
    try {
      const value = evaluate({ x });
      y = typeof value === 'number' ? value : Number.NaN;
    } catch {
      y = Number.NaN;
    }

    const broken =
      !Number.isFinite(y) || (previousY !== null && Math.abs(y - previousY) > jumpLimit);
    if (broken) {
      if (current.length > 1) segments.push(current);
      current = [];
      previousY = Number.isFinite(y) ? y : null;
      continue;
    }
    current.push(toScreen(x, y));
    previousY = y;
  }
  if (current.length > 1) segments.push(current);

  if (segments.length === 0) {
    return { error: `"${expression}" has no finite values in that range.` };
  }
  return { segments };
}

/** Every identifier in an expression, so unknown ones can be refused. */
function namesIn(expression: string): string[] {
  return expression.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
}
