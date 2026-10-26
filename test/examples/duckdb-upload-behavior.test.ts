// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getExampleRenderer } from '../../packages/examples/src/renderer-choice';
import {
  createDuckDbSpatialAggregateRunCoordinator,
  executeDuckDbSpatialAggregateQuery,
  removeDuckDbSpatialAggregateSource,
} from '../../packages/examples/src/duckdb-spatial-aggregate-run-coordinator';
import { Bounds } from '../../src/domain/geo/bounds';
import type { MapshaperDataset } from '../../src/shared/types/mapshaper-types';

function readExample(id: string): string {
  return readFileSync(
    resolve(__dirname, `../../packages/examples/examples/${id}/index.html`),
    'utf8',
  );
}

interface ExampleFile {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}
interface ExampleLoad {
  dataset: MapshaperDataset;
  extent: Bounds;
  ready?: Promise<void>;
}
function exampleDataset(name: string): MapshaperDataset {
  return { layers: [{ name, geometry_type: 'point', shapes: [[[0, 0]]] }] };
}
function exampleFile(name: string, bytes = Promise.resolve(new Uint8Array([1, 2]).buffer)) {
  return { name, arrayBuffer: vi.fn(() => bytes) };
}

async function executeDuckDbExample(
  id: string,
  options: {
    loads?: Map<string, ExampleLoad>;
    fixture?: ExampleFile;
    entrypoint?: string;
    extents?: Map<MapshaperDataset, Bounds>;
    imports?: Record<string, unknown>;
  } = {},
) {
  const parsed = new DOMParser().parseFromString(readExample(id), 'text/html');
  const script = parsed.querySelector('script[type="module"]')?.textContent;
  if (!script) throw new Error(`Missing example module: ${id}`);
  const originalHead = document.head.innerHTML;
  const originalBody = document.body.innerHTML;
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  if (options.entrypoint) {
    (document.getElementById('entrypoint') as HTMLSelectElement).value = options.entrypoint;
  }
  const pending = new Map<EventTarget, Promise<unknown>>();
  const listeners: Array<ReturnType<typeof vi.spyOn>> = [];
  function trackEvents(target: EventTarget): void {
    const add = target.addEventListener.bind(target);
    listeners.push(
      vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, opts) => {
        add(
          type,
          typeof listener === 'function'
            ? (event) => {
                const completion = Promise.resolve(listener.call(target, event));
                pending.set(target, completion);
                void completion.catch(() => {});
              }
            : listener,
          opts,
        );
      }),
    );
  }
  for (const target of document.querySelectorAll('input, button')) trackEvents(target);
  const exampleWindow = new EventTarget();
  trackEvents(exampleWindow);
  function upload(inputId: string, file: ExampleFile): Promise<unknown> {
    const input = document.getElementById(inputId) as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));
    return pending.get(input)!;
  }
  const loadData = vi.fn(async (input: { filename: string; content: Uint8Array }) => {
    const load = options.loads?.get(input.filename);
    if (!load) throw new Error(`Unexpected input: ${input.filename}`);
    await load.ready;
    return load;
  });
  const outputExtent = new Bounds(1, 2, 3, 4);
  class ExampleSource {
    dataset?: MapshaperDataset;
    extent = outputExtent;
    async setData(input: { filename: string; content: Uint8Array }) {
      const load = await loadData(input);
      this.dataset = load.dataset;
      this.extent = load.extent;
    }
    async replaceDataset(dataset: MapshaperDataset) {
      this.dataset = dataset;
      this.extent = options.extents?.get(dataset) ?? outputExtent;
    }
    getDataset() {
      return this.dataset;
    }
    getLayers() {
      return this.dataset?.layers ?? [];
    }
    getExtent() {
      return this.extent;
    }
  }
  const sources = new Map<string, ExampleSource>();
  let layers: Array<{ id: string; source: string }> = [];
  const map = {
    addControl: vi.fn(),
    getLayers: () => layers,
    addLayer: vi.fn((layer: { id: string; source: string }) => {
      layers.push(layer);
    }),
    removeLayer: (id: string) => {
      layers = layers.filter((layer) => layer.id !== id);
    },
    getSource: (id: string) => sources.get(id),
    addSource: vi.fn(async (id: string, source: ExampleSource) => {
      sources.set(id, source);
    }),
    removeSource: (id: string) => {
      sources.delete(id);
    },
    setExtent: vi.fn(),
    resize: vi.fn(),
  };
  const runtime = {};
  const bindings = {
    getExampleRenderer,
    installExampleMapUi: vi.fn(),
    loadExampleRuntime: async () => ({
      Emap: { create: async () => map },
      TopologySource: ExampleSource,
      NavigationControl: class {},
    }),
    autoLoadExampleFixtures: async () => {
      if (options.fixture) void upload('file', options.fixture);
    },
    closeDuckDbRuntime: vi.fn(),
    createDuckDbRuntimeFromJsDelivr: vi.fn(async () => runtime),
    createDuckDbSpatialAggregateRunCoordinator,
    executeDuckDbSpatialAggregateQuery,
    removeDuckDbSpatialAggregateSource,
    ...options.imports,
    document,
    window: exampleWindow,
  };
  function dispose() {
    for (const listener of listeners) listener.mockRestore();
    document.head.innerHTML = originalHead;
    document.body.innerHTML = originalBody;
  }
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction(
      ...Object.keys(bindings),
      script.replace(/^\s*import\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];\s*$/gm, ''),
    )(...Object.values(bindings));
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    map,
    sources,
    runtime,
    outputExtent,
    loadData,
    upload,
    dispose,
    fixtureLoad: options.fixture ? pending.get(document.getElementById('file')!) : undefined,
    async pagehide() {
      exampleWindow.dispatchEvent(new Event('pagehide'));
      await pending.get(exampleWindow);
    },
    async clickRun() {
      const button = document.getElementById('run') as HTMLButtonElement;
      button.click();
      await pending.get(button);
    },
  };
}

describe('DuckDB example uploads', () => {
  it.each([
    'helper',
    'mapop',
    'direct',
  ])('queries and renders GeoParquet through %s after fixtures and uploads', async (entrypoint) => {
    const result = exampleDataset('fixture-result');
    const uploaded = exampleDataset('upload-result');
    const clicked = exampleDataset('click-result');
    const uploadExtent = new Bounds(10, 20, 30, 40);
    const clickExtent = new Bounds(100, 200, 300, 400);
    const ready = Promise.withResolvers<MapshaperDataset>();
    const results = vi
      .fn<() => Promise<MapshaperDataset>>()
      .mockReturnValueOnce(ready.promise)
      .mockResolvedValueOnce(uploaded)
      .mockResolvedValueOnce(clicked);
    const query = vi.fn((_opts: unknown) => results());
    const close = vi.fn(async () => {});
    const createQuerySource = vi.fn(async () => ({ query, close }));
    const direct = vi.fn((_bytes: Uint8Array, _opts: unknown, _runtime: unknown) => results());
    const mapop = vi.fn(async (_context: unknown, _opts: unknown) => ({
      ok: true,
      value: { dataset: await results() },
    }));
    const closeRuntime = vi.fn();
    const file = exampleFile('fixture.parquet');
    const harness = await executeDuckDbExample('duckdb-geoparquet-query', {
      fixture: file,
      entrypoint,
      extents: new Map([
        [uploaded, uploadExtent],
        [clicked, clickExtent],
      ]),
      imports: {
        createDuckDbGeoParquetQuerySource: createQuerySource,
        queryGeoParquetWithDuckDb: direct,
        duckDbGeoParquetQueryLayer: mapop,
        closeDuckDbRuntime: closeRuntime,
      },
    });
    try {
      const button = document.getElementById('run') as HTMLButtonElement;
      const upload = harness.fixtureLoad;
      expect(button.disabled).toBe(true);
      await vi.waitFor(() => expect(createQuerySource).toHaveBeenCalledOnce());
      const execute = entrypoint === 'helper' ? query : entrypoint === 'direct' ? direct : mapop;
      await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
      expect(createQuerySource).toHaveBeenCalledWith(new Uint8Array([1, 2]), harness.runtime);
      ready.resolve(result);
      await upload;
      const source = harness.sources.get('duckdb-geoparquet-output');
      expect(source?.getDataset()).toBe(result);
      expect(harness.map.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'duckdb-geoparquet-output',
          type: 'circle',
        }),
      );
      expect(harness.map.setExtent).toHaveBeenLastCalledWith(harness.outputExtent);
      expect(document.getElementById('status')?.textContent).toContain('fixture.parquet，输出 1');
      expect(button.disabled).toBe(false);

      (document.getElementById('sql') as HTMLTextAreaElement).value = 'SELECT * FROM input LIMIT 1';
      (document.getElementById('geometry-column') as HTMLInputElement).value = ' shape ';
      (document.getElementById('layer-name') as HTMLInputElement).value = ' uploaded ';
      await harness.upload(
        'file',
        exampleFile('upload.parquet', Promise.resolve(new Uint8Array([3, 4]).buffer)),
      );
      expect(close).toHaveBeenCalledOnce();
      expect(createQuerySource).toHaveBeenLastCalledWith(new Uint8Array([3, 4]), harness.runtime);
      expect(execute).toHaveBeenCalledTimes(2);
      const output = harness.sources.get('duckdb-geoparquet-output');
      expect(output).not.toBe(source);
      expect(output?.getDataset()).toBe(uploaded);
      expect(harness.map.setExtent).toHaveBeenLastCalledWith(uploadExtent);
      const opts = {
        sql: 'SELECT * FROM input LIMIT 1',
        layerName: 'uploaded',
        geometryColumn: 'shape',
      };
      if (entrypoint === 'helper') expect(query).toHaveBeenLastCalledWith(opts);
      else if (entrypoint === 'direct') {
        expect(direct).toHaveBeenLastCalledWith(new Uint8Array([3, 4]), opts, harness.runtime);
      } else {
        expect(mapop).toHaveBeenLastCalledWith(
          expect.objectContaining({
            getSource: expect.any(Function),
            setSourceDataset: expect.any(Function),
          }),
          {
            src: 'duckdb-geoparquet-bytes',
            ...opts,
            output: { sourceId: 'duckdb-geoparquet-output' },
            runtime: harness.runtime,
          },
        );
      }
      expect(document.getElementById('status')?.textContent).toContain('upload.parquet，输出 1');
      await harness.clickRun();
      expect(execute).toHaveBeenCalledTimes(3);
      const refreshed = harness.sources.get('duckdb-geoparquet-output');
      expect(refreshed).not.toBe(output);
      expect(refreshed?.getDataset()).toBe(clicked);
      expect(harness.map.setExtent).toHaveBeenLastCalledWith(clickExtent);
      for (const other of [query, mapop, direct]) {
        if (other !== execute) expect(other).not.toHaveBeenCalled();
      }
      expect(button.disabled).toBe(false);
      await harness.pagehide();
      await vi.waitFor(() => expect(closeRuntime).toHaveBeenCalledWith(harness.runtime));
      expect(close).toHaveBeenCalledTimes(2);
    } finally {
      ready.resolve(result);
      harness.dispose();
    }
  });

  it('keeps aggregate controls safe while both inputs load and fits their combined extent', async () => {
    const targetReady = Promise.withResolvers<void>();
    const joinReady = Promise.withResolvers<void>();
    const targetExtent = new Bounds(0, 0, 10, 10);
    const loads = new Map<string, ExampleLoad>([
      [
        'target.geojson',
        { dataset: exampleDataset('areas'), extent: targetExtent, ready: targetReady.promise },
      ],
      [
        'join.geojson',
        {
          dataset: exampleDataset('sales'),
          extent: new Bounds(20, -5, 30, 3),
          ready: joinReady.promise,
        },
      ],
      ['replacement.geojson', { dataset: exampleDataset('replacement'), extent: targetExtent }],
    ]);
    const harness = await executeDuckDbExample('duckdb-spatial-aggregate-join', { loads });
    let targetLoad: Promise<unknown> | undefined;
    let joinLoad: Promise<unknown> | undefined;
    try {
      const button = document.getElementById('run') as HTMLButtonElement;
      const target = document.getElementById('target-layer') as HTMLSelectElement;
      const join = document.getElementById('join-layer') as HTMLSelectElement;
      expect(document.getElementById('status')?.getAttribute('aria-live')).toBe('polite');
      targetLoad = harness.upload('target-file', exampleFile('target.geojson'));
      joinLoad = harness.upload('join-file', exampleFile('join.geojson'));
      await vi.waitFor(() => expect(harness.loadData).toHaveBeenCalledTimes(2));
      expect(button.disabled).toBe(true);
      joinReady.resolve();
      await joinLoad;
      expect(join.options).toHaveLength(1);
      expect(target.options).toHaveLength(0);
      expect(button.disabled).toBe(true);
      expect(harness.map.setExtent).not.toHaveBeenCalled();
      targetReady.resolve();
      await targetLoad;
      expect(button.disabled).toBe(false);
      expect(target.options[0]?.textContent).toContain('areas');
      expect(harness.map.setExtent).toHaveBeenLastCalledWith(new Bounds(0, -5, 30, 10));
      expect(targetExtent).toEqual(new Bounds(0, 0, 10, 10));
      const replacement = harness.upload('target-file', exampleFile('replacement.geojson'));
      expect(button.disabled).toBe(true);
      expect(target.options).toHaveLength(0);
      await replacement;
      expect(button.disabled).toBe(false);
      expect(target.options[0]?.textContent).toContain('replacement');
    } finally {
      targetReady.resolve();
      joinReady.resolve();
      await Promise.all([targetLoad, joinLoad]);
      harness.dispose();
    }
  });

  it.each([
    ['target-file', 'bytes'],
    ['target-file', 'setData'],
    ['join-file', 'bytes'],
    ['join-file', 'setData'],
  ] as const)('discards a stale %s load after %s settles', async (input, phase) => {
    const oldBytes = Promise.withResolvers<ArrayBuffer>();
    const oldData = Promise.withResolvers<void>();
    const current = exampleDataset('current');
    const loads = new Map<string, ExampleLoad>([
      [
        'old.geojson',
        {
          dataset: exampleDataset('old'),
          extent: new Bounds(-100, -100, 0, 0),
          ready: oldData.promise,
        },
      ],
      ['current.geojson', { dataset: current, extent: new Bounds(1, 2, 3, 4) }],
    ]);
    const harness = await executeDuckDbExample('duckdb-spatial-aggregate-join', { loads });
    const oldFile = exampleFile(
      'old.geojson',
      phase === 'bytes' ? oldBytes.promise : Promise.resolve(new ArrayBuffer(1)),
    );
    const oldLoad = harness.upload(input, oldFile);
    try {
      if (phase === 'setData') {
        await vi.waitFor(() =>
          expect(harness.loadData).toHaveBeenCalledWith(
            expect.objectContaining({ filename: 'old.geojson' }),
          ),
        );
      }
      await harness.upload(input, exampleFile('current.geojson'));
      const sourceId =
        input === 'target-file' ? 'duckdb-aggregate-target' : 'duckdb-aggregate-join';
      const published = harness.sources.get(sourceId);
      const select = document.getElementById(
        input === 'target-file' ? 'target-layer' : 'join-layer',
      ) as HTMLSelectElement;
      oldBytes.resolve(new ArrayBuffer(1));
      oldData.resolve();
      await oldLoad;
      expect(harness.sources.get(sourceId)).toBe(published);
      expect(published?.getDataset()).toBe(current);
      expect(select.options).toHaveLength(1);
      expect(select.options[0]?.textContent).toContain('current');
      expect(document.getElementById('status')?.textContent).toContain('current.geojson');
      expect(harness.map.setExtent).not.toHaveBeenCalled();
      if (phase === 'bytes') {
        expect(harness.loadData).toHaveBeenCalledTimes(1);
      }
    } finally {
      oldBytes.resolve(new ArrayBuffer(1));
      oldData.resolve();
      await oldLoad;
      harness.dispose();
    }
  });
});
