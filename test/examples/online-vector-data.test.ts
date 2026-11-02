// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { examples } from '../../docs-meta/examples';

const topojson = 'https://geojson.cn/api/china/1.6.3/china.topo.json';
const geojson = 'https://geojson.cn/api/china/1.6.3/china.json';
const shapefile =
  'https://naturalearth.s3.amazonaws.com/110m_cultural/ne_110m_admin_0_countries.zip';

async function openExample() {
  const html = await readFile(
    resolve('packages/examples/examples/online-vector-data/index.html'),
    'utf8',
  );
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const script = parsed
    .querySelector<HTMLScriptElement>('script[type="module"]')
    ?.textContent?.replace(/^\s*import\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];\s*$/gm, '');
  if (!script) throw new Error('Online data example has no module script');
  const oldHead = document.head.innerHTML;
  const oldBody = document.body.innerHTML;
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  const calls: string[] = [];
  const failed = new Set<string>();
  const sources = new Map<string, FakeSource>();
  const options: unknown[] = [];
  class FakeSource {
    constructor(readonly id: string) {}
    static async fromUrl(id: string, url: string) {
      calls.push(url);
      if (failed.has(url)) throw new Error('HTTP 503');
      return new FakeSource(id);
    }
    getExtent() {
      return [73, 18, 135, 54];
    }
  }
  const map = {
    addControl: vi.fn(),
    addSource: vi.fn(async (id: string, source: FakeSource) => {
      sources.set(id, source);
    }),
    removeSource: vi.fn((id: string) => {
      sources.delete(id);
    }),
    setExtent: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(async () => {}),
  };
  const runtime = {
    Emap: class {
      static async create(value: unknown) {
        options.push(value);
        return map;
      }
    },
    TopologySource: FakeSource,
    NavigationControl: class {},
  };
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction(
      'getExampleRenderer',
      'installExampleMapUi',
      'loadExampleRuntime',
      script,
    )(
      () => 'canvas2d',
      async () => {},
      async () => runtime,
    );
  } catch (error) {
    document.head.innerHTML = oldHead;
    document.body.innerHTML = oldBody;
    throw error;
  }
  return {
    calls,
    failed,
    sources,
    options,
    map,
    dispose() {
      document.head.innerHTML = oldHead;
      document.body.innerHTML = oldBody;
    },
  };
}

describe('online vector data example', () => {
  it('loads China TopoJSON in the viewer preset without edit controls', async () => {
    const result = await openExample();
    try {
      expect(result.calls).toEqual([topojson]);
      expect(result.options).toEqual([expect.objectContaining({ preset: 'viewer' })]);
      expect(result.map.addControl).toHaveBeenCalledTimes(1);
      expect(result.sources.size).toBe(1);
      expect(document.querySelector('#status')?.textContent).toContain('已加载');
      expect(examples.find((example) => example.id === 'online-vector-data')).toMatchObject({
        category: 'data-layers',
        api: ['TopologySource.fromUrl'],
        fixtures: [],
      });
    } finally {
      result.dispose();
    }
  });
  it('switches between online GeoJSON and Shapefile ZIP', async () => {
    const result = await openExample();
    try {
      const selector = document.querySelector<HTMLSelectElement>('#online-source')!;
      for (const [kind, url] of [
        ['geojson', geojson],
        ['shapefile', shapefile],
      ] as const) {
        selector.value = kind;
        selector.dispatchEvent(new Event('change', { bubbles: true }));
        await vi.waitFor(() =>
          expect(document.querySelector('#status')?.textContent).toContain('已加载'),
        );
        expect(result.calls.at(-1)).toBe(url);
        expect(result.sources.size).toBe(1);
      }
      expect(result.map.removeSource).toHaveBeenCalledTimes(2);
    } finally {
      result.dispose();
    }
  });
  it('keeps the current map if an online load fails and allows a custom URL retry', async () => {
    const result = await openExample();
    try {
      const initialSource = [...result.sources.values()][0];
      result.failed.add(geojson);
      const selector = document.querySelector<HTMLSelectElement>('#online-source')!;
      selector.value = 'geojson';
      selector.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() =>
        expect(document.querySelector('#status')?.textContent).toContain('503'),
      );
      expect([...result.sources.values()]).toEqual([initialSource]);
      expect(result.map.removeSource).not.toHaveBeenCalled();
      const input = document.querySelector<HTMLInputElement>('#source-url')!;
      input.value = 'https://example.test/custom.geojson';
      document.querySelector<HTMLButtonElement>('#load-data')!.click();
      await vi.waitFor(() =>
        expect(document.querySelector('#status')?.textContent).toContain('已加载'),
      );
      expect(result.calls.at(-1)).toBe('https://example.test/custom.geojson');
      expect(result.sources.size).toBe(1);
    } finally {
      result.dispose();
    }
  });
  it('rejects non-HTTP URLs without replacing data', async () => {
    const result = await openExample();
    try {
      document.querySelector<HTMLInputElement>('#source-url')!.value =
        'ftp://example.test/data.json';
      document.querySelector<HTMLButtonElement>('#load-data')!.click();
      await vi.waitFor(() =>
        expect(document.querySelector('#status')?.textContent).toContain('HTTP 或 HTTPS'),
      );
      expect(result.calls).toEqual([topojson]);
      expect(result.sources.size).toBe(1);
    } finally {
      result.dispose();
    }
  });
});
