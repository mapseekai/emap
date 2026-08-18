// @vitest-environment jsdom
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

describe('DuckDB spatial example runner', () => {
  it('defines every one-operation-per-page route exactly once', () => {
    expect(duckDbSpatialOperationDefinitions.map(({ operation }) => operation)).toEqual(operationNames);
  });

  it('declares only required controls for simplify and distance relations', () => {
    expect(getDuckDbSpatialOperationDefinition('simplify').controls).toEqual({ tolerance: true, relationMode: false, distance: false });
    expect(getDuckDbSpatialOperationDefinition('distance').controls).toEqual({ tolerance: false, relationMode: false, distance: true });
    expect(getDuckDbSpatialOperationDefinition('distanceWithin').controls).toEqual({ tolerance: false, relationMode: true, distance: true });
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

  it('shows relation controls and delegates distanceWithin to the relation runner', async () => {
    fixture();
    await mountDuckDbSpatialExample({ id: 'test', operation: 'distanceWithin' });
    expect((document.getElementById('relation-mode-label') as HTMLElement).style.display).not.toBe('none');
    expect((document.getElementById('distance-label') as HTMLElement).style.display).not.toBe('none');
  });

  it('runs distance as an attribute relation without exposing a mode selector', async () => {
    const { sources } = fixture();
    await mountDuckDbSpatialExample({ id: 'test', operation: 'distance' });
    const input = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['point'], 'point.geojson')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(sources.has('duckdb-spatial-input')).toBe(true));
    document.getElementById('run')!.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(duckDb.runRelationOperation).toHaveBeenCalledTimes(1));
    expect(duckDb.runRelationOperation.mock.calls[0]?.[2]).toMatchObject({
      mode: 'attribute',
      operation: 'distance',
    });
    expect((document.getElementById('relation-mode-label') as HTMLElement).style.display).toBe('none');
  });

  it('closes the lazily created runtime on pagehide', async () => {
    fixture();
    await mountDuckDbSpatialExample({ id: 'test', operation: 'centroid' });
    document.getElementById('run')!.dispatchEvent(new Event('click'));
    window.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(() => expect(duckDb.closeDuckDbRuntime).toHaveBeenCalled());
  });
});
