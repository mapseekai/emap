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
  it('loads only the shaped ID ranges of unseen names and decodes the same pixels as msdfgen', async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const { MsdfFontEngine } = await import('./font-engine');
    const { GLYPHS_PER_SHARD, shardPath } = await import('./protocol');
    const root = 'packages/examples/public/glyphs/noto-sans-sc/';
    const sdk = 'https://cdn.test/msdf/';
    const engine = await MsdfFontEngine.create(sdk, async (url) => {
      const file = await readFile(
        new URL(String(url).slice(sdk.length), pathToFileURL(resolve('dist/msdf') + '/')),
      );
      return new Uint8Array(file).buffer;
    });
    const report = vi.fn(),
      loads: string[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      loads.push(path);
      return new Response(
        new Uint8Array(
          await readFile(
            path.endsWith('/assets.sha256')
              ? 'dist/msdf/assets.sha256'
              : root + path.slice('/project/'.length),
          ),
        ),
      );
    });
    mock.shape.mockImplementation(async (rs: ShapeRequest[]) =>
      Promise.all(rs.map((r) => engine.shape(r, signal()))),
    );
    const { createEmapWorkerRuntime } = await import('../tasklane/runtime');
    const runtime = createEmapWorkerRuntime({
      urls: { msdf: 'https://cdn.test/custom-worker.js' },
    });
    const atlas = new MsdfLabelAtlas(new URL('https://sdk.test/worker.js'), document, runtime, {
      url: 'https://app.test/project/manifest.json',
      report,
    });
    try {
      const first = { text: '消防泵房 P2 · ffi', options: {} };
      const req = { text: first.text, key: 'truth', font: { family: 'sans-serif', weight: 400 } };
      const shape = await engine.shape(req, signal());
      expect(shape.missing).toBe(0);
      const { assets } = JSON.parse(await readFile(root + 'manifest.json', 'utf8'));
      const expected = new Set(
        shape.glyphs.map(
          (g) =>
            '/project/' +
            shardPath(
              assets,
              g.font.slice(sdk.length),
              32,
              Math.floor(g.id / GLYPHS_PER_SHARD) * GLYPHS_PER_SHARD,
            ),
        ),
      );
      await atlas.prepare([first], signal());
      await atlas.prepareGlyphs([first], signal());
      expect(loads.filter((p) => p.endsWith('.msdf')).sort()).toEqual([...expected].sort());
      const raster = atlas.get(first.text, {}, 1);
      if (!raster || !('glyphs' in raster)) throw new Error('Expected MSDF quads');
      for (const [i, q] of raster.glyphs.entries()) {
        const g = shape.glyphs[i],
          oracle = await engine.glyph({ ...g, range: 32, key: '' }, signal());
        const [x, y, w, h] = q.rect;
        expect([w, h, q.path]).toEqual([oracle.width, oracle.height, oracle.path]);
        const pixels = new Uint8Array(w * h * 4);
        for (let row = 0; row < h; row++)
          pixels.set(
            q.page.data.subarray(
              ((row + y) * q.page.width + x) * 4,
              ((row + y) * q.page.width + x + w) * 4,
            ),
            row * w * 4,
          );
        expect(Buffer.compare(pixels, oracle.data)).toBe(0);
      }
      const calls = fetch.mock.calls.length;
      const next = { text: 'P2 消防泵房 ffi', options: {} };
      await atlas.prepare([next], signal());
      await atlas.prepareGlyphs([next], signal());
      expect(atlas.get(next.text, {}, 2)).toBeTruthy();
      expect(fetch.mock.calls.length).toBe(calls);
      expect(mock.glyphs).not.toHaveBeenCalled();
      expect(report).not.toHaveBeenCalled();
    } finally {
      atlas.dispose();
      await runtime.dispose();
      engine.dispose();
    }
  });
  it('recovers a transient manifest error and uses the same native font metrics as an explicit URL', async () => {
    const stamp = '3'.repeat(64),
      own = 'font-' + '4'.repeat(64) + '.otf',
      base = 'https://app.test/fonts/';
    let manifestReads = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('assets.sha256')) return new Response(stamp);
      if (String(url) === base + 'manifest.json') {
        if (++manifestReads === 1) return new Response(null, { status: 503 });
        return new Response(
          JSON.stringify({
            version: 2,
            assets: stamp,
            ranges: [32],
            faces: { [own]: 3 },
            defaultFont: { family: 'sans-serif', weight: 400, face: own },
          }),
        );
      }
      return new Response(null, { status: 404 });
    });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const atlas = new MsdfLabelAtlas(new URL('https://cdn.test/worker.js'), document, undefined, {
      url: base + 'manifest.json',
      report: vi.fn(),
    });
    const text = 'Office P3',
      options = { fontStyle: 'italic' as const };
    try {
      await atlas.prepare([{ text, options }], signal());
      expect(mock.shape.mock.calls[0][0][0].font.url).toBeUndefined();
      clock.mockReturnValue(62000);
      const run = signal();
      await atlas.prepare([{ text, options }], run);
      expect(mock.shape).toHaveBeenCalledTimes(2);
      expect(mock.shape.mock.calls[1][0][0].font.url).toBe(base + own);
      const explicit = { ...options, fontUrl: base + own };
      await atlas.prepare([{ text, options: explicit }], run);
      await atlas.prepareGlyphs([{ text, options }], run);
      const inherited = atlas.get(text, options, 1),
        direct = atlas.get(text, explicit, 1);
      expect(inherited).toMatchObject({ shear: 0 });
      expect(inherited?.width).toBe(direct?.width);
      expect(atlas.get(text, explicit, 1)).toBeTruthy();
    } finally {
      atlas.dispose();
    }
  });
  it.each([
    'missing',
    'corrupt',
    'stale',
  ])('reports one %s manifest and keeps labels visible', async (kind) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('assets.sha256')) return new Response('0'.repeat(64));
      if (kind === 'missing') return new Response(null, { status: 404 });
      return new Response(
        kind === 'corrupt'
          ? '{'
          : JSON.stringify({ version: 2, assets: '1'.repeat(64), ranges: [32], faces: {} }),
      );
    });
    const report = vi.fn(),
      atlas = new MsdfLabelAtlas(new URL('https://cdn.test/worker.js'), document, undefined, {
        url: 'https://app.test/manifest.json',
        report,
      });
    try {
      for (const text of ['A', 'B']) {
        const labels = [{ text, options: {} }];
        await atlas.prepare(labels, signal());
        await atlas.prepareGlyphs(labels, signal());
        expect(atlas.get(text, {}, 1)).toBeTruthy();
      }
      expect(report).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      atlas.dispose();
    }
  });
  it('cancels a layout without cancelling the shared download, and releases it on dispose', async () => {
    let downloadSignal: AbortSignal | null | undefined;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      downloadSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) =>
        downloadSignal?.addEventListener('abort', () => reject(downloadSignal?.reason), {
          once: true,
        }),
      );
    });
    const report = vi.fn(),
      atlas = new MsdfLabelAtlas(new URL('https://cdn.test/worker.js'), document, undefined, {
        url: 'https://app.test/manifest.json',
        report,
      });
    const first = new AbortController(),
      second = new AbortController();
    const labels = [{ text: '北站', options: {} }];
    const initial = atlas.prepare(labels, first.signal);
    first.abort();
    await expect(initial).rejects.toThrow();
    const next = atlas.prepare(labels, second.signal);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(downloadSignal?.aborted).toBe(false);
    atlas.dispose();
    await expect(next).rejects.toThrow();
    expect(downloadSignal?.aborted).toBe(true);
    expect(report).not.toHaveBeenCalled();
    expect(mock.shape).not.toHaveBeenCalled();
  });
  it('keeps a displayed page immutable when the next layout recycles its atlas slot', async () => {
    mock.shape.mockImplementation(async (requests: ShapeRequest[]) =>
      requests.map((r) => ({
        key: r.key,
        left: 0,
        top: -1,
        right: 1,
        bottom: 0,
        missing: 0,
        glyphs: [{ font: 'http://localhost/font.woff', id: r.text.charCodeAt(0), x: 0, y: 0 }],
      })),
    );
    mock.glyphs.mockImplementation(async (requests: GlyphRequest[]) =>
      requests.map((r) => ({
        ...r,
        width: 512,
        height: 512,
        data: new Uint8Array(512 * 512 * 4).fill(r.id),
        plane: [0, -1, 1, 0],
        emPixels: 48,
        path: '',
        upem: 100,
      })),
    );
    const atlas = new MsdfLabelAtlas(new URL('http://localhost/worker.js'));
    try {
      const first = [...'ABCD'].map((text) => ({ text, options: {} }));
      atlas.begin();
      await atlas.prepare(first, signal());
      await atlas.prepareGlyphs(first, signal());
      const raster = atlas.get('A', {}, 1);
      if (!raster || !('glyphs' in raster)) throw new Error('Expected MSDF glyph raster');
      const old = raster.glyphs[0].page;
      for (const text of 'BCD') atlas.get(text, {}, 1);
      const data = old.data.slice(4100, 4116);
      const version = old.version,
        generation = old.generation;
      atlas.begin();
      const next = [{ text: 'E', options: {} }];
      await atlas.prepare(next, signal());
      await atlas.prepareGlyphs(next, signal());
      expect(atlas.pageCount).toBe(4);
      expect(old.data.slice(4100, 4116)).toEqual(data);
      expect(old.version).toBe(version);
      expect(old.generation).toBe(generation);
      const nextRaster = atlas.get('E', {}, 1);
      if (!nextRaster || !('glyphs' in nextRaster)) throw new Error('Expected MSDF glyph raster');
      expect(nextRaster.glyphs[0].page).not.toBe(old);
    } finally {
      atlas.dispose();
    }
  });
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
      const a = atlas.get(first.text, first.options, 1);
      if (!a || !('glyphs' in a)) throw new Error('Expected MSDF glyph raster');
      expect(a.glyphs).toHaveLength(3);
      const page = a.glyphs[0].page,
        version = page.version;
      const next = { text: 'AAA', options: { fontSize: 48, haloWidth: 3, color: '#ff0000' } };
      atlas.begin();
      await atlas.prepare([next], signal());
      atlas.reserve(next.text, next.options);
      await atlas.prepareGlyphs([next], signal());
      const b = atlas.get(next.text, next.options, 2);
      if (!b || !('glyphs' in b)) throw new Error('Expected MSDF glyph raster');
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
