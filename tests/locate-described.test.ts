// Finding a described thing no window lists: by its name on screen ("box the
// Stuff folder on my desktop"), or in the picture itself ("circle the rock").

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  screen: {
    getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 } }],
  },
  nativeTheme: { on: () => {} },
}));

vi.mock('../src/main/capture', () => ({ captureDisplayPng: async () => Buffer.from('') }));

/** The chat line mentions "stuff" too; only the desktop label is the folder's name. */
vi.mock('../src/main/reader/ocr', () => ({
  findTextInImage: async (_file: string, query: string) =>
    query === 'Stuff'
      ? [
          { line: 'box and label the stuff folder', x: 0.1, y: 0.1, w: 0.05, h: 0.02 },
          { line: 'Stuff', x: 0.6, y: 0.55, w: 0.03, h: 0.02 },
        ]
      : [],
}));

const { locateDescribed, locatedTextBox, visibleName } = await import('../src/main/ai/locate-text');
const { readBox } = await import('../src/main/ai/locate-object');

describe('visibleName', () => {
  it('keeps the name and drops the article and the kind of thing', () => {
    expect(visibleName('the Stuff folder')).toBe('Stuff');
    expect(visibleName('Reload button')).toBe('Reload');
    expect(visibleName('Stuff')).toBe('Stuff');
  });

  it('takes quoted text as the name, whatever surrounds it', () => {
    expect(visibleName('the "Q3 Report.pdf" file on the desktop')).toBe('Q3 Report.pdf');
  });
});

describe('locateDescribed', () => {
  it("picks the match whose whole line is the name, not a sentence that mentions it", async () => {
    const found = await locateDescribed('the Stuff folder', 1);
    if ('error' in found) throw new Error(found.error);
    const box = locatedTextBox(found.observationId, found.ref);
    expect(box?.rect.x).toBeGreaterThan(700);
  });

  it('says so when the name is nowhere on screen', async () => {
    expect(await locateDescribed('the Reports folder', 1)).toHaveProperty('error');
  });

  it('never takes a word in a sentence for the thing itself', async () => {
    // "circle the rock" in the chat is not the rock in the wallpaper: that one is found in the picture.
    expect(await locateDescribed('the stuff', 1)).toHaveProperty('error');
  });
});

describe('readBox', () => {
  it("reads Gemini's box_2d, [ymin, xmin, ymax, xmax] on a 0-1000 scale, as a box from the top left", () => {
    expect(readBox('{"box_2d": [500, 250, 750, 500]}')).toEqual({ x: 0.25, y: 0.5, w: 0.25, h: 0.25 });
    const fenced = readBox('```json\n{"box_2d": [100, 200, 300, 400]}\n```')!;
    expect(fenced.x).toBeCloseTo(0.2);
    expect(fenced.y).toBeCloseTo(0.1);
    expect(fenced.w).toBeCloseTo(0.2);
    expect(fenced.h).toBeCloseTo(0.2);
  });

  it('finds nothing when the model found nothing, or sent a box with no area', () => {
    expect(readBox('{"box_2d": null}')).toBeNull();
    expect(readBox('{"box_2d": [500, 500, 500, 600]}')).toBeNull();
    expect(readBox('I could not find it')).toBeNull();
  });
});
