// Finding text in an image with Apple's Vision framework.
//
// Vision ships with macOS and runs on-device, and JXA (osascript's JavaScript
// flavour) can call it directly — so this is the same zero-dependency pattern
// as the AppleScript readers in frontmost.ts, with a different framework on
// the other end. Word-exact boxes come from boundingBoxForRange, not from
// slicing line boxes, so a match is the glyphs themselves.

import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../log';

const execFileAsync = promisify(execFile);
const log = createLogger('ocr');

/** Vision loads its recognition model on first use; leave room for that. */
const TIMEOUT_MS = 20_000;

/**
 * One place the query's characters appear. The box is normalized to the
 * image (0..1, origin top-left), so the caller can map it onto whatever the
 * image spans without knowing its pixel size.
 */
export interface OcrMatch {
  /** The full recognized line the match sits in, for telling matches apart. */
  line: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The query is matched inside the script rather than in Node so only the
 * matches cross the process boundary, not every word on a 5K display.
 * Language correction is off: it "fixes" identifiers and code into prose.
 * Vision reports boxes with a bottom-left origin; the script flips y.
 */
const FIND_TEXT_SCRIPT = `
ObjC.import('Foundation');
ObjC.import('Vision');
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const query = argv[1].toLowerCase();
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $.NSDictionary.dictionary);
  const request = $.VNRecognizeTextRequest.alloc.init;
  request.usesLanguageCorrection = false;
  if (!handler.performRequestsError($.NSArray.arrayWithObject(request), null)) {
    throw new Error('Vision could not process the image.');
  }
  const results = request.results;
  const out = [];
  if (results && !results.isNil()) {
    for (let i = 0; i < results.count; i++) {
      const candidate = results.objectAtIndex(i).topCandidates(1).objectAtIndex(0);
      const line = candidate.string.js;
      const lower = line.toLowerCase();
      let at = lower.indexOf(query);
      while (at >= 0) {
        const ranged = candidate.boundingBoxForRangeError($.NSMakeRange(at, query.length), null);
        if (ranged && !ranged.isNil()) {
          const box = ranged.boundingBox;
          out.push({
            line: line,
            x: box.origin.x,
            y: 1 - box.origin.y - box.size.height,
            w: box.size.width,
            h: box.size.height,
          });
        }
        at = lower.indexOf(query, at + 1);
      }
    }
  }
  return JSON.stringify(out);
}
`;

/** Every place `query` appears in the image, case-insensitively. macOS only. */
export async function findTextInImage(pngPath: string, query: string): Promise<OcrMatch[]> {
  if (process.platform !== 'darwin') return [];
  const { stdout } = await execFileAsync(
    'osascript',
    ['-l', 'JavaScript', '-e', FIND_TEXT_SCRIPT, pngPath, query],
    { timeout: TIMEOUT_MS, maxBuffer: 4_000_000 },
  );
  const matches = parseMatches(stdout);
  log.info(`"${query}": ${matches.length} match(es)`);
  return matches;
}

/** Exported for tests: keep only well-formed matches from the script's JSON. */
export function parseMatches(stdout: string): OcrMatch[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (match): match is OcrMatch =>
      typeof match === 'object' &&
      match !== null &&
      typeof (match as OcrMatch).line === 'string' &&
      ['x', 'y', 'w', 'h'].every((key) => Number.isFinite((match as Record<string, unknown>)[key])),
  );
}
