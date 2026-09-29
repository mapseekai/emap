// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { LabelAtlas } from './atlas';

it('reuses cached text without measuring, but invalidates paint, DPR, fonts and cleared pages', () => {
  const ctx = {
    measureText: vi.fn(() => ({ width: 20 })),
    save() {},
    restore() {},
    translate() {},
    scale() {},
    clearRect() {},
    strokeText() {},
    fillText() {},
  };
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(ctx as any);
  const atlas = new LabelAtlas(document);
  try {
    const raster = atlas.get('text', {}, 1);
    ctx.measureText.mockClear();
    expect(atlas.get('text', {}, 1)).toBe(raster);
    expect(ctx.measureText).not.toHaveBeenCalled();
    for (const [options, dpr] of [
      [{ color: 'red' }, 1],
      [{ fontFamily: 'serif' }, 1],
      [{}, 2],
    ] as const)
      expect(atlas.get('text', options, dpr)).not.toBe(raster);
    atlas.clear();
    expect(atlas.get('text', {}, 1)).not.toBe(raster);
    expect(ctx.measureText).toHaveBeenCalledTimes(4);
  } finally {
    atlas.dispose();
    getContext.mockRestore();
  }
});
