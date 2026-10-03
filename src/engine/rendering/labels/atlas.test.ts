// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { LabelAtlas } from './atlas';

it('keeps the displayed bitmap page intact while a later layout recycles its slot', () => {
  const contexts = new WeakMap<HTMLCanvasElement, any>();
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(function (this: HTMLCanvasElement) {
      let ctx = contexts.get(this);
      if (!ctx) {
        ctx = {
          measureText: () => ({ width: 800 }),
          save() {},
          restore() {},
          translate() {},
          scale() {},
          clearRect() {
            this.text = '';
          },
          strokeText() {},
          fillText(text: string) {
            this.text = text;
          },
          text: '',
        };
        contexts.set(this, ctx);
      }
      return ctx;
    } as any);
  const atlas = new LabelAtlas(document),
    options = { fontSize: 600, haloWidth: 0 };
  try {
    atlas.begin();
    const first = atlas.get('A', options, 1)!;
    for (const text of 'BCD') expect(atlas.get(text, options, 1)).not.toBeNull();
    expect(atlas.pageCount).toBe(4);
    atlas.begin();
    const next = atlas.get('E', options, 1)!;
    expect(next.page).not.toBe(first.page);
    expect(contexts.get(first.page.canvas).text).toBe('A');
    expect(contexts.get(next.page.canvas).text).toBe('E');
    expect(atlas.pageCount).toBe(4);
    atlas.dispose();
    expect(atlas.bytes).toBe(0);
  } finally {
    atlas.dispose();
    getContext.mockRestore();
  }
});

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
