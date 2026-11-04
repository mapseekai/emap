import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectGlyphPack } from './glyph-pack';
import { shardPath } from './protocol';

const assets = '3'.repeat(64);
const face = 'fonts/test.woff',
  own = 'font-' + '4'.repeat(64) + '.ttf';
const root = 'https://app.test/map/fonts/',
  sdk = 'https://cdn.test/msdf/';
const signal = () => new AbortController().signal;
const request = (url: string, id: number, range = 32) => ({
  font: url,
  id,
  range,
  key: JSON.stringify([url, id, range]),
});
function shard(file: string, id: number) {
  const metadata = new TextEncoder().encode(
    JSON.stringify({
      version: 2,
      assets,
      face: file,
      range: 32,
      start: Math.floor(id / 16) * 16,
      upem: 1000,
      glyphs: [{ id, width: 1, height: 1, plane: [0, 0, 1, 1], path: 'M0 0Z' }],
    }),
  );
  const bytes = new Uint8Array(4 + metadata.length + 3);
  new DataView(bytes.buffer).setUint32(0, metadata.length, true);
  bytes.set(metadata, 4);
  bytes.set([9, 6, 3], 4 + metadata.length);
  return bytes;
}
afterEach(() => vi.unstubAllGlobals());
describe('font catalog sharding', () => {
  it('shares concurrent transfers, isolates identical IDs per face, and falls back only for failed or uncovered requests', async () => {
    const report = vi.fn(),
      catalog = new ProjectGlyphPack(
        { url: 'fonts/manifest.json', report },
        'https://app.test/map/',
        new URL('../worker.js', sdk),
      );
    const bundled = request(sdk + face, 1),
      custom = request(root + own, 1);
    const pending = new AbortController(),
      body = Promise.withResolvers<Response>();
    const fetch = vi.fn(async (url: string) => {
      if (url === root + 'manifest.json')
        return new Response(
          JSON.stringify({
            version: 2,
            assets,
            ranges: [32],
            faces: { [face]: 3, [own]: 3 },
            defaultFont: { face: own, family: 'sans-serif', weight: 400 },
          }),
        );
      if (url === sdk + 'assets.sha256') return new Response(assets);
      if (url === root + shardPath(assets, own, 32, 0)) return body.promise;
      if (url === root + shardPath(assets, face, 32, 0)) return new Response(shard(own, 1)); // Wrong physical face for the URL.
      throw new Error('Unexpected download: ' + url);
    });
    vi.stubGlobal('fetch', fetch);
    try {
      const labels = [
        { font: { family: 'sans-serif', weight: 400 } },
        { font: { family: 'sans-serif', weight: 700 } },
      ];
      await catalog.ready(signal());
      for (const r of labels) r.font = catalog.selectFont(r.font);
      expect(labels.map((r) => r.font)).toEqual([
        { family: 'sans-serif', weight: 400, url: root + own },
        { family: 'sans-serif', weight: 700 },
      ]);
      const first = catalog.glyphs([custom], pending.signal);
      const second = catalog.glyphs([bundled, custom, request(root + own, 2, 64)], signal());
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
      pending.abort();
      await expect(first).rejects.toThrow();
      body.resolve(new Response(shard(own, 1)));
      const ready = await second;
      expect([...ready.keys()]).toEqual([custom.key]);
      expect([...ready.get(custom.key)!.data]).toEqual([9, 6, 3, 255]);
      expect((await catalog.glyphs([bundled], signal())).size).toBe(0);
      expect(fetch).toHaveBeenCalledTimes(4);
      expect(report).toHaveBeenCalledTimes(1);
    } finally {
      catalog.dispose();
    }
  });
  it('resolves both project faces and shards relative to the final manifest response', async () => {
    const final = 'https://cdn.test/releases/v2/';
    const catalog = new ProjectGlyphPack(
      { url: root + 'latest.json', report: vi.fn() },
      root,
      new URL('../worker.js', sdk),
    );
    const fetch = vi.fn(async (url: string) => {
      if (url === root + 'latest.json') {
        const res = new Response(
          JSON.stringify({
            version: 2,
            assets,
            ranges: [32],
            faces: { [own]: 3 },
            defaultFont: { face: own, family: 'sans-serif', weight: 400 },
          }),
        );
        Object.defineProperty(res, 'url', { value: final + 'manifest.json' });
        return res;
      }
      if (url === sdk + 'assets.sha256') return new Response(assets);
      if (url === final + shardPath(assets, own, 32, 0)) return new Response(shard(own, 1));
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    try {
      const labels = [{ font: { family: 'sans-serif', weight: 400 } }];
      await catalog.ready(signal());
      for (const r of labels) r.font = catalog.selectFont(r.font);
      expect(labels[0].font).toHaveProperty('url', final + own);
      const item = request(final + own, 1);
      expect((await catalog.glyphs([item], signal())).has(item.key)).toBe(true);
    } finally {
      catalog.dispose();
    }
  });

  it('bounds actual in-flight requests through layout cancellation and spends the shard wait budget only once per layout', async () => {
    vi.useFakeTimers();
    const catalog = new ProjectGlyphPack(
      { url: root + 'manifest.json', report: vi.fn() },
      root,
      new URL('../worker.js', sdk),
    );
    let active = 0,
      peak = 0;
    const started: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (url === root + 'manifest.json')
        return new Response(
          JSON.stringify({ version: 2, assets, ranges: [32], faces: { [face]: 1200 } }),
        );
      if (url === sdk + 'assets.sha256') return new Response(assets);
      started.push(url);
      peak = Math.max(peak, ++active);
      return new Promise<Response>((_, reject) =>
        init.signal!.addEventListener(
          'abort',
          () => {
            active--;
            reject(init.signal!.reason);
          },
          { once: true },
        ),
      );
    });
    const ids = (n: number, base: number) =>
      Array.from({ length: n }, (_, i) => request(sdk + face, (i + base) * 16 + 1));
    try {
      const obsolete = new AbortController(),
        current = signal();
      const first = catalog.glyphs(ids(13, 0), obsolete.signal);
      const cancelled = expect(first).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(0);
      expect(active).toBe(6);
      obsolete.abort();
      await cancelled;
      let result: Map<string, unknown> | undefined;
      const next = catalog.glyphs(ids(32, 14), current).then((r) => {
        result = r;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(peak).toBe(6);
      expect(started.some((url) => url.endsWith('/224-239.msdf'))).toBe(true);
      await vi.advanceTimersByTimeAsync(2100);
      expect(result?.size).toBe(0);
      await next;
      const downloads = started.length;
      expect((await catalog.glyphs(ids(13, 47), current)).size).toBe(0);
      expect(started).toHaveLength(downloads);
      expect(active).toBe(0);
    } finally {
      catalog.dispose();
      vi.useRealTimers();
    }
  });
  it('keeps finished shard results and can still read the cache after the layout deadline', async () => {
    vi.useFakeTimers();
    const report = vi.fn(),
      catalog = new ProjectGlyphPack(
        { url: root + 'manifest.json', report },
        root,
        new URL('../worker.js', sdk),
      );
    const warmed = request(sdk + face, 1),
      slow = request(sdk + face, 17),
      layout = signal();
    let downloads = 0;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (url === sdk + 'assets.sha256') return new Response(assets);
      if (url.endsWith('manifest.json'))
        return new Response(
          JSON.stringify({ version: 2, assets, ranges: [32], faces: { [face]: 32 } }),
        );
      downloads++;
      if (url.endsWith('/0-15.msdf')) return new Response(shard(face, 1));
      return new Promise<Response>((_, reject) =>
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }),
      );
    });
    try {
      const first = catalog.glyphs([warmed, slow], layout);
      await vi.advanceTimersByTimeAsync(2100);
      expect([...(await first).keys()]).toEqual([warmed.key]);
      expect([...(await catalog.glyphs([slow, warmed], layout)).keys()]).toEqual([warmed.key]);
      expect(downloads).toBe(2);
      expect(report).toHaveBeenCalledOnce();
    } finally {
      catalog.dispose();
      vi.useRealTimers();
    }
  });
  it('does not charge worker generation or atlas installation between batches to the network budget', async () => {
    vi.useFakeTimers();
    const catalog = new ProjectGlyphPack(
      { url: root + 'manifest.json', report: vi.fn() },
      root,
      new URL('../worker.js', sdk),
    );
    const layout = signal();
    vi.stubGlobal('fetch', async (url: string) => {
      if (url === sdk + 'assets.sha256') return new Response(assets);
      if (url.endsWith('manifest.json'))
        return new Response(
          JSON.stringify({ version: 2, assets, ranges: [32], faces: { [face]: 32 } }),
        );
      return new Response(shard(face, url.endsWith('/0-15.msdf') ? 1 : 17));
    });
    try {
      const first = request(sdk + face, 1),
        last = request(sdk + face, 17);
      expect((await catalog.glyphs([first], layout)).has(first.key)).toBe(true);
      await vi.advanceTimersByTimeAsync(5000);
      expect((await catalog.glyphs([last], layout)).has(last.key)).toBe(true);
    } finally {
      catalog.dispose();
      vi.useRealTimers();
    }
  });
});
