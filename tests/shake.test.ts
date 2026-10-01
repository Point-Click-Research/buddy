import { describe, expect, it } from 'vitest';
import { createShakeDetector, type ShakeSample } from '../src/main/shake';

/** Samples every 16ms sweeping horizontally between x positions. */
function sweep(fromX: number, toX: number, startTime: number, y = 300): ShakeSample[] {
  const steps = 4;
  const samples: ShakeSample[] = [];
  for (let i = 1; i <= steps; i++) {
    samples.push({
      x: fromX + ((toX - fromX) * i) / steps,
      y,
      time: startTime + i * 16,
    });
  }
  return samples;
}

/** A full shake: right, left, right, left — four 80px legs, ~64ms each. */
function shakeSamples(start = 0): ShakeSample[] {
  return [
    { x: 500, y: 300, time: start },
    ...sweep(500, 580, start),
    ...sweep(580, 500, start + 64),
    ...sweep(500, 580, start + 128),
    ...sweep(580, 500, start + 192),
  ];
}

function feed(samples: ShakeSample[]): boolean[] {
  const detector = createShakeDetector();
  return samples.map((sample) => detector.handle(sample));
}

describe('shake detector', () => {
  it('fires on a quick horizontal shake', () => {
    expect(feed(shakeSamples())).toContain(true);
  });

  it('fires at most once per shake (cooldown)', () => {
    const detector = createShakeDetector();
    // Two shakes back to back inside the cooldown: only the first counts.
    const results = [...shakeSamples(0), ...shakeSamples(300)].map((s) => detector.handle(s));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('fires again once the cooldown has passed', () => {
    const detector = createShakeDetector();
    const results = [...shakeSamples(0), ...shakeSamples(2_000)].map((s) => detector.handle(s));
    expect(results.filter(Boolean)).toHaveLength(2);
  });

  it('ignores a straight sweep with no reversals', () => {
    expect(feed([{ x: 0, y: 300, time: 0 }, ...sweep(0, 800, 0)])).not.toContain(true);
  });

  it('ignores short jitter that never makes a real leg', () => {
    // 10px wiggles: plenty of reversals, none of them 40px sweeps.
    const samples: ShakeSample[] = [{ x: 500, y: 300, time: 0 }];
    for (let i = 1; i <= 30; i++) {
      samples.push({ x: 500 + (i % 2 === 0 ? 0 : 10), y: 300, time: i * 16 });
    }
    expect(feed(samples)).not.toContain(true);
  });

  it('ignores a slow wiggle spread past the window', () => {
    // The same four legs, but each takes 400ms: reversals age out.
    const samples: ShakeSample[] = [{ x: 500, y: 300, time: 0 }];
    const legs = [580, 500, 580, 500];
    let from = 500;
    legs.forEach((to, i) => {
      for (let step = 1; step <= 4; step++) {
        samples.push({ x: from + ((to - from) * step) / 4, y: 300, time: i * 400 + step * 100 });
      }
      from = to;
    });
    expect(feed(samples)).not.toContain(true);
  });

  it('starts over after reset (e.g. a drag began)', () => {
    const detector = createShakeDetector();
    const samples = shakeSamples();
    // Feed most of the shake, reset mid-gesture, then the tail alone.
    for (const sample of samples.slice(0, 12)) detector.handle(sample);
    detector.reset();
    const rest = samples.slice(12).map((sample) => detector.handle(sample));
    expect(rest).not.toContain(true);
  });
});
