// Plotting a function inside a region of the screen.

import { labelUnder, readBox, type ShapeBuilder } from '../build';
import { smoothPath } from '../geometry';
import { DEFAULT_SAMPLES, MAX_SAMPLES, samplePlot } from '../plot';
import { bounded, range } from '../read';

const plot: ShapeBuilder = (shape, context) => {
  const box = readBox(shape, context);
  if ('error' in box) return box;

  const xRange = range(shape['x_range']);
  const yRange = range(shape['y_range']);
  if (!xRange || !yRange) {
    return { error: 'plot needs x_range and y_range as [low, high], with high above low.' };
  }
  const samples = Math.round(bounded(shape['samples'], 2, MAX_SAMPLES) ?? DEFAULT_SAMPLES);

  const sampled = samplePlot({
    expression: shape['expression'],
    xRange,
    yRange,
    samples,
    box: box.rect,
  });
  if ('error' in sampled) return { error: sampled.error };

  // Each run of joined-up samples is its own subpath, so the curve breaks at
  // an asymptote instead of drawing a line straight through it.
  const d = sampled.segments.map((segment) => smoothPath(segment)).join(' ');
  return {
    displayId: box.displayId,
    geometry: { kind: 'path', d, arrowStart: false, arrowEnd: false, closed: false },
    labelAt: labelUnder(box.rect),
    points: sampled.segments.reduce((total, segment) => total + segment.length, 0),
  };
};

export const CHART_BUILDERS: Record<string, ShapeBuilder> = { plot };
