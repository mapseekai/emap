// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { EditorBackdrop } from '../../packages/examples/src/luma-editor/backdrop';
import { AffineTransform } from '../../src/domain/geo/transform';
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const gpu = {
      begin: vi.fn(() => true),
      drawImage: vi.fn(),
      end: vi.fn(),
      waitForIdle: vi.fn(async () => {}),
      forgetImage: vi.fn(),
    },
    canvas = document.createElement('canvas');
  const invalid = vi.fn(),
    base = vi.fn((overlay?: () => void) => {
      overlay?.();
      return 1;
    }),
    overlay = vi.fn(),
    backdrop = new EditorBackdrop(gpu as any, canvas, invalid);
  const bitmap = { width: 200, height: 100, close: vi.fn() };
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => bitmap),
  );
  return { gpu, backdrop, invalid, base, overlay, bitmap };
}
const view = new AffineTransform(1, -1, 0, 100);
describe('separate base bitmap and live original edit overlay', () => {
  it('captures only the base and reuses it for subsequent original handle frames', async () => {
    const { backdrop, base, overlay, gpu } = fixture();
    backdrop.draw('a', view, 200, 100, true, base, overlay);
    expect(base).toHaveBeenNthCalledWith(1);
    expect(base).toHaveBeenNthCalledWith(2, overlay);
    await vi.waitFor(() => expect(backdrop.stats.captures).toBe(1));
    base.mockClear();
    overlay.mockClear();
    backdrop.draw('a', view, 200, 100, true, base, overlay);
    expect(base).not.toHaveBeenCalled();
    expect(gpu.drawImage).toHaveBeenCalledOnce();
    expect(overlay).toHaveBeenCalledOnce();
    backdrop.dispose();
    expect(gpu.forgetImage).toHaveBeenCalledOnce();
  });
  it('holds the previous base while new fill geometry is pending, but draws new overlay every time', async () => {
    const { backdrop, base, overlay } = fixture();
    backdrop.draw('old', view, 200, 100, true, base, overlay);
    await vi.waitFor(() => expect(backdrop.stats.captures).toBe(1));
    base.mockClear();
    overlay.mockClear();
    backdrop.draw('new', view, 200, 100, false, base, overlay);
    expect(base).not.toHaveBeenCalled();
    expect(overlay).toHaveBeenCalledOnce();
    backdrop.dispose();
  });
  it('closes stale captures on clear/disposal and cannot resurrect the old scene', async () => {
    const { backdrop, base, overlay, bitmap } = fixture();
    let finish!: (x: any) => void;
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => new Promise((r) => (finish = r))),
    );
    backdrop.draw('old', view, 200, 100, true, base, overlay);
    backdrop.dispose();
    finish(bitmap);
    await vi.waitFor(() => expect(bitmap.close).toHaveBeenCalledOnce());
    expect(backdrop.stats.snapshotBytes).toBe(0);
  });
  it('uses normal geometry rendering after a capture failure without retry loops', async () => {
    const { backdrop, base, overlay } = fixture();
    const capture = vi.fn(() => {
      throw new Error('unsupported');
    });
    vi.stubGlobal('createImageBitmap', capture);
    backdrop.draw('a', view, 200, 100, true, base, overlay);
    await new Promise((r) => setTimeout(r, 0));
    backdrop.draw('a', view, 200, 100, true, base, overlay);
    expect(capture).toHaveBeenCalledOnce();
    backdrop.dispose();
  });
});
