// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const duckDb = vi.hoisted(() => ({
  closeDuckDbRuntime: vi.fn(async () => {}),
  createDuckDbRuntimeFromJsDelivr: vi.fn(async () => ({ runtime: true })),
  setDuckDbRuntime: vi.fn(),
  centroid: vi.fn(async (dataset) => dataset),
  envelope: vi.fn(async (dataset) => dataset),
  repairGeometry: vi.fn(async (dataset) => dataset),
  area: vi.fn(async (dataset) => dataset),
  x: vi.fn(async (dataset) => dataset),
  y: vi.fn(async (dataset) => dataset),
  spatialRelation: vi.fn(async (input) => input),
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
  'centroid',
  'envelope',
  'convexHull',
  'boundary',
  'simplify',
  'simplifyPreserveTopology',
  'repairGeometry',
  'area',
  'length',
  'perimeter',
  'geometryType',
  'isValid',
  'isEmpty',
  'isSimple',
  'x',
  'y',
  'centroidX',
  'centroidY',
  'intersects',
  'contains',
  'within',
  'touches',
  'disjoint',
  'overlaps',
  'equals',
  'crosses',
  'covers',
  'coveredBy',
  'containsProperly',
  'distance',
  'distanceWithin',
] as const;

type Source = ReturnType<typeof createSource>;

function createSource(id: string, setData: (id: string) => Promise<void> = async () => {}) {
  const dataset = {
    info: {},
    layers: [{ name: 'layer', geometry_type: 'point', shapes: [{}] }],
  };
  const source = {
    id,
    dataset,
    setData: vi.fn(async () => {}),
    getDataset: vi.fn(() => dataset),
    setDataset: vi.fn((next) => Object.assign(dataset, next)),
    getLayers: vi.fn(() => dataset.layers),
    getExtent: vi.fn(() => [0, 0, 1, 1]),
  };
  source.setData.mockImplementation(() => setData(source.id));
  return source;
}

function fixture(
  options: {
    rejectDuplicateLayers?: boolean;
    setData?: (id: string) => Promise<void>;
    sourceInfo?: { crs_string?: string };
  } = {},
) {
  const { rejectDuplicateLayers = false, setData, sourceInfo } = options;
  document.body.innerHTML = `
    <div id="map"></div>
    <input id="file" type="file">
    <input id="mask-file" type="file">
    <select id="target"></select>
    <div id="crs-recovery" class="emap-example-field" hidden>
      <label id="crs-recovery-label" for="crs-recovery-input">数据 CRS</label>
      <input id="crs-recovery-input" placeholder="例如 EPSG:3857">
      <button id="crs-recovery-apply" type="button">应用 CRS</button>
    </div>
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
    preflightSource: vi.fn(async (request: { id: string; source: Source }) => ({
      status: 'ready' as const,
      plan: { sourceId: request.id, source: request.source },
    })),
    confirmSource: vi.fn(async (plan: { sourceId: string; source: Source }) =>
      sources.set(plan.sourceId, plan.source),
    ),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    getLayers: () => layers,
    getLayer: (id: string) => layers.find((layer) => layer.id === id),
    addLayer: vi.fn((layer) => {
      if (rejectDuplicateLayers && layers.some((existing) => existing.id === layer.id)) {
        throw new Error(`Layer ID already exists: ${layer.id}`);
      }
      layers.push(layer);
    }),
    removeLayer: vi.fn((id: string) =>
      layers.splice(
        layers.findIndex((layer) => layer.id === id),
        1,
      ),
    ),
    setLayerVisibility: vi.fn(),
    setExtent: vi.fn(),
    queryFeatures: vi.fn(() => [{ properties: { name: 'picked' } }]),
    clearHighlightedFeatures: vi.fn(),
    setHighlightedFeatures: vi.fn(),
  };
  class TopologySource {
    readonly impl = createSource('source', setData);
    constructor(id: string) {
      this.impl.id = id;
      if (sourceInfo) this.impl.dataset.info = { ...sourceInfo };
      return this.impl;
    }
  }
  exampleRuntime.loadExampleRuntime.mockResolvedValue({
    Emap: class {
      constructor() {
        return map;
      }
    },
    TopologySource,
    NavigationControl: class {},
  });
  return { map, sources, layers };
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
  ['duckdb/geometry/make-valid', 'repairGeometry'],
] as const;

const attributePages = [
  ['duckdb/attribute/area', 'area'],
  ['duckdb/attribute/length', 'length'],
  ['duckdb/attribute/perimeter', 'perimeter'],
  ['duckdb/attribute/geometry-type', 'geometryType'],
  ['duckdb/attribute/is-valid', 'isValid'],
  ['duckdb/attribute/is-empty', 'isEmpty'],
  ['duckdb/attribute/is-simple', 'isSimple'],
  ['duckdb/attribute/x', 'x'],
  ['duckdb/attribute/y', 'y'],
  ['duckdb/attribute/centroid-x', 'centroidX'],
  ['duckdb/attribute/centroid-y', 'centroidY'],
] as const;

const relationPages = [
  ['duckdb/relation/intersects', 'intersects'],
  ['duckdb/relation/contains', 'contains'],
  ['duckdb/relation/within', 'within'],
  ['duckdb/relation/touches', 'touches'],
  ['duckdb/relation/disjoint', 'disjoint'],
  ['duckdb/relation/overlaps', 'overlaps'],
  ['duckdb/relation/equals', 'equals'],
  ['duckdb/relation/crosses', 'crosses'],
  ['duckdb/relation/covers', 'covers'],
  ['duckdb/relation/covered-by', 'coveredBy'],
  ['duckdb/relation/contains-properly', 'containsProperly'],
  ['duckdb/relation/distance', 'distance'],
  ['duckdb/relation/distance-within', 'distanceWithin'],
] as const;

async function executePage(
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
    expect(duckDbSpatialOperationDefinitions.map(({ operation }) => operation)).toEqual(
      operationNames,
    );
  });

  it.each([
    ...geometryPages,
    ...attributePages,
    ...relationPages,
  ])('mounts %s with its fixed %s operation', async (id, operation) => {
    const mount = vi.fn(async () => {});

    await executePage(id, mount);

    expect(mount).toHaveBeenCalledExactlyOnceWith({ id, operation });
  });

  it.each(attributePages)('%s exposes only universal runner controls', async (id) => {
    const html = await readFile(resolve(`packages/examples/examples/${id}/index.html`), 'utf8');
    const page = new DOMParser().parseFromString(html, 'text/html');

    expect(page.body.classList.contains('emap-example-with-floating-header')).toBe(true);
    expect(page.querySelector('details.emap-example-workbench.panel')).not.toBeNull();
    expect(page.querySelector<HTMLInputElement>('#file')?.type).toBe('file');
    for (const selector of [
      '#relation-mode',
      '#mask-layer',
      '#distance',
      '#tolerance',
      '#allow-geographic',
    ]) {
      expect(page.querySelector(selector)).toBeNull();
    }
  });

  it.each(relationPages.slice(0, -2))('%s exposes fixed relation controls', async (id) => {
    const html = await readFile(resolve(`packages/examples/examples/${id}/index.html`), 'utf8');
    const page = new DOMParser().parseFromString(html, 'text/html');

    expect(page.body.classList.contains('emap-example-with-floating-header')).toBe(true);
    expect(page.querySelector('details.emap-example-workbench.panel')).not.toBeNull();
    expect(page.querySelector<HTMLInputElement>('#file')?.type).toBe('file');
    expect(page.querySelector('#target')).not.toBeNull();
    expect(page.querySelector('#mask-layer')).not.toBeNull();
    expect(page.querySelector('#relation-mode')).not.toBeNull();
    expect(
      Array.from(
        page.querySelectorAll<HTMLOptionElement>('#relation-mode option'),
        ({ value }) => value,
      ),
    ).toEqual(['filter', 'attribute']);
    for (const selector of ['#distance', '#tolerance', '#allow-geographic']) {
      expect(page.querySelector(selector)).toBeNull();
    }
  });

  it('gives distance only its fixed target, mask, and distance controls', async () => {
    const html = await readFile(
      resolve('packages/examples/examples/duckdb/relation/distance/index.html'),
      'utf8',
    );
    const page = new DOMParser().parseFromString(html, 'text/html');

    expect(page.body.classList.contains('emap-example-with-floating-header')).toBe(true);
    expect(page.querySelector('details.emap-example-workbench.panel')).not.toBeNull();
    expect(page.querySelector<HTMLInputElement>('#file')?.type).toBe('file');
    for (const selector of ['#target', '#mask-layer', '#distance']) {
      expect(page.querySelector(selector)).not.toBeNull();
    }
    for (const selector of ['#relation-mode', '#tolerance', '#allow-geographic']) {
      expect(page.querySelector(selector)).toBeNull();
    }
  });

  it('gives distance-within its filter-or-attribute relation controls', async () => {
    const html = await readFile(
      resolve('packages/examples/examples/duckdb/relation/distance-within/index.html'),
      'utf8',
    );
    const page = new DOMParser().parseFromString(html, 'text/html');

    expect(page.body.classList.contains('emap-example-with-floating-header')).toBe(true);
    expect(page.querySelector('details.emap-example-workbench.panel')).not.toBeNull();
    expect(page.querySelector<HTMLInputElement>('#file')?.type).toBe('file');
    for (const selector of ['#target', '#mask-layer', '#distance', '#relation-mode']) {
      expect(page.querySelector(selector)).not.toBeNull();
    }
    expect(
      Array.from(
        page.querySelectorAll<HTMLOptionElement>('#relation-mode option'),
        ({ value }) => value,
      ),
    ).toEqual(['filter', 'attribute']);
    for (const selector of ['#tolerance', '#allow-geographic']) {
      expect(page.querySelector(selector)).toBeNull();
    }
  });
  it.each([
    ...geometryPages,
    ...attributePages,
    ...relationPages,
  ])('%s uses standard workbench sections and field spacing', async (id) => {
    const html = await readFile(resolve(`packages/examples/examples/${id}/index.html`), 'utf8');
    const page = new DOMParser().parseFromString(html, 'text/html');
    const workbench = page.querySelector<HTMLElement>('.emap-example-workbench-body');
    if (!workbench) throw new Error(`Missing workbench body for ${id}`);

    const sections = Array.from(workbench.children).filter((child) =>
      child.classList.contains('emap-example-section'),
    );
    expect(sections.length).toBeGreaterThanOrEqual(2);

    for (const controlId of [
      'file',
      'target',
      'mask-file',
      'mask-layer',
      'relation-mode',
      'distance',
      'tolerance',
      'allow-geographic',
    ]) {
      const control = page.getElementById(controlId);
      if (!control) continue;
      expect(control.closest('.emap-example-field')).not.toBeNull();
      if (controlId === 'allow-geographic') {
        expect(control.closest('label.emap-example-check')).not.toBeNull();
      } else {
        expect(page.querySelector(`label[for="${controlId}"]`)).not.toBeNull();
      }
    }
    expect(page.getElementById('crs')).toBeNull();
    const recovery = page.getElementById('crs-recovery');
    expect(recovery?.classList.contains('emap-example-field')).toBe(true);
    expect(recovery?.hasAttribute('hidden')).toBe(true);
    expect(page.querySelector('label[for="crs-recovery-input"]')?.id).toBe('crs-recovery-label');
    expect(page.getElementById('crs-recovery-input')?.closest('.emap-example-field')).toBe(
      recovery,
    );
    expect(page.getElementById('crs-recovery-apply')?.closest('.emap-example-field')).toBe(
      recovery,
    );

    expect(page.querySelector('#run')?.classList.contains('emap-example-primary-button')).toBe(
      true,
    );
    expect(page.querySelector('#status')?.classList.contains('emap-example-status')).toBe(true);
    expect(
      page.querySelector('#picked-attributes')?.closest('.emap-example-section'),
    ).not.toBeNull();
  });

  it('declares only required controls for simplify and distance relations', () => {
    expect(getDuckDbSpatialOperationDefinition('simplify').controls).toEqual({
      tolerance: true,
      relationMode: false,
      distance: false,
    });
    expect(getDuckDbSpatialOperationDefinition('distance').controls).toEqual({
      tolerance: false,
      relationMode: false,
      distance: true,
    });
    expect(getDuckDbSpatialOperationDefinition('distanceWithin').controls).toEqual({
      tolerance: false,
      relationMode: true,
      distance: true,
    });
  });

  it('requires only controls used by the selected operation', async () => {
    fixture();
    for (const id of [
      'tolerance',
      'tolerance-label',
      'allow-geographic',
      'distance',
      'distance-label',
      'relation-mode',
      'relation-mode-label',
      'mask-layer',
      'mask-layer-label',
    ])
      document.getElementById(id)?.remove();
    await mountDuckDbSpatialExample({ id: 'test', operation: 'centroid' });

    fixture();
    document.getElementById('tolerance')?.remove();
    await expect(mountDuckDbSpatialExample({ id: 'test', operation: 'simplify' })).rejects.toThrow(
      '#tolerance',
    );

    fixture();
    document.getElementById('relation-mode')?.remove();
    document.getElementById('relation-mode-label')?.remove();
    await mountDuckDbSpatialExample({ id: 'test', operation: 'distance' });

    fixture();
    document.getElementById('mask-layer')?.remove();
    await expect(mountDuckDbSpatialExample({ id: 'test', operation: 'distance' })).rejects.toThrow(
      '#mask-layer',
    );

    fixture();
    for (const id of [
      'tolerance',
      'tolerance-label',
      'allow-geographic',
      'distance',
      'distance-label',
    ])
      document.getElementById(id)?.remove();
    await mountDuckDbSpatialExample({ id: 'test', operation: 'intersects' });

    fixture();
    document.getElementById('relation-mode')?.remove();
    await expect(
      mountDuckDbSpatialExample({ id: 'test', operation: 'intersects' }),
    ).rejects.toThrow('#relation-mode');

    fixture();
    document.getElementById('distance')?.remove();
    await expect(
      mountDuckDbSpatialExample({ id: 'test', operation: 'distanceWithin' }),
    ).rejects.toThrow('#distance');
  });

  it('confirms detected input metadata without an explicit CRS override', async () => {
    const { map, sources } = fixture({ sourceInfo: { crs_string: 'EPSG:3857' } });
    await expect(
      mountDuckDbSpatialExample({ id: 'test', operation: 'centroid' }),
    ).resolves.toBeUndefined();
    const input = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['point'], 'point.geojson')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(map.confirmSource).toHaveBeenCalledTimes(1));
    expect(map.preflightSource.mock.calls[0]?.[0]).toEqual({
      id: 'duckdb-spatial-input',
      source: expect.anything(),
    });
    expect(sources.get('duckdb-spatial-input')?.getDataset().info.crs_string).toBe('EPSG:3857');
    expect(document.getElementById('crs-recovery')?.hidden).toBe(true);
  });

  it('requests an explicit Input CRS after source preflight', async () => {
    const { map, sources } = fixture();
    const draft = { input: 'draft' };
    map.preflightSource.mockImplementationOnce(async () => ({
      status: 'needs-input',
      requirements: [{ code: 'source-crs', field: 'sourceCrs', reason: 'missing' }],
      draft,
    }));
    map.preflightSource.mockImplementationOnce(async (_draft, answers) => ({
      status: 'ready',
      plan: {
        sourceId: 'duckdb-spatial-input',
        source: map.preflightSource.mock.calls[0]![0].source,
        answers,
      },
    }));
    await mountDuckDbSpatialExample({ id: 'test', operation: 'centroid' });
    const input = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['point'], 'point.geojson')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(document.getElementById('crs-recovery')?.hidden).toBe(false));
    expect(input.disabled).toBe(true);
    expect((document.getElementById('mask-file') as HTMLInputElement).disabled).toBe(true);
    expect((document.getElementById('target') as HTMLSelectElement).disabled).toBe(true);
    expect((document.getElementById('run') as HTMLButtonElement).disabled).toBe(true);
    (document.getElementById('crs-recovery-input') as HTMLInputElement).value = 'EPSG:3857';
    document.getElementById('crs-recovery-apply')!.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(map.confirmSource).toHaveBeenCalledTimes(1));
    expect(map.preflightSource).toHaveBeenLastCalledWith(draft, { sourceCrs: 'EPSG:3857' });
    expect(sources.has('duckdb-spatial-input')).toBe(true);
    expect(document.getElementById('crs-recovery')?.hidden).toBe(true);
    expect(input.disabled).toBe(false);
    expect(document.getElementById('status')?.textContent).toBe('已按 EPSG:3857 加载输入数据。');
  });

  it('requests an explicit Mask CRS after source preflight', async () => {
    const { map, sources } = fixture();
    const maskDraft = { mask: 'draft' };
    await mountDuckDbSpatialExample({ id: 'test', operation: 'distance' });
    const input = document.getElementById('file') as HTMLInputElement;
    const mask = document.getElementById('mask-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['input'], 'input.geojson')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(map.confirmSource).toHaveBeenCalledTimes(1));
    const initialInput = sources.get('duckdb-spatial-input');
    map.preflightSource.mockImplementationOnce(async () => ({
      status: 'needs-input',
      requirements: [{ code: 'source-crs', field: 'sourceCrs', reason: 'missing' }],
      draft: maskDraft,
    }));
    map.preflightSource.mockImplementationOnce(async (_draft, answers) => ({
      status: 'ready',
      plan: {
        sourceId: 'duckdb-spatial-mask',
        source: map.preflightSource.mock.calls[1]![0].source,
        answers,
      },
    }));
    Object.defineProperty(mask, 'files', { value: [new File(['mask'], 'mask.geojson')] });
    mask.dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(document.getElementById('crs-recovery-label')?.textContent).toBe('Mask 数据 CRS'),
    );
    expect(sources.get('duckdb-spatial-input')).toBe(initialInput);
    (document.getElementById('crs-recovery-input') as HTMLInputElement).value = 'EPSG:3857';
    document.getElementById('crs-recovery-apply')!.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(map.confirmSource).toHaveBeenCalledTimes(2));
    expect(map.preflightSource).toHaveBeenLastCalledWith(maskDraft, { sourceCrs: 'EPSG:3857' });
    expect(sources.get('duckdb-spatial-input')).toBe(initialInput);
    expect(document.getElementById('status')?.textContent).toBe('已按 EPSG:3857 加载Mask 数据。');
  });

  it('retains concurrent Input and Mask CRS drafts until both are recovered', async () => {
    const parseResolvers = new Map<string, () => void>();
    const parsedSources = new Map<string, Source>();
    const { map, sources } = fixture({
      setData: (id) =>
        new Promise<void>((resolve) => {
          parseResolvers.set(id, resolve);
        }),
    });
    map.preflightSource.mockImplementation(async (request, answers) => {
      if ('source' in request) {
        parsedSources.set(request.id, request.source);
        return {
          status: 'needs-input',
          requirements: [{ code: 'source-crs', field: 'sourceCrs', reason: 'missing' }],
          draft: { sourceId: request.id },
        };
      }
      if (!('sourceId' in request) || typeof request.sourceId !== 'string') {
        throw new Error('Expected a source load draft');
      }
      const sourceId = request.sourceId;
      return {
        status: 'ready',
        plan: { sourceId, source: parsedSources.get(sourceId)!, answers },
      };
    });
    await mountDuckDbSpatialExample({ id: 'test', operation: 'distance' });
    const input = document.getElementById('file') as HTMLInputElement;
    const mask = document.getElementById('mask-file') as HTMLInputElement;
    const recoveryInput = document.getElementById('crs-recovery-input') as HTMLInputElement;
    const recoveryApply = document.getElementById('crs-recovery-apply') as HTMLButtonElement;
    Object.defineProperty(input, 'files', { value: [new File(['input'], 'input.geojson')] });
    Object.defineProperty(mask, 'files', { value: [new File(['mask'], 'mask.geojson')] });
    input.dispatchEvent(new Event('change'));
    mask.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(parseResolvers.size).toBe(2));
    parseResolvers.get('duckdb-spatial-input')!();
    await vi.waitFor(() =>
      expect(document.getElementById('crs-recovery-label')?.textContent).toBe('输入数据 CRS'),
    );
    parseResolvers.get('duckdb-spatial-mask')!();
    await vi.waitFor(() => expect(map.preflightSource).toHaveBeenCalledTimes(2));
    expect(document.getElementById('crs-recovery-label')?.textContent).toBe('输入数据 CRS');

    recoveryInput.value = 'EPSG:3857';
    recoveryApply.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(sources.has('duckdb-spatial-input')).toBe(true));
    expect(document.getElementById('status')?.textContent).toBe('已按 EPSG:3857 加载输入数据。');
    await vi.waitFor(() =>
      expect(document.getElementById('crs-recovery-label')?.textContent).toBe('Mask 数据 CRS'),
    );

    recoveryInput.value = 'EPSG:3857';
    recoveryApply.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(sources.has('duckdb-spatial-mask')).toBe(true));
    expect(document.getElementById('crs-recovery')?.hidden).toBe(true);
  });

  it('submits a pending CRS draft only once while confirmation is in flight', async () => {
    const { map, sources } = fixture();
    const draft = { input: 'draft' };
    type ReadyResult = {
      status: 'ready';
      plan: { sourceId: string; source: Source };
    };
    const retryResolvers: Array<(result: ReadyResult) => void> = [];
    map.preflightSource.mockImplementation(async (request) => {
      if ('source' in request) {
        return {
          status: 'needs-input',
          requirements: [{ code: 'source-crs', field: 'sourceCrs', reason: 'missing' }],
          draft,
        };
      }
      return new Promise<ReadyResult>((resolve) => retryResolvers.push(resolve));
    });
    await mountDuckDbSpatialExample({ id: 'test', operation: 'centroid' });
    const input = document.getElementById('file') as HTMLInputElement;
    const recoveryInput = document.getElementById('crs-recovery-input') as HTMLInputElement;
    const recoveryApply = document.getElementById('crs-recovery-apply') as HTMLButtonElement;
    Object.defineProperty(input, 'files', { value: [new File(['point'], 'point.geojson')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(document.getElementById('crs-recovery')?.hidden).toBe(false));

    recoveryInput.value = 'EPSG:3857';
    recoveryApply.dispatchEvent(new Event('click'));
    recoveryApply.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(retryResolvers).toHaveLength(1));
    expect(recoveryApply.disabled).toBe(true);

    retryResolvers[0]!({
      status: 'ready',
      plan: {
        sourceId: 'duckdb-spatial-input',
        source: map.preflightSource.mock.calls[0]![0].source,
      },
    });
    await vi.waitFor(() => expect(sources.has('duckdb-spatial-input')).toBe(true));
    expect(map.confirmSource).toHaveBeenCalledTimes(1);
    expect(document.getElementById('status')?.textContent).toBe('已按 EPSG:3857 加载输入数据。');
  });

  it('does not offer CRS recovery for a rejected source', async () => {
    const reportError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { map } = fixture();
      map.preflightSource.mockResolvedValueOnce({
        status: 'rejected',
        diagnostics: [{ code: 'source-load-rejected', severity: 'error', message: 'broken input' }],
      });
      await mountDuckDbSpatialExample({ id: 'test', operation: 'centroid' });
      const input = document.getElementById('file') as HTMLInputElement;
      Object.defineProperty(input, 'files', { value: [new File(['point'], 'point.geojson')] });
      input.dispatchEvent(new Event('change'));
      await vi.waitFor(() =>
        expect(document.getElementById('status')?.textContent).toContain('加载失败: broken input'),
      );
      expect(document.getElementById('crs-recovery')?.hidden).toBe(true);
      expect(map.confirmSource).not.toHaveBeenCalled();
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'broken input' }),
      );
    } finally {
      reportError.mockRestore();
    }
  });

  it('replaces output, renders clicked attributes, and discards stale results before publication', async () => {
    const { map, sources } = fixture();
    let resolveOperation!: (value: unknown) => void;
    duckDb.centroid.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOperation = resolve;
        }),
    );
    await mountDuckDbSpatialExample({ id: 'test', operation: 'centroid' });
    const input = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['point'], 'point.geojson')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(sources.has('duckdb-spatial-input')).toBe(true));
    document.getElementById('run')!.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(duckDb.centroid).toHaveBeenCalledTimes(1));
    sources.set('duckdb-spatial-input', createSource('new-input'));
    resolveOperation({ layers: [{ name: 'out', geometry_type: 'point', shapes: [{}] }] });
    await vi.waitFor(() =>
      expect(document.getElementById('status')!.textContent).toContain('结果已丢弃'),
    );
    expect(map.addSource).not.toHaveBeenCalled();
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
    const firstOutputLayerIds = map
      .getLayers()
      .filter((layer) => layer.source === 'duckdb-spatial-output')
      .map((layer) => layer.id);
    const firstOutputDataset = firstOutput?.getDataset();
    document.getElementById('run')!.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(duckDb.centroid).toHaveBeenCalledTimes(2));
    expect(duckDb.centroid.mock.calls[1]?.[0]).toBe(firstOutputDataset);
    expect(sources.get('duckdb-spatial-output')).not.toBe(firstOutput);
    expect(map.removeLayer).toHaveBeenCalledWith(firstOutputLayerIds[0]);

    const { sources: areaSources } = fixture();
    await mountDuckDbSpatialExample({ id: 'test', operation: 'area' });
    const areaInput = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(areaInput, 'files', { value: [new File(['point'], 'point.geojson')] });
    areaInput.dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(document.getElementById('run')!).not.toHaveProperty('disabled', true),
    );
    document.getElementById('run')!.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(areaSources.has('duckdb-spatial-output')).toBe(true));
    expect(duckDb.area).toHaveBeenCalledTimes(1);
  });

  it('runs the envelope helper on the selected input layer', async () => {
    const { sources } = fixture();
    await mountDuckDbSpatialExample({ id: 'test', operation: 'envelope' });
    const input = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['polygon'], 'polygon.geojson')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(sources.has('duckdb-spatial-input')).toBe(true));

    document.getElementById('run')!.dispatchEvent(new Event('click'));

    await vi.waitFor(() => expect(duckDb.envelope).toHaveBeenCalledTimes(1));
    expect(sources.has('duckdb-spatial-output')).toBe(true);
  });

  it.each([
    ['duckdb/attribute/x', 'x', 'x'],
    ['duckdb/attribute/y', 'y', 'y'],
  ] as const)('runs %s with point-compatible starter input', async (_id, operation, helper) => {
    const { sources } = fixture();
    await mountDuckDbSpatialExample({ id: 'test', operation });
    const input = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [
        new File(
          [
            '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[1,2]},"properties":{}}]}',
          ],
          'getting-started-points.geojson',
        ),
      ],
    });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(sources.has('duckdb-spatial-input')).toBe(true));
    document.getElementById('run')!.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(duckDb[helper]).toHaveBeenCalledTimes(1));
    expect(duckDb[helper]).toHaveBeenCalledWith(
      expect.objectContaining({ layers: [expect.objectContaining({ geometry_type: 'point' })] }),
      expect.any(Object),
      { runtime: true },
    );
  });
  it.each([
    'distance',
    'distanceWithin',
  ] as const)('runs %s against an independently loaded projected Mask source', async (operation) => {
    const { sources } = fixture();
    await mountDuckDbSpatialExample({ id: 'test', operation });
    const input = document.getElementById('file') as HTMLInputElement;
    const maskInput = document.getElementById('mask-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['target'], 'target.geojson')] });
    Object.defineProperty(maskInput, 'files', { value: [new File(['mask'], 'mask.geojson')] });
    input.dispatchEvent(new Event('change'));
    maskInput.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(sources.has('duckdb-spatial-mask')).toBe(true));
    expect((document.getElementById('mask-layer') as HTMLSelectElement).value).toBe(
      'duckdb-spatial-mask:0',
    );
    document.getElementById('run')!.dispatchEvent(new Event('click'));
    await vi.waitFor(() =>
      expect(duckDb.spatialRelation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ layers: expect.any(Array) }),
        expect.objectContaining({
          predicate: operation,
          mode: operation === 'distance' ? 'attribute' : 'filter',
        }),
        { runtime: true },
      ),
    );
  });
  it('autoloads the distance route through both controls when Mask completes first without duplicate layers', async () => {
    const uploadResolvers = new Map<string, () => void>();
    let delayInitialUploads = true;
    const { layers, sources } = fixture({
      rejectDuplicateLayers: true,
      setData: (id) =>
        delayInitialUploads
          ? new Promise<void>((resolve) => uploadResolvers.set(id, resolve))
          : Promise.resolve(),
    });
    exampleRuntime.autoLoadExampleFixtures.mockImplementationOnce(async (id: string) => {
      expect(id).toBe('duckdb/relation/distance');
      const input = document.getElementById('file') as HTMLInputElement;
      const mask = document.getElementById('mask-file') as HTMLInputElement;
      Object.defineProperty(input, 'files', { value: [new File(['target'], 'target.geojson')] });
      Object.defineProperty(mask, 'files', { value: [new File(['mask'], 'mask.geojson')] });
      input.dispatchEvent(new Event('change'));
      mask.dispatchEvent(new Event('change'));
    });

    await executePage('duckdb/relation/distance', mountDuckDbSpatialExample);
    await vi.waitFor(() => expect(uploadResolvers.size).toBe(2));
    delayInitialUploads = false;
    uploadResolvers.get('duckdb-spatial-mask')!();
    await vi.waitFor(() => expect(sources.has('duckdb-spatial-mask')).toBe(true));
    uploadResolvers.get('duckdb-spatial-input')!();
    await vi.waitFor(() => expect(sources.has('duckdb-spatial-input')).toBe(true));
    const initialInputSource = sources.get('duckdb-spatial-input');
    const initialMaskSource = sources.get('duckdb-spatial-mask');

    expect(layers.map(({ id }) => id).sort()).toEqual([
      'duckdb-spatial-input-0-point',
      'duckdb-spatial-mask-0-point',
    ]);
    expect(
      Array.from(
        (document.getElementById('target') as HTMLSelectElement).options,
        ({ value }) => value,
      ),
    ).toEqual(['duckdb-spatial-input:0', 'duckdb-spatial-mask:0']);
    expect((document.getElementById('mask-layer') as HTMLSelectElement).value).toBe(
      'duckdb-spatial-mask:0',
    );

    document.getElementById('run')!.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(duckDb.spatialRelation).toHaveBeenCalledTimes(1));
  });

  it('discards a result when the input changes during output registration', async () => {
    const { map, sources } = fixture();
    const originalAddSource = map.addSource.getMockImplementation()!;
    map.addSource.mockImplementation(async (id: string, source: Source) => {
      await originalAddSource(id, source);
      if (id === 'duckdb-spatial-output')
        sources.set('duckdb-spatial-input', createSource('changed-input'));
    });
    await mountDuckDbSpatialExample({ id: 'test', operation: 'centroid' });
    const input = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['point'], 'point.geojson')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(sources.has('duckdb-spatial-input')).toBe(true));
    document.getElementById('run')!.dispatchEvent(new Event('click'));
    await vi.waitFor(() =>
      expect(document.getElementById('status')!.textContent).toContain('结果已丢弃'),
    );
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
    await vi.waitFor(() => expect(duckDb.spatialRelation).toHaveBeenCalledTimes(1));
    expect(duckDb.spatialRelation.mock.calls[0]?.[2]).toMatchObject({
      predicate: 'distanceWithin',
      mode: 'attribute',
    });
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
    await vi.waitFor(() =>
      expect(duckDb.closeDuckDbRuntime).toHaveBeenCalledWith({ runtime: true }),
    );
  });
});
