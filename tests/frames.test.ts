import { describe, expect, it } from 'vitest';
import { displayGeometry, FrameRegistry } from '../src/main/computer/frames';

const DISPLAY = 1;
const SHAPE = displayGeometry({ x: 0, y: 0, width: 1728, height: 1117 }, 2);
const OTHER_SHAPE = displayGeometry({ x: 0, y: 0, width: 1512, height: 982 }, 2);

function capture(hash: string, geometry = SHAPE) {
  return { displayId: DISPLAY, geometry, width: 1280, height: 800, hash };
}

describe('displayGeometry', () => {
  it('changes when the display is resized or rescaled', () => {
    const bounds = { x: 0, y: 0, width: 1728, height: 1117 };
    expect(displayGeometry(bounds, 2)).not.toBe(displayGeometry(bounds, 1));
    expect(displayGeometry(bounds, 2)).not.toBe(displayGeometry({ ...bounds, width: 1512 }, 2));
    expect(displayGeometry(bounds, 2)).toBe(displayGeometry({ ...bounds }, 2));
  });
});

describe('minting frames', () => {
  it('gives each new screen its own frameId', () => {
    const frames = new FrameRegistry();
    const first = frames.mint(capture('aaa'));
    const second = frames.mint(capture('bbb'));
    expect(first.unchanged).toBe(false);
    expect(second.unchanged).toBe(false);
    expect(second.frame.frameId).not.toBe(first.frame.frameId);
    expect(frames.latest(DISPLAY)?.frameId).toBe(second.frame.frameId);
  });

  it('keeps the previous frameId when the screen is identical', () => {
    // Re-minting would invalidate coordinates the model already holds, for a
    // screen that looks exactly the same.
    const frames = new FrameRegistry();
    const first = frames.mint(capture('aaa'));
    const again = frames.mint(capture('aaa'));
    expect(again.unchanged).toBe(true);
    expect(again.frame.frameId).toBe(first.frame.frameId);
  });

  it('treats an identical image on a reshaped display as a new frame', () => {
    const frames = new FrameRegistry();
    frames.mint(capture('aaa'));
    const reshaped = frames.mint(capture('aaa', OTHER_SHAPE));
    expect(reshaped.unchanged).toBe(false);
  });

  it('tracks each display separately', () => {
    const frames = new FrameRegistry();
    const one = frames.mint(capture('aaa'));
    const two = frames.mint({ ...capture('bbb'), displayId: 2 });
    expect(frames.latest(DISPLAY)?.frameId).toBe(one.frame.frameId);
    expect(frames.latest(2)?.frameId).toBe(two.frame.frameId);
  });

  it('records the delivered image size, which coordinates are measured in', () => {
    const frames = new FrameRegistry();
    const { frame } = frames.mint(capture('aaa'));
    expect(frame.width).toBe(1280);
    expect(frame.height).toBe(800);
  });
});

describe('checking a frame before acting on coordinates', () => {
  it('accepts the latest frame for that display', () => {
    const frames = new FrameRegistry();
    const { frame } = frames.mint(capture('aaa'));
    expect(frames.check(frame.frameId, DISPLAY, SHAPE)).toBeNull();
  });

  it('refuses a superseded frame with STALE_FRAME', () => {
    const frames = new FrameRegistry();
    const old = frames.mint(capture('aaa'));
    const fresh = frames.mint(capture('bbb'));
    const error = frames.check(old.frame.frameId, DISPLAY, SHAPE);
    expect(error?.code).toBe('STALE_FRAME');
    expect(error?.detail).toContain(fresh.frame.frameId);
    expect(error?.hint).toBeTruthy();
  });

  it('still accepts the frame after an unchanged capture', () => {
    // The image was not resent, so the model's frameId must stay valid.
    const frames = new FrameRegistry();
    const { frame } = frames.mint(capture('aaa'));
    frames.mint(capture('aaa'));
    expect(frames.check(frame.frameId, DISPLAY, SHAPE)).toBeNull();
  });

  it('refuses a frame whose display has changed shape since capture', () => {
    const frames = new FrameRegistry();
    const { frame } = frames.mint(capture('aaa'));
    const error = frames.check(frame.frameId, DISPLAY, OTHER_SHAPE);
    expect(error?.code).toBe('STALE_FRAME');
    expect(error?.detail).toContain('changed shape');
  });

  it('refuses a missing or malformed frame_id as INVALID_REQUEST', () => {
    const frames = new FrameRegistry();
    const { frame } = frames.mint(capture('aaa'));
    for (const value of [undefined, null, '', 42, {}]) {
      const error = frames.check(value, DISPLAY, SHAPE);
      expect(error?.code, String(value)).toBe('INVALID_REQUEST');
      // The correction is spelled out, so the model resends in one turn
      // instead of looping through screenshots.
      expect(error?.detail).toContain(`"frame_id": "${frame.frameId}"`);
    }
  });

  it('refuses any frame before the first screenshot', () => {
    const frames = new FrameRegistry();
    expect(frames.check('f1', DISPLAY, SHAPE)?.code).toBe('STALE_FRAME');
    expect(frames.latest(DISPLAY)).toBeNull();
  });

  it('refuses a frame from another display', () => {
    const frames = new FrameRegistry();
    const { frame } = frames.mint(capture('aaa'));
    expect(frames.check(frame.frameId, 2, SHAPE)?.code).toBe('STALE_FRAME');
  });
});
