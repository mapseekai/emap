// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { importGeoParquet } from '../../src/integrations/arrow/geoparquet-io';
import { examples } from '../../docs-meta/examples';
import { setParquetWasm } from '../../src/integrations/arrow/parquet-wasm-loader';
import { injectParquetWasmForTests } from '../utils/arrow';
import {
  autoLoadExampleFixtures,
  fixtureManifest,
  fixtureUrl,
  installExampleMapUi,
  loadExampleRuntime,
  resolveRuntimeAssets,
} from '../../packages/examples/src/example-runtime';
import type { Control, ControlPosition, Emap } from '../../src';
const integrity = {
  vendor: 'sha384-dmVuZG9y',
  core: 'sha384-Y29yZQ==',
  css: 'sha384-Y3Nz',
};
const cdnOptions = {
  mode: 'cdn' as const,
  baseUrl: '/mapseekai/emap/examples/',
  version: '0.5.0',
  integrity,
};
function scriptAt(index: number): HTMLScriptElement {
  const script = document.head.querySelectorAll<HTMLScriptElement>('script')[index];
  if (!script) throw new Error(`Missing script at index ${index}`);
  return script;
}
function stylesheetAt(index: number): HTMLLinkElement {
  const stylesheet =
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')[index];
  if (!stylesheet) throw new Error(`Missing stylesheet at index ${index}`);
  return stylesheet;
}
async function settleDomEvents(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
class ExampleMapStub {
  private hasMapLibre = false;
  readonly ctx = {
    get: () => (this.hasMapLibre ? {} : undefined),
    plugin: vi.fn(async () => {
      this.hasMapLibre = true;
    }),
  };
  crs = 'EPSG:4326';
  readonly controls: Array<{
    control: Control;
    position: ControlPosition;
  }> = [];
  readonly reprojectCalls: string[] = [];
  readonly crsListeners = new Set<() => void>();
  addControl(control: Control, position: ControlPosition): void {
    this.controls.push({ control, position });
  }
  removeControl(control: Control): void {
    const index = this.controls.findIndex((entry) => entry.control === control);
    if (index !== -1) this.controls.splice(index, 1);
  }
  getCRS(): string {
    return this.crs;
  }
  on(type: string, listener: () => void): void {
    if (type === 'crschange') this.crsListeners.add(listener);
  }
  async reproject(crs: string): Promise<void> {
    this.reprojectCalls.push(crs);
    this.crs = crs;
    for (const listener of this.crsListeners) listener();
  }
}
class StatusControlStub implements Control {
  onAdd(): HTMLElement {
    return document.createElement('div');
  }
  onRemove(): void {}
}
class BasemapControlStub implements Control {
  onAdd(): HTMLElement {
    return document.createElement('div');
  }
  onRemove(): void {}
}
class ScaleControlStub implements Control {
  onAdd(): HTMLElement {
    return document.createElement('div');
  }
  onRemove(): void {}
}
const exampleRuntimeStub = {
  StatusControl: StatusControlStub,
  BasemapControl: BasemapControlStub,
  ScaleControl: ScaleControlStub,
} as unknown as typeof globalThis.emap;
class TestDataTransfer {
  readonly #files: File[] = [];
  readonly items = {
    add: (file: File): File => {
      this.#files.push(file);
      return file;
    },
  };
  get files(): FileList {
    return this.#files as unknown as FileList;
  }
}
function allowSyntheticFiles(...inputs: HTMLInputElement[]): void {
  for (const input of inputs) {
    Object.defineProperty(input, 'files', { configurable: true, writable: true, value: null });
  }
}
async function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)), { once: true });
    reader.addEventListener('error', () => reject(reader.error), { once: true });
    reader.readAsText(file);
  });
}
beforeAll(async () => {
  await injectParquetWasmForTests();
}, 30000);
afterAll(() => setParquetWasm(null));
afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.history.replaceState({}, '', '/');
  delete (
    globalThis as {
      emap?: unknown;
    }
  ).emap;
  vi.unstubAllGlobals();
});
describe('example runtime assets', () => {
  it('resolves local runtime and worker assets from the Vite base URL', () => {
    expect(resolveRuntimeAssets({ mode: 'local', baseUrl: '/mapseekai/emap/examples/' })).toEqual({
      vendor: '/mapseekai/emap/examples/vendor/mapshaper-vendor.js',
      core: '/mapseekai/emap/examples/vendor/emap.js',
      css: '/mapseekai/emap/examples/vendor/emap.css',
      worker: '/mapseekai/emap/examples/emap-worker.js',
      integrity: {},
    });
  });
  it('pins CDN assets to an exact version while keeping local fallbacks and worker', () => {
    expect(resolveRuntimeAssets(cdnOptions)).toEqual({
      vendor: 'https://cdn.jsdelivr.net/npm/@mapseekai/emap@0.5.0/dist/mapshaper-vendor.js',
      core: 'https://cdn.jsdelivr.net/npm/@mapseekai/emap@0.5.0/dist/emap.js',
      css: 'https://cdn.jsdelivr.net/npm/@mapseekai/emap@0.5.0/dist/emap.css',
      worker: '/mapseekai/emap/examples/emap-worker.js',
      fallbackVendor: '/mapseekai/emap/examples/vendor/mapshaper-vendor.js',
      fallbackCore: '/mapseekai/emap/examples/vendor/emap.js',
      fallbackCss: '/mapseekai/emap/examples/vendor/emap.css',
      integrity,
    });
  });
  it('rejects floating CDN versions and missing integrity metadata', () => {
    expect(() =>
      resolveRuntimeAssets({
        ...cdnOptions,
        version: 'latest',
      }),
    ).toThrow(/exact package version/i);
    expect(() =>
      resolveRuntimeAssets({
        mode: 'cdn',
        baseUrl: '/mapseekai/emap/examples/',
        version: '0.5.0',
      }),
    ).toThrow(/integrity/i);
  });
  it('falls back once per CDN asset and inserts core only after vendor succeeds', async () => {
    const runtimePromise = loadExampleRuntime(cdnOptions);
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
    expect(scriptAt(0).getAttribute('src')).toBe(
      'https://cdn.jsdelivr.net/npm/@mapseekai/emap@0.5.0/dist/mapshaper-vendor.js',
    );
    expect(scriptAt(0).crossOrigin).toBe('anonymous');
    expect(scriptAt(0).integrity).toBe(integrity.vendor);
    expect(stylesheetAt(0).getAttribute('href')).toBe(
      'https://cdn.jsdelivr.net/npm/@mapseekai/emap@0.5.0/dist/emap.css',
    );
    scriptAt(0).dispatchEvent(new Event('error'));
    await settleDomEvents();
    expect(document.head.querySelectorAll('script')).toHaveLength(2);
    expect(scriptAt(1).getAttribute('src')).toBe(
      '/mapseekai/emap/examples/vendor/mapshaper-vendor.js',
    );
    expect(scriptAt(1).hasAttribute('integrity')).toBe(false);
    scriptAt(1).dispatchEvent(new Event('load'));
    await settleDomEvents();
    expect(document.head.querySelectorAll('script')).toHaveLength(3);
    expect(scriptAt(2).getAttribute('src')).toBe(
      'https://cdn.jsdelivr.net/npm/@mapseekai/emap@0.5.0/dist/emap.js',
    );
    stylesheetAt(0).dispatchEvent(new Event('error'));
    await settleDomEvents();
    expect(document.head.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(2);
    expect(stylesheetAt(1).getAttribute('href')).toBe('/mapseekai/emap/examples/vendor/emap.css');
    stylesheetAt(1).dispatchEvent(new Event('load'));
    scriptAt(2).dispatchEvent(new Event('error'));
    await settleDomEvents();
    expect(document.head.querySelectorAll('script')).toHaveLength(4);
    expect(scriptAt(3).getAttribute('src')).toBe('/mapseekai/emap/examples/vendor/emap.js');
    const emap = { version: 'test' };
    (
      globalThis as {
        emap?: unknown;
      }
    ).emap = emap;
    scriptAt(3).dispatchEvent(new Event('load'));
    await expect(runtimePromise).resolves.toBe(emap);
    expect(document.head.querySelectorAll('script')).toHaveLength(4);
    expect(document.head.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(2);
  });
});
describe('shared example map UI', () => {
  it('keeps the basemap unavailable in 4326 and enables it after switching to 3857', async () => {
    document.body.innerHTML = '<div id="header"><strong>Example</strong></div>';
    const map = new ExampleMapStub();
    await installExampleMapUi(map as unknown as Emap, exampleRuntimeStub);
    expect(map.controls).toHaveLength(2);
    expect(map.controls[0]?.control).toBeInstanceOf(StatusControlStub);
    expect(map.controls[0]?.position).toBe('bottom-right');
    expect(map.controls[1]?.control).toBeInstanceOf(ScaleControlStub);
    expect(map.controls[1]?.position).toBe('bottom-left');
    expect(document.querySelector('.emap-example-basemap-state')?.textContent).toContain('3857');
    const selector = document.querySelector<HTMLSelectElement>('.emap-example-crs-select')!;
    selector.value = 'EPSG:3857';
    selector.dispatchEvent(new Event('change'));
    await settleDomEvents();
    expect(map.reprojectCalls).toEqual(['EPSG:3857']);
    expect(map.controls).toHaveLength(3);
    expect(map.controls[2]?.control).toBeInstanceOf(BasemapControlStub);
    expect(map.controls[2]?.position).toBe('top-right');
    expect(document.querySelector('.emap-example-basemap-state')?.textContent).toContain('右上角');
    selector.value = 'EPSG:4326';
    selector.dispatchEvent(new Event('change'));
    await settleDomEvents();
    expect(map.reprojectCalls).toEqual(['EPSG:3857', 'EPSG:4326']);
    expect(map.controls).toHaveLength(2);
    expect(map.controls[0]?.control).toBeInstanceOf(StatusControlStub);
  });
  it('opens an embedded example source in an in-page dialog', async () => {
    window.history.replaceState({}, '', '/mapseekai/emap/examples/getting-started/points/');
    const source = '<!doctype html>\n<title>Points example</title>';
    const encodedSource = JSON.stringify(source).replace(/</g, '\\u003c');
    document.body.innerHTML = [
      '<div id="header"><strong>Example</strong></div>',
      `<script id="emap-example-source" type="application/json">${encodedSource}</script>`,
    ].join('');
    const fetchSource = vi.fn();
    vi.stubGlobal('fetch', fetchSource);
    const map = new ExampleMapStub();
    await installExampleMapUi(map as unknown as Emap, exampleRuntimeStub);
    const sourceButton = document.querySelector<HTMLButtonElement>('.emap-example-source-button');
    expect(sourceButton?.textContent).toBe('查看源码');
    expect(sourceButton?.type).toBe('button');
    sourceButton?.click();
    expect(fetchSource).not.toHaveBeenCalled();
    const dialog = document.querySelector<HTMLDialogElement>('.emap-example-source-dialog');
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(dialog?.querySelector('code')?.textContent).toBe(source);
    expect(dialog?.querySelector('code')?.classList).toContain('language-html');
    expect(dialog?.querySelector('.token.doctype')).not.toBeNull();
    expect(dialog?.querySelector('.token.tag')).not.toBeNull();
    dialog?.querySelector<HTMLButtonElement>('.emap-example-source-close')?.click();
    expect(dialog?.isConnected).toBe(false);
  });
  it('shows the current nonstandard CRS without duplicating shared controls', async () => {
    document.body.innerHTML = '<div id="header"><strong>Example</strong></div>';
    const map = new ExampleMapStub();
    map.crs = 'EPSG:4490';
    await installExampleMapUi(map as unknown as Emap, exampleRuntimeStub);
    await installExampleMapUi(map as unknown as Emap, exampleRuntimeStub);
    expect(document.querySelector<HTMLSelectElement>('.emap-example-crs-select')?.value).toBe(
      'EPSG:4490',
    );
    expect(document.querySelectorAll('.emap-example-map-tools')).toHaveLength(1);
    expect(map.controls).toHaveLength(2);
  });
});
describe('example starter fixtures', () => {
  it('resolves fixture paths below the examples Vite base', () => {
    expect(fixtureUrl('fixtures/task-6-polygons.geojson', '/mapseekai/emap/examples/')).toBe(
      '/mapseekai/emap/examples/fixtures/task-6-polygons.geojson',
    );
  });
  it('assigns one fetched File and dispatches the existing change handler', async () => {
    document.body.innerHTML = '<input id="file-input" type="file"><div id="status"></div>';
    vi.stubGlobal('DataTransfer', TestDataTransfer);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"type":"FeatureCollection","features":[]}')),
    );
    const input = document.querySelector<HTMLInputElement>('#file-input')!;
    allowSyntheticFiles(input);
    let received: File | undefined;
    input.addEventListener('change', () => {
      received = input.files?.[0];
    });
    await autoLoadExampleFixtures('attribute-editing', document);
    expect(received?.name).toBe('task-6-polygons.geojson');
    expect(received?.type).toBe('application/geo+json');
    await expect(readFileText(received!)).resolves.toBe(
      '{"type":"FeatureCollection","features":[]}',
    );
  });
  it.each([
    ['duckdb/geometry/centroid', 'task-7-polygons.geojson'],
    ['duckdb/geometry/envelope', 'task-7-polygons.geojson'],
    ['duckdb/geometry/convex-hull', 'task-7-polygons.geojson'],
    ['duckdb/geometry/boundary', 'task-7-polygons.geojson'],
    ['duckdb/geometry/simplify', 'task-7-polygons.geojson'],
    ['duckdb/geometry/simplify-preserve-topology', 'task-7-polygons.geojson'],
    ['duckdb/geometry/make-valid', 'task-7-polygons.geojson'],
    ['duckdb/attribute/measures', 'task-7-polygons.geojson'],
    ['duckdb/attribute/coordinates', 'getting-started-points.geojson'],
    ['duckdb/attribute/geometry-checks', 'task-7-polygons.geojson'],
    ['duckdb/attribute/geometry-type', 'task-7-polygons.geojson'],
  ])('loads %s starter data into its actual #file input', async (id, expectedFile) => {
    document.body.innerHTML = '<input id="file" type="file"><div id="status"></div>';
    vi.stubGlobal('DataTransfer', TestDataTransfer);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}')),
    );
    const input = document.querySelector<HTMLInputElement>('#file')!;
    allowSyntheticFiles(input);
    let changed = 0;
    input.addEventListener('change', () => (changed += 1));
    await autoLoadExampleFixtures(id, document);
    expect(changed).toBe(1);
    expect(input.files?.[0]?.name).toBe(expectedFile);
  });
  it('assigns all files to one multiple input before dispatching change', async () => {
    document.body.innerHTML = '<input id="file-input" type="file" multiple>';
    vi.stubGlobal('DataTransfer', TestDataTransfer);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => new Response(String(input))),
    );
    const input = document.querySelector<HTMLInputElement>('#file-input')!;
    allowSyntheticFiles(input);
    let names: string[] = [];
    input.addEventListener('change', () => {
      names = Array.from(input.files ?? [], (file) => file.name);
    });
    await autoLoadExampleFixtures('merge-layers', document);
    expect(names).toEqual(['task-6-polygons.geojson', 'task-6-polygons-alt.geojson']);
  });
  it('loads overlay fixtures through their two existing upload controls', async () => {
    document.body.innerHTML = [
      '<input id="input-file" type="file">',
      '<input id="mask-file" type="file">',
    ].join('');
    vi.stubGlobal('DataTransfer', TestDataTransfer);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}')),
    );
    allowSyntheticFiles(
      document.querySelector<HTMLInputElement>('#input-file')!,
      document.querySelector<HTMLInputElement>('#mask-file')!,
    );
    const changed: string[] = [];
    document.querySelector('#input-file')?.addEventListener('change', () => changed.push('input'));
    document.querySelector('#mask-file')?.addEventListener('change', () => changed.push('mask'));
    await autoLoadExampleFixtures('duckdb-overlay', document);
    expect(changed).toEqual(['input', 'mask']);
    expect(
      Array.from(document.querySelectorAll<HTMLInputElement>('input'), (input) =>
        Array.from(input.files ?? [], (file) => file.name),
      ),
    ).toEqual([['task-7-polygons.geojson'], ['task-7-mask.geojson']]);
  });
  it('loads aggregate join fixtures through their two upload controls', async () => {
    document.body.innerHTML = [
      '<input id="target-file" type="file">',
      '<input id="join-file" type="file">',
    ].join('');
    vi.stubGlobal('DataTransfer', TestDataTransfer);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}')),
    );
    allowSyntheticFiles(
      document.querySelector<HTMLInputElement>('#target-file')!,
      document.querySelector<HTMLInputElement>('#join-file')!,
    );
    const changed: string[] = [];
    document
      .querySelector('#target-file')
      ?.addEventListener('change', () => changed.push('target'));
    document.querySelector('#join-file')?.addEventListener('change', () => changed.push('join'));
    await autoLoadExampleFixtures('duckdb-spatial-aggregate-join', document);
    expect(changed).toEqual(['target', 'join']);
    expect(
      Array.from(document.querySelectorAll<HTMLInputElement>('input'), (input) =>
        Array.from(input.files ?? [], (file) => file.name),
      ),
    ).toEqual([['task-7-mask.geojson'], ['duckdb-spatial-aggregate-points.geojson']]);
  });
  it('fills join CSV and matching key defaults before loading geometry', async () => {
    document.body.innerHTML = [
      '<input id="file-input" type="file">',
      '<textarea id="csv"></textarea>',
      '<input id="target-key">',
      '<input id="source-key">',
    ].join('');
    vi.stubGlobal('DataTransfer', TestDataTransfer);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (input: RequestInfo | URL) =>
          new Response(String(input).endsWith('.csv') ? 'id,score\nA,91\n' : '{}'),
      ),
    );
    allowSyntheticFiles(document.querySelector<HTMLInputElement>('#file-input')!);
    await autoLoadExampleFixtures('join', document);
    expect(document.querySelector<HTMLTextAreaElement>('#csv')?.value).toBe('id,score\nA,91\n');
    expect(document.querySelector<HTMLInputElement>('#target-key')?.value).toBe('id');
    expect(document.querySelector<HTMLInputElement>('#source-key')?.value).toBe('id');
  });
  it('reports a failed starter fetch in the existing status element', async () => {
    document.body.innerHTML = '<input id="file-input" type="file"><div id="status"></div>';
    vi.stubGlobal('DataTransfer', TestDataTransfer);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    await expect(autoLoadExampleFixtures('buffer', document)).rejects.toThrow(
      /task-7-polygons\.geojson/,
    );
    expect(document.querySelector('#status')?.textContent).toMatch(
      /unable to load starter data.*task-7-polygons\.geojson/i,
    );
  });
  it('reports a missing upload control in the existing status element', async () => {
    document.body.innerHTML = '<div id="status"></div>';
    await expect(autoLoadExampleFixtures('buffer', document)).rejects.toThrow(
      /file input #file-input was not found/i,
    );
    expect(document.querySelector('#status')?.textContent).toMatch(
      /unable to load starter data.*#file-input/i,
    );
  });
  it('declares local fixture bindings for format and introductory examples', () => {
    expect(fixtureManifest['getting-started/points']).toEqual([
      { selector: '#file-input', paths: ['fixtures/task-7-polygons.geojson'] },
    ]);
    expect(fixtureManifest['getting-started/point-style']).toEqual([
      { selector: '#file-input', paths: ['fixtures/getting-started-points.geojson'] },
    ]);
    expect(fixtureManifest['geoparquet-viewer']).toEqual([
      { selector: '#file-input', paths: ['fixtures/example-geoparquet.parquet'] },
    ]);
    expect(fixtureManifest['duckdb-geoparquet-query']).toEqual([
      { selector: '#file', paths: ['fixtures/example-geoparquet.parquet'] },
    ]);
  });
  it('binds every fixture to a file input that exists in the example page', async () => {
    for (const example of examples) {
      const bindings = fixtureManifest[example.id] ?? [];
      if (bindings.length === 0) continue;
      const html = await readFile(resolve(example.source.html), 'utf8');
      const page = new DOMParser().parseFromString(html, 'text/html');
      for (const binding of bindings) {
        const input = page.querySelector<HTMLInputElement>(binding.selector);
        expect(input?.type, `${example.id}: ${binding.selector} must be a file input`).toBe('file');
      }
    }
  });
  it('ships a real GeoParquet fixture that can be imported again', async () => {
    const bytes = new Uint8Array(
      await readFile(resolve('packages/examples/public/fixtures/example-geoparquet.parquet')),
    );
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('PAR1');
    const dataset = await importGeoParquet(bytes);
    expect(dataset.layers[0]?.geometry_type).toBe('polygon');
    expect(dataset.layers[0]?.shapes?.length).toBeGreaterThan(0);
  }, 30000);
});
