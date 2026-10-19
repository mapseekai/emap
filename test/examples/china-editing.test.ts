import { getExampleRenderer } from '../../packages/examples/src/renderer-choice';
// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { examples } from '../../docs-meta/examples';
const TOPOJSON_URL = 'https://geojson.cn/api/china/1.6.3/china.topo.json';
const GEOJSON_URL = 'https://geojson.cn/api/china/1.6.3/china.json';
type SourceInput = {
  filename: string;
  content: Uint8Array;
};
async function executeChinaEditingExample() {
  const html = await readFile(
    resolve('packages/examples/examples/china-editing/index.html'),
    'utf8',
  );
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const moduleScript = parsed.querySelector<HTMLScriptElement>('script[type="module"]');
  if (!moduleScript?.textContent) throw new Error('china-editing module script is missing');
  const script = moduleScript.textContent.replace(
    /^\s*import\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];\s*$/gm,
    '',
  );
  const originalHead = document.head.innerHTML;
  const originalBody = document.body.innerHTML;
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  const requests: string[] = [];
  const failedUrls = new Set<string>();
  const sourceInputs: SourceInput[] = [];
  const sources = new Map<string, FakeTopologySource>();
  const removedSourceIds: string[] = [];
  class FakeTopologySource {
    readonly id: string;
    constructor(id: string) {
      this.id = id;
    }
    async setData(input: SourceInput): Promise<void> {
      sourceInputs.push(input);
    }
    getExtent(): [number, number, number, number] {
      return [73, 18, 135, 54];
    }
  }
  const map = {
    addControl: vi.fn(),
    addSource: vi.fn(async (id: string, source: FakeTopologySource) => {
      sources.set(id, source);
    }),
    removeSource: vi.fn((id: string) => {
      removedSourceIds.push(id);
      sources.delete(id);
    }),
    setExtent: vi.fn(),
    on: vi.fn(),
    resize: vi.fn(),
  };
  const runtime = {
    Emap: class {
      static async create() {
        return new this();
      }
      constructor() {
        return map;
      }
    },
    TopologySource: FakeTopologySource,
    EditToolbar: class {},
    NavigationControl: class {},
  };
  const installExampleMapUi = vi.fn();
  const autoLoadExampleFixtures = vi.fn(async () => {});
  const loadExampleRuntime = vi.fn(async () => runtime);
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    requests.push(url);
    if (failedUrls.has(url)) return new Response('upstream unavailable', { status: 503 });
    const type = url === TOPOJSON_URL ? 'Topology' : 'FeatureCollection';
    return new Response(JSON.stringify({ type }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction(
      'getExampleRenderer',
      'installExampleMapUi',
      'autoLoadExampleFixtures',
      'loadExampleRuntime',
      'document',
      'window',
      script,
    )(
      getExampleRenderer,
      installExampleMapUi,
      autoLoadExampleFixtures,
      loadExampleRuntime,
      document,
      window,
    );
  } catch (error) {
    fetchSpy.mockRestore();
    document.head.innerHTML = originalHead;
    document.body.innerHTML = originalBody;
    throw error;
  }
  return {
    requests,
    failedUrls,
    sourceInputs,
    sources,
    removedSourceIds,
    map,
    dispose() {
      fetchSpy.mockRestore();
      document.head.innerHTML = originalHead;
      document.body.innerHTML = originalBody;
    },
  };
}
describe('china editing online datasets', () => {
  it('loads the smaller TopoJSON dataset by default', async () => {
    const result = await executeChinaEditingExample();
    try {
      const selector = document.querySelector<HTMLSelectElement>('#online-source');
      expect(selector?.value).toBe('topojson');
      expect(result.requests).toEqual([TOPOJSON_URL]);
      expect(result.sourceInputs).toHaveLength(1);
      expect(result.sourceInputs[0]?.filename).toBe('china.topo.json');
      expect(result.sources.has('china-editing-source')).toBe(true);
      expect(document.querySelector('#status')?.textContent).toContain('TopoJSON');
    } finally {
      result.dispose();
    }
  });
  it('switches the editable source to online GeoJSON', async () => {
    const result = await executeChinaEditingExample();
    try {
      const selector = document.querySelector<HTMLSelectElement>('#online-source');
      expect(selector).not.toBeNull();
      const firstSource = result.sources.get('china-editing-source');
      selector!.value = 'geojson';
      selector!.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() =>
        expect(result.sourceInputs[result.sourceInputs.length - 1]?.filename).toBe('china.json'),
      );
      expect(result.requests).toEqual([TOPOJSON_URL, GEOJSON_URL]);
      expect(result.sources.get('china-editing-source')).not.toBe(firstSource);
      expect(result.removedSourceIds).toEqual(['china-editing-source']);
      expect(document.querySelector('#status')?.textContent).toContain('GeoJSON');
    } finally {
      result.dispose();
    }
  });
  it('keeps the current editable source when an online replacement fails', async () => {
    const reportError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await executeChinaEditingExample();
    try {
      const selector = document.querySelector<HTMLSelectElement>('#online-source');
      expect(selector).not.toBeNull();
      const firstSource = result.sources.get('china-editing-source');
      result.failedUrls.add(GEOJSON_URL);
      selector!.value = 'geojson';
      selector!.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() =>
        expect(document.querySelector('#status')?.textContent).toContain('503'),
      );
      expect(result.sources.get('china-editing-source')).toBe(firstSource);
      expect(result.removedSourceIds).toEqual([]);
      expect(reportError).toHaveBeenCalledTimes(1);
    } finally {
      result.dispose();
      reportError.mockRestore();
    }
  });
  it('declares no local fixture dependency', () => {
    expect(examples.find((example) => example.id === 'china-editing')?.fixtures).toEqual([]);
  });
});
