import { PerspectiveTransform } from '../../src/domain/geo/perspective-transform';
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastNavPreview } from '../../packages/examples/src/luma-benchmark/fast-nav';
import { AffineTransform } from '../../src/domain/geo/transform';

describe('luma snapshot navigation lifecycle', () => {
  let nav: FastNavPreview, source: HTMLCanvasElement, redraw: ReturnType<typeof vi.fn<() => void>>;
  let resolve: (b: ImageBitmap) => void;
  const bitmap = () => ({ width: 400, height: 200, close: vi.fn() }) as unknown as ImageBitmap;
  beforeEach(() => {
    vi.useFakeTimers();
    const stage = document.createElement('div');
    document.body.append(stage);
    source = document.createElement('canvas');
    source.style.width = '400px';
    source.style.height = '200px';
    stage.append(source);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as any);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(
        () =>
          new Promise<ImageBitmap>((r) => {
            resolve = r;
          }),
      ),
    );
    redraw = vi.fn();
    nav = new FastNavPreview(stage, redraw);
  });
  afterEach(() => {
    nav.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.replaceChildren();
  });
  async function ready() {
    nav.preview(new AffineTransform(), 'a');
    nav.record(source, new AffineTransform(), 'a', 5);
    resolve(bitmap());
    await Promise.resolve();
  }
  it('reuses one captured frame during gestures and requests one deferred full redraw', async () => {
    await ready();
    nav.setInteracting(true);
    expect(nav.preview(new AffineTransform(2, 2, 5, 8), 'a')).toBe(true);
    expect(nav.canvas.style.transform).toContain('translate(5px,8px) scale(2,2)');
    expect(source.style.visibility).toBe('hidden');
    for (let i = 0; i < 5; i++) nav.preview(new AffineTransform(2, 2, 5 + i, 8), 'a');
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    nav.setInteracting(false);
    await vi.advanceTimersByTimeAsync(160);
    expect(redraw).toHaveBeenCalledTimes(1);
    expect(nav.preview(new AffineTransform(2, 2, 9, 8), 'a')).toBe(false);
    nav.record(source, new AffineTransform(2, 2, 9, 8), 'a', 10);
    resolve(bitmap());
    await Promise.resolve();
    expect(nav.stats.active).toBe(false);
    expect(nav.stats.pending).toBe(false);
    expect(source.style.visibility).toBe('');
  });
  it('never displays a capture after resize/data invalidation or disposal', async () => {
    nav.preview(new AffineTransform(), 'a');
    nav.record(source, new AffineTransform(), 'a', 1);
    const b = bitmap();
    nav.reset();
    resolve(b);
    await Promise.resolve();
    expect(b.close).toHaveBeenCalledOnce();
    expect(nav.stats.ready).toBe(false);
  });
  it('rebases the newest gesture when an older full frame finishes', async () => {
    await ready();
    nav.setInteracting(true);
    nav.preview(new AffineTransform(1, 1, 10, 0), 'a');
    nav.setInteracting(false);
    await vi.advanceTimersByTimeAsync(160);
    nav.preview(new AffineTransform(1, 1, 10, 0), 'a');
    nav.record(source, new AffineTransform(1, 1, 10, 0), 'a', 2);
    nav.setInteracting(true);
    expect(nav.preview(new AffineTransform(1, 1, 25, 0), 'a')).toBe(true);
    resolve(bitmap());
    await Promise.resolve();
    expect(nav.canvas.style.transform).toContain('translate(15px,0px)');
    expect(nav.stats.frame?.bx).toBe(10);
  });
  it('notifies settle even if interaction end precedes the queued navigation frame', async () => {
    await ready();
    nav.setInteracting(true);
    nav.setInteracting(false);
    nav.preview(new AffineTransform(1, 1, 20, 0), 'a');
    await vi.advanceTimersByTimeAsync(160);
    expect(redraw).toHaveBeenCalledTimes(1);
  });
  it('redraws content that changed while a same-view snapshot was in flight', async () => {
    nav.preview(new AffineTransform(), 'a');
    nav.record(source, new AffineTransform(), 'a', 1);
    nav.invalidateFrame();
    resolve(bitmap());
    await vi.advanceTimersByTimeAsync(160);
    expect(nav.stats.pending).toBe(true);
    expect(redraw).toHaveBeenCalledTimes(1);
    expect(nav.preview(new AffineTransform(), 'a')).toBe(false);
    nav.record(source, new AffineTransform(), 'a', 1);
    resolve(bitmap());
    await vi.advanceTimersByTimeAsync(0);
    expect(nav.stats.pending).toBe(false);
  });
  it('does not publish a lazy bitmap before the GPU completion barrier', async () => {
    let finish!: () => void;
    const done = new Promise<void>((r) => (finish = r));
    nav.preview(new AffineTransform(), 'a');
    nav.record(source, new AffineTransform(), 'a', 2, done);
    resolve(bitmap());
    await Promise.resolve();
    expect(nav.stats.ready).toBe(false);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(nav.stats.ready).toBe(true);
  });
  it('closes a bitmap that arrives after a failed completion barrier', async () => {
    let reject!: (e: Error) => void;
    const done = new Promise<void>((_, r) => (reject = r));
    nav.preview(new AffineTransform(), 'a');
    nav.record(source, new AffineTransform(), 'a', 2, done);
    reject(new Error('device lost'));
    await vi.advanceTimersByTimeAsync(0);
    const b = bitmap();
    resolve(b);
    await vi.advanceTimersByTimeAsync(0);
    expect(b.close).toHaveBeenCalledOnce();
    expect(nav.stats.captureErrors).toBe(1);
  });
  it('disabling restores the live surface and cancels pending settle', async () => {
    await ready();
    nav.setInteracting(true);
    nav.preview(new AffineTransform(1, 1, 20, 0), 'a');
    nav.setInteracting(false);
    nav.setEnabled(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(redraw).not.toHaveBeenCalled();
    expect(source.style.visibility).toBe('');
    expect(nav.canvas.hidden).toBe(true);
    expect(nav.canCapture).toBe(false);
  });
  it('tracks a bearing-only change and reprojects a cached ground frame in perspective', async () => {
    const frame = new PerspectiveTransform(new AffineTransform(2, -2, 50, 100), 400, 200, {
      pitch: 45,
      bearing: 0,
    });
    nav.preview(frame, 'a');
    nav.record(source, frame, 'a', 5);
    resolve(bitmap());
    await Promise.resolve();
    nav.setInteracting(true);
    const view = frame.clone().setOrientation({ bearing: 20 });
    expect(nav.preview(view, 'a')).toBe(true);
    expect(nav.canvas.style.transform.startsWith('matrix3d(')).toBe(true);
    const m = nav.canvas.style.transform.slice(9, -1).split(',').map(Number);
    for (const [x, y] of [
      [0, 0],
      [200, 100],
      [400, 200],
      [45, 127],
    ]) {
      const w = m[3] * x + m[7] * y + m[15],
        expected = view.project(...frame.unproject(x, y));
      expect((m[0] * x + m[4] * y + m[12]) / w).toBeCloseTo(expected[0], 6);
      expect((m[1] * x + m[5] * y + m[13]) / w).toBeCloseTo(expected[1], 6);
    }
    nav.setInteracting(false);
    await vi.advanceTimersByTimeAsync(160);
    expect(redraw).toHaveBeenCalledOnce();
    expect(nav.preview(view, 'a')).toBe(false);
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
  });
});
