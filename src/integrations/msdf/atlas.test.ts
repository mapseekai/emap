// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ShapeRequest, GlyphRequest } from './protocol';
const mock = vi.hoisted(() => ({ shape: vi.fn(), glyphs: vi.fn(), clear: vi.fn() }));
vi.mock('./client', () => ({
  MsdfClient: class {
    stats = { fontBytes: 100, fonts: 1, glyphsGenerated: 0, shapedRuns: 0, heapBytes: 100 };
    shape = mock.shape;
    glyphs = mock.glyphs;
    clear = mock.clear;
  },
}));
import { MsdfLabelAtlas } from './atlas';
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    canvas: document.createElement('canvas'),
    clearRect() {},
    fillRect() {},
    getImageData: () => ({ data: Uint8Array.from([1, 2, 3, 255]) }),
  } as any);
  mock.shape.mockReset().mockImplementation(async (requests: ShapeRequest[]) =>
    requests.map((r) => ({
      key: r.key,
      left: 0,
      top: -1,
      right: r.text.length,
      bottom: 0,
      missing: 0,
      glyphs: [...r.text].map((_, i) => ({
        font: 'http://localhost/font.woff',
        id: 65,
        x: i,
        y: 0,
      })),
    })),
  );
  mock.glyphs.mockReset().mockImplementation(async (requests: GlyphRequest[]) =>
    requests.map((r) => ({
      ...r,
      width: 4,
      height: 4,
      data: new Uint8Array(64).fill(128),
      plane: [-0.1, -1.1, 1.1, 0.1],
      emPixels: 48,
      path: 'M0 0L100 0L50 100Z',
      upem: 100,
    })),
  );
  mock.clear.mockClear();
});
afterEach(() => vi.restoreAllMocks());
const signal = () => new AbortController().signal;
describe('MSDF atlas ownership and reuse', () => {
  it('shares glyphs across strings, sizes, paint and DPR without rasterizing rejected candidates', async () => {
    const atlas = new MsdfLabelAtlas(new URL('http://localhost/worker.js'));
    try {
      const first = { text: 'AAA', options: { fontSize: 18, haloWidth: 1.5 } };
      atlas.begin();
      await atlas.prepare([first], signal());
      expect(mock.glyphs).not.toHaveBeenCalled();
      expect(atlas.bytes).toBe(0);
      atlas.reserve(first.text, first.options);
      await atlas.prepareGlyphs([first], signal());
      expect(mock.glyphs.mock.calls[0][0]).toHaveLength(1);
      const a = atlas.get(first.text, first.options, 1)!;
      expect(a.glyphs).toHaveLength(3);
      const page = a.glyphs[0].page,
        version = page.version;
      const next = { text: 'AAA', options: { fontSize: 48, haloWidth: 3, color: '#ff0000' } };
      atlas.begin();
      await atlas.prepare([next], signal());
      atlas.reserve(next.text, next.options);
      await atlas.prepareGlyphs([next], signal());
      const b = atlas.get(next.text, next.options, 2)!;
      expect(mock.shape).toHaveBeenCalledOnce();
      expect(mock.glyphs).toHaveBeenCalledOnce();
      expect(b.glyphs[0].page).toBe(page);
      expect(page.version).toBe(version);
      expect(b.width).toBeGreaterThan(a.width);
      expect(atlas.diagnostics.glyphCount).toBe(1);
    } finally {
      atlas.dispose();
    }
    expect(atlas.bytes).toBe(0);
    expect(mock.clear).toHaveBeenCalled();
  });
  it('only adds a distance-range tier when a halo would otherwise be clipped', async () => {
    const atlas = new MsdfLabelAtlas(new URL('http://localhost/worker.js'));
    try {
      for (const haloWidth of [1, 12]) {
        const r = { text: 'A', options: { fontSize: 6, haloWidth } };
        atlas.begin();
        await atlas.prepare([r], signal());
        atlas.reserve(r.text, r.options);
        await atlas.prepareGlyphs([r], signal());
      }
      expect(mock.glyphs).toHaveBeenCalledTimes(2);
      expect(mock.glyphs.mock.calls[1][0][0].range).toBe(256);
    } finally {
      atlas.dispose();
    }
  });
  it('rejects unknown system-font outlines and non-fetchable URLs explicitly', async () => {
    const atlas = new MsdfLabelAtlas(new URL('http://localhost/worker.js'));
    try {
      await expect(
        atlas.prepare([{ text: 'A', options: { fontFamily: 'Unregistered Font' } }], signal()),
      ).rejects.toThrow('fontUrl');
      await expect(
        atlas.prepare([{ text: 'A', options: { fontUrl: 'javascript:alert(1)' } }], signal()),
      ).rejects.toThrow('HTTP');
    } finally {
      atlas.dispose();
    }
  });
});
