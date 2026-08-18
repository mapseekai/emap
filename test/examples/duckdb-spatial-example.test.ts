// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const duckDb = vi.hoisted(() => ({
  closeDuckDbRuntime: vi.fn(async () => {}),
  createDuckDbRuntimeFromJsDelivr: vi.fn(async () => ({ runtime: true })),
  setDuckDbRuntime: vi.fn(),
  centroidDatasetWithDuckDb: vi.fn(async (dataset) => dataset),
  areaDatasetWithDuckDb: vi.fn(async (dataset) => dataset),
  runRelationOperation: vi.fn(async (input) => input),
}));

const exampleRuntime = vi.hoisted(() => ({
  autoLoadExampleFixtures: vi.fn(async () => {}),
  installExampleMapUi: vi.fn(),
  loadExampleRuntime: vi.fn(),
}));

vi.mock('@mapseekai/emap/duckdb', () => duckDb);
vi.mock('../../packages/examples/src/example-runtime', () => exampleRuntime);

import {
  duckDbSpatialOperationDefinitions,
  getDuckDbSpatialOperationDefinition,
  mountDuckDbSpatialExample,
} from '../../packages/examples/src/duckdb-spatial-example';

const operationNames = [
  'centroid', 'envelope', 'convexHull', 'boundary', 'simplify',
  'simplifyPreserveTopology', 'makeValid', 'area', 'length', 'perimeter',
  'geometryType', 'isValid', 'isEmpty', 'isSimple', 'x', 'y', 'centroidX',
  'centroidY', 'intersects', 'contains', 'within', 'touches', 'disjoint',
  'overlaps', 'equals', 'crosses', 'covers', 'coveredBy', 'containsProperly',
  'distance', 'distanceWithin',
] as const;

type Source = ReturnType<typeof createSource>;

function createSource(id: string) {
  const dataset = {
    info: {},
    layers: [{ name: 'layer', geometry_type: 'point', shapes: [{}] }],
  };
  return {
    id,
    dataset,
    setData: vi.fn(async () => {}),
    getDataset: vi.fn(() => dataset),
    setDataset: vi.fn((next) => Object.assign(dataset, next)),
    getLayers: vi.fn(() => dataset.layers),
    getExtent: vi.fn(() => [0, 0, 1, 1]),
  };
}

function fixture() {
  document.body.innerHTML = `
    <div id="map"></div>
    <input id="file" type="file">
    <select id="target"></select>
    <input id="crs" value="EPSG:4326">
    <input id="allow-geographic" type="checkbox">
    <button id="run"></button>
    <p id="status"></p>
    <pre id="picked-attributes"></pre>
    <input id="tolerance" value="1"><label id="tolerance-label"></label>
    <input id="distance" value="1"><label id="distance-label"></label>
    <select id="relation-mode"><option value="filter">Filter</option><option value="attribute">Attribute</option></select><label id="relation-mode-label"></label>
    <select id="mask-layer"></select><label id="mask-layer-label"></label>
  `;
  const sources = new Map<string, Source>();
  const layers: Array<{ id: string; source: string }> = [];
  const map = {
    addControl: vi.fn(),
    getCanvasContainer: () => document.getElementById('map')!,
    getSource: (id: string) => sources.get(id),
    addSource: vi.fn(async (id: string, source: Source) => sources.set(id, source)),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    getLayers: () => layers,
    getLayer: (id: string) => layers.find((layer) => layer.id === id),
    addLayer: vi.fn((layer) => layers.push(layer)),
    removeLayer: vi.fn((id: string) => layers.splice(layers.findIndex((layer) => layer.id === id), 1)),
    setLayerVisibility: vi.fn(),
    setExtent: vi.fn(),
    queryFeatures: vi.fn(() => [{ properties: { name: 'picked' } }]),
    clearHighlightedFeatures: vi.fn(),
    setHighlightedFeatures: vi.fn(),
  };
  class TopologySource {
    readonly impl = createSource('source');
    constructor(id: string) { this.impl.id = id; return this.impl; }
  }
  exampleRuntime.loadExampleRuntime.mockResolvedValue({
    Emap: class { constructor() { return map; } },
    TopologySource,
    NavigationControl: class {},
  });
  return { map, sources };
}

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

const geometryPages = [
  ['duckdb/geometry/centroid', 'centroid'],
  ['duckdb/geometry/envelope', 'envelope'],
  ['duckdb/geometry/convex-hull', 'convexHull'],
  ['duckdb/geometry/boundary', 'boundary'],
  ['duckdb/geometry/simplify', 'simplify'],
  ['duckdb/geometry/simplify-preserve-topology', 'simplifyPreserveTopology'],
  ['duckdb/geometry/make-valid', 'makeValid'],
] as const;

async function executeGeometryPage(
  id: string,
  mount: (config: { id: string; operation: string }) => Promise<void>,
) {
  const html = await readFile(resolve(`packages/examples/examples/${id}/index.html`), 'utf8');
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error(`Missing module script for ${id}`);
  const body = script.replace(
    /import\s*\{\s*mountDuckDbSpatialExample\s*\}\s*from\s*'\/src\/duckdb-spatial-example\.ts';/,
    '',
  );
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
    name: string,
    body: string,
  ) => (mount: typeof mount) => Promise<void>;
  await new AsyncFunction('mountDuckDbSpatialExample', body)(mount);
}

describe('DuckDB spatial example runner', () => {
  it('defines every one-operation-per-page route exactly once', () => {
    expect(duckDbSpatialOperationDefinitions.map(({ operation }) => operation)).toEqual(operationNames);
  });

  it.each(geometryPages)('mounts %s with its fixed %s operation', async (id, operation) => {
    const mount = vi.fn(async () => {});

    await executeGeometryPage(id, mount);

    expect(mount).toHaveBeenCalledExactlyOnceWith({ id, operation });
  });

  it('declares only required controls for simplify and distance relations', () => {
    expect(getDuckDbSpatialOperationDefinition('simplify').controls).toEqual({ tolerance: true, relationMode: false, distance: false });
    expect(getDuckDbSpatialOperationDefinition('distance').controls).toEqual({ tolerance: false, relationMode: false, distance: true });
    expect(getDuckDbSpatialOperationDefinition('distanceWithin').controls).toEqual({ tolerance: false, relationMode: true, distance: true });
  });

  it('requires only controls used by the selected operation', async () => {
    fixture();
    for (const id of ['tolerance', 'tolerance-label', 'allow-geographic', 'distance', 'distance-label', 'relation-mode', 'relation-mode-label', 'mask-layer', 'mask-layer-label']) document.getElementById(id)?.remove();
    await mountDuckDbSpatialExample({ id: 'test', operation: 'centroid' });

    fixture();
    document.getElementById('tolerance')?.remove();
    await expect(mountDuckDbSpatialExample({ id: 'test', operation: 'simplify' })).rejects.toThrow('#tolerance');

    fixture();
    document.getElementById('relation-mode')?.remove();
    document.getElementById('relation-mode-label')?.remove();
    await mountDuckDbSpatialExample({ id: 'test', operation: 'distance' });

    fixture();
    document.getElementById('mask-layer')?.remove();
    await expect(mountDuckDbSpatialExample({ id: 'test', operation: 'distance' })).rejects.toThrow('#mask-layer');

    fixture();
    for (const id of ['tolerance', 'tolerance-label', 'allow-geographic', 'distance', 'distance-label']) document.getElementById(id)?.remove();
    await mountDuckDbSpatialExample({ id: 'test', operation: 'intersects' });

    fixture();
    document.getElementById('relation-mode')?.remove();
    await expect(mountDuckDbSpatialExample({ id: 'test', operation: 'intersects' })).rejects.toThrow('#relation-mode');

    fixture();
    document.getElementById('distance')?.remove();
    await expect(mountDuckDbSpatialExample({ id: 'test', operation: 'distanceWithin' })).rejects.toThrow('#distance');
  });

  it('defaults uploaded source CRS to EPSG:4326, reloads bytes for a CRS change, and disables controls', async () => {
    const { map } = fixture();
    await mountDuckDbSpatialExample({ id: 'test', operation: 'centroid' });
    const input = document.getElementById('file') as HTMLInputElement;
    const file = new File(['point'], 'point.geojson');
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(map.addSource).toHaveBeenCalledTimes(1));
    expect(map.getSource('duckdb-spatial-input')?.getDataset().info.crs_string).toBe('EPSG:4326');
    const crs = document.getElementById('crs') as HTMLInputElement;
    crs.value = 'EPSG:3857';
    crs.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(map.addSource).toHaveBeenCalledTimes(2));
    expect(input.disabled).toBe(false);
    expect(document.getElementById('run')).not.toHaveProperty('disabled', true);
  });

  it('replaces output, renders clicked attributes, and discards stale results before publication', async () => {
    const { map, sources } = fixture();
    let resolveOperation!: (value: unknown) => void;
    duckDb.centroidDatasetWithDuckDb.mockImplementationOnce(() => new Promise((resolve) => { resolveOperation = resolve; }));
    await mountDuckDbSpatialExample({ id: 'test', operation: 'centroid' });
    const input = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['point'], 'point.geojson')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(sources.has('duckdb-spatial-input')).toBe(true));
    document.getElementById('run')!.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(duckDb.centroidDatasetWithDuckDb).toHaveBeenCalledTimes(1));
    sources.set('duckdb-spatial-input', createSource('new-input'));
    resolveOperation({ layers: [{ name: 'out', geometry_type: 'point', shapes: [{}] }] });
    await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toContain('结果已丢弃'));
    expect(map.addSource).toHaveBeenCalledTimes(1);
    document.getElementById('map')!.dispatchEvent(new MouseEvent('click'));
    expect(document.getElementById('picked-attributes')!.textContent).toContain('picked');
  });

  it('runs geometry and attribute helpers, replaces output, and fits its extent', async () => {
    const { map, sources } = fixture();
    await mountDuckDbSpatialExample({ id: 'test', operation: 'centroid' });
    const input = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['point'], 'point.geojson')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(sources.has('duckdb-spatial-input')).toBe(true));
    document.getElementById('run')!.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(sources.has('duckdb-spatial-output')).toBe(true));
    expect(map.setExtent).toHaveBeenCalledTimes(2);
    expect(document.getElementById('target')!.value).toBe('duckdb-spatial-output:0');
    const firstOutput = sources.get('duckdb-spatial-output');
    const firstOutputLayerIds = map.getLayers().filter((layer) => layer.source === 'duckdb-spatial-output').map((layer) => layer.id);
    const firstOutputDataset = firstOutput?.getDataset();
    document.getElementById('run')!.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(duckDb.centroidDatasetWithDuckDb).toHaveBeenCalledTimes(2));
    expect(duckDb.centroidDatasetWithDuckDb.mock.calls[1]?.[0]).toBe(firstOutputDataset);
    expect(sources.get('duckdb-spatial-output')).not.toBe(firstOutput);
    expect(map.removeLayer).toHaveBeenCalledWith(firstOutputLayerIds[0]);

    const { sources: areaSources } = fixture();
    await mountDuckDbSpatialExample({ id: 'test', operation: 'area' });
    const areaInput = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(areaInput, 'files', { value: [new File(['point'], 'point.geojson')] });
    areaInput.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(document.getElementById('run')!).not.toHaveProperty('disabled', true));
    document.getElementById('run')!.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(areaSources.has('duckdb-spatial-output')).toBe(true));
    expect(duckDb.areaDatasetWithDuckDb).toHaveBeenCalledTimes(1);
  });

  it('uses the selected mask for distance and selected target source for later runs', async () => {
    const { sources } = fixture();
    await mountDuckDbSpatialExample({ id: 'test', operation: 'distance' });
    const input = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['point'], 'point.geojson')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(sources.has('duckdb-spatial-input')).toBe(true));
    document.getElementById('run')!.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toContain('different Mask'));
    expect(duckDb.runRelationOperation).not.toHaveBeenCalled();
  });

  it('discards a result when the input changes during output registration', async () => {
    const { map, sources } = fixture();
    const originalAddSource = map.addSource.getMockImplementation()!;
    map.addSource.mockImplementation(async (id: string, source: Source) => {
      await originalAddSource(id, source);
      if (id === 'duckdb-spatial-output') sources.set('duckdb-spatial-input', createSource('changed-input'));
    });
    await mountDuckDbSpatialExample({ id: 'test', operation: 'centroid' });
    const input = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['point'], 'point.geojson')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(sources.has('duckdb-spatial-input')).toBe(true));
    document.getElementById('run')!.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toContain('结果已丢弃'));
    expect(sources.has('duckdb-spatial-output')).toBe(false);
  });

  it('runs distanceWithin through the selected relation mode', async () => {
    const { sources } = fixture();
    await mountDuckDbSpatialExample({ id: 'test', operation: 'distanceWithin' });
    const input = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['point'], 'point.geojson')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(sources.has('duckdb-spatial-input')).toBe(true));
    (document.getElementById('relation-mode') as HTMLSelectElement).value = 'attribute';
    document.getElementById('run')!.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(duckDb.runRelationOperation).toHaveBeenCalledTimes(1));
    expect(duckDb.runRelationOperation.mock.calls[0]?.[2]).toMatchObject({ operation: 'distanceWithin', mode: 'attribute' });
    await vi.waitFor(() => expect(sources.has('duckdb-spatial-output')).toBe(true));
  });

  it('closes the created runtime on pagehide', async () => {
    const { sources } = fixture();
    await mountDuckDbSpatialExample({ id: 'test', operation: 'centroid' });
    const input = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['point'], 'point.geojson')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(sources.has('duckdb-spatial-input')).toBe(true));
    document.getElementById('run')!.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(duckDb.createDuckDbRuntimeFromJsDelivr).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(() => expect(duckDb.closeDuckDbRuntime).toHaveBeenCalledWith({ runtime: true }));
  });
});
