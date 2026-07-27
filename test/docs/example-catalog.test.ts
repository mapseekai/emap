// @vitest-environment jsdom
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const emapRuntime = vi.hoisted(() => {
  type MockLayer = {
    id?: string;
    name: string;
    source?: string;
    geometry_type: string;
    shapes: unknown[];
    data: {
      getFields(): string[];
      getRecords(): Record<string, unknown>[];
    };
  };

  type MockDataset = {
    info: Record<string, unknown>;
    layers: MockLayer[];
  };

  function createMockDataset(): MockDataset {
    return {
      info: {},
      layers: [
        {
          name: 'polygons',
          geometry_type: 'polygon',
          shapes: [[[0, 0]]],
          data: {
            getFields: () => ['name'],
            getRecords: () => [{ name: 'parcel-a' }],
          },
        },
      ],
    };
  }

  class MockHandler {
    private _enabled = false;

    constructor(
      private readonly _name: string,
      private readonly _isBlocked: () => boolean,
    ) {}

    enable(): void {
      if (this._isBlocked()) {
        throw new Error(`cannot enable ${this._name}: the other selection handler is enabled`);
      }
      this._enabled = true;
    }

    disable(): void {
      this._enabled = false;
    }

    isEnabled(): boolean {
      return this._enabled;
    }

    setOptions(): void {}
  }

  class MockSelectControl {
    private _enabled = true;
    private _handler: MockHandler | null = null;

    constructor(
      private readonly _handlerName: 'boxSelect' | 'lassoSelect',
      private readonly _className: string,
    ) {}

    onAdd(map: MockMap): HTMLElement {
      const handler = map[this._handlerName];
      this._handler = handler;
      handler.setOptions();
      if (this._enabled) handler.enable();
      const container = document.createElement('div');
      container.className = this._className;
      return container;
    }

    onRemove(): void {
      this._handler?.disable();
      this._handler = null;
    }

    enable(): void {
      this._enabled = true;
      this._handler?.enable();
    }

    disable(): void {
      this._enabled = false;
      this._handler?.disable();
    }
  }

  class MockBoxSelectControl extends MockSelectControl {
    constructor() {
      super('boxSelect', 'emap-ctrl emap-box-select-anchor');
    }
  }

  class MockLassoSelectControl extends MockSelectControl {
    constructor() {
      super('lassoSelect', 'emap-ctrl emap-lasso-select-anchor');
    }
  }

  class MockTopologySource {
    private _dataset: MockDataset = createMockDataset();

    constructor(readonly id: string) {}

    async setData(): Promise<void> {
      this._dataset = createMockDataset();
    }

    setDataset(dataset: MockDataset): void {
      this._dataset = dataset;
    }

    getDataset(): MockDataset {
      return this._dataset;
    }

    getExtent(): { hasBounds(): boolean } {
      return { hasBounds: () => false };
    }

    getLayers(): MockLayer[] {
      return this._dataset.layers;
    }
  }

  type MockMapOptions = {
    container: HTMLElement;
    useWorker?: boolean | 'auto';
    workerThreshold?: number;
    workerUrl?: string;
  };

  class MockMap {
    readonly boxSelect: MockHandler;
    readonly lassoSelect: MockHandler;
    readonly features = { get: () => null };
    readonly sources = new Map<string, MockTopologySource>();
    readonly layers: MockLayer[] = [];
    readonly ops = {
      dissolveLayer: vi.fn(async () => ({ ok: true })),
      simplifyLayer: vi.fn(async () => ({ ok: true })),
    };

    constructor(readonly options: MockMapOptions) {
      this.boxSelect = new MockHandler('boxSelect', () => this.lassoSelect.isEnabled());
      this.lassoSelect = new MockHandler('lassoSelect', () => this.boxSelect.isEnabled());
      lastMap = this;
      maps.push(this);
    }

    addControl(control: { onAdd(map: MockMap): HTMLElement }): void {
      control.onAdd(this);
    }

    bindHistoryShortcuts(): void {}
    remove(): void {}
    getSource(id: string): MockTopologySource | null {
      return this.sources.get(id) ?? null;
    }
    removeSource(id: string): void {
      this.sources.delete(id);
    }
    addSource(id: string, source: MockTopologySource): void {
      this.sources.set(id, source);
    }
    addLayer(layer: MockLayer): void {
      this.layers.push(layer);
    }
    getLayers(): MockLayer[] {
      return this.layers;
    }
    removeLayer(id: string): void {
      const index = this.layers.findIndex((layer) => layer.id === id);
      if (index >= 0) this.layers.splice(index, 1);
    }
    setExtent(): void {}
    on(): void {}
    setHighlightedFeatures(): void {}
    clearHighlightedFeatures(): void {}
    clearSelection(): void {}
    cancelWorkerJobs(): void {}
    select(): void {}
    queryFeatures(): never[] {
      return [];
    }
  }

  class MockControl {
    onAdd(): HTMLElement {
      return document.createElement('div');
    }
  }

  let lastMap: MockMap | null = null;
  const maps: MockMap[] = [];

  return {
    getLastMap: () => lastMap,
    getMaps: () => maps,
    reset: () => {
      lastMap = null;
      maps.length = 0;
    },
    module: {
      BasemapControl: MockControl,
      BoxSelectControl: MockBoxSelectControl,
      DrawFeatureControl: MockControl,
      EditToolbar: MockControl,
      Emap: MockMap,
      HistoryControl: MockControl,
      LassoSelectControl: MockLassoSelectControl,
      NavigationControl: MockControl,
      SimplifyControl: MockControl,
      StatusControl: MockControl,
      TopologySource: MockTopologySource,
      VertexEditControl: MockControl,
      rotateMatrix: () => [1, 0, 0, 1, 0, 0],
      scaleMatrix: () => [1, 0, 0, 1, 0, 0],
    },
  };
});

vi.mock('@zwishing/emap', () => emapRuntime.module);
vi.mock('@zwishing/emap/formats', () => ({ initParquetWasm: vi.fn() }));

const duckDbRuntime = vi.hoisted(() => {
  const runtime = { runtime: 'duckdb' };
  const createDuckDbRuntimeFromJsDelivr = vi.fn();
  const setDuckDbRuntime = vi.fn();
  const bufferDatasetWithDuckDb = vi.fn();
  const createDuckDbGeoParquetQuerySource = vi.fn();
  const duckDbGeoParquetQueryLayer = vi.fn();
  const intersectionDatasetWithDuckDb = vi.fn();
  const differenceDatasetWithDuckDb = vi.fn();
  const duckDbOverlayLayer = vi.fn();
  const validateDuckDbSelectSql = vi.fn();
  const queryDatasetWithDuckDb = vi.fn();
  const duckDbQueryLayer = vi.fn();
  const runRelationOperation = vi.fn();
  const centroidDatasetWithDuckDb = vi.fn();

  function reset(): void {
    createDuckDbRuntimeFromJsDelivr.mockReset();
    setDuckDbRuntime.mockReset();
    bufferDatasetWithDuckDb.mockReset();
    createDuckDbGeoParquetQuerySource.mockReset();
    duckDbGeoParquetQueryLayer.mockReset();
    intersectionDatasetWithDuckDb.mockReset();
    differenceDatasetWithDuckDb.mockReset();
    duckDbOverlayLayer.mockReset();
    validateDuckDbSelectSql.mockReset();
    queryDatasetWithDuckDb.mockReset();
    duckDbQueryLayer.mockReset();
    runRelationOperation.mockReset();
    centroidDatasetWithDuckDb.mockReset();

    createDuckDbRuntimeFromJsDelivr.mockResolvedValue(runtime);
    bufferDatasetWithDuckDb.mockImplementation(async (dataset: unknown) => dataset);
    createDuckDbGeoParquetQuerySource.mockResolvedValue({
      close: vi.fn(),
      query: vi.fn(async () => ({ info: {}, layers: [] })),
    });
    duckDbGeoParquetQueryLayer.mockResolvedValue({
      ok: true,
      value: { dataset: { info: {}, layers: [] } },
    });
    intersectionDatasetWithDuckDb.mockImplementation(async (dataset: unknown) => dataset);
    differenceDatasetWithDuckDb.mockImplementation(async (dataset: unknown) => dataset);
    duckDbOverlayLayer.mockResolvedValue({
      ok: true,
      value: { dataset: { info: {}, layers: [] } },
    });
    validateDuckDbSelectSql.mockReturnValue(undefined);
    queryDatasetWithDuckDb.mockImplementation(async (dataset: unknown) => dataset);
    duckDbQueryLayer.mockResolvedValue({ ok: true, value: { dataset: { info: {}, layers: [] } } });
    runRelationOperation.mockImplementation(async (dataset: unknown) => dataset);
    centroidDatasetWithDuckDb.mockImplementation(async (dataset: unknown) => dataset);
  }

  return {
    module: {
      createDuckDbRuntimeFromJsDelivr,
      setDuckDbRuntime,
      bufferDatasetWithDuckDb,
      createDuckDbGeoParquetQuerySource,
      duckDbGeoParquetQueryLayer,
      intersectionDatasetWithDuckDb,
      differenceDatasetWithDuckDb,
      duckDbOverlayLayer,
      validateDuckDbSelectSql,
      queryDatasetWithDuckDb,
      duckDbQueryLayer,
      runRelationOperation,
      centroidDatasetWithDuckDb,
    },
    reset,
    runtime,
  };
});

duckDbRuntime.reset();
vi.mock('@zwishing/emap/duckdb', () => duckDbRuntime.module);

import { examples } from '../../docs-meta/examples';
import { resolveExampleId } from '../../packages/examples/src/example-page';

const expectedExamples = [
  {
    id: 'getting-started/geojson-viewer',
    fixtures: ['inline:geojson-viewer.geojson'],
  },
  {
    id: 'getting-started/points',
    fixtures: ['inline:points.geojson'],
  },
  {
    id: 'getting-started/lines',
    fixtures: ['inline:lines.geojson'],
  },
  {
    id: 'getting-started/polygons',
    fixtures: ['inline:polygons.geojson'],
  },
  {
    id: 'getting-started/polygon-fill',
    fixtures: ['inline:polygon-fill.geojson'],
  },
] as const;

const task6Fixture = 'fixtures/task-6-polygons.geojson';
const task6CsvFixture = 'fixtures/task-6-join.csv';
const task6MergeFixture = 'fixtures/task-6-polygons-alt.geojson';

const task6Matrix = [
  [
    'attribute-editing',
    [task6Fixture],
    ['loadAttributeEditing', 'addField', 'removeField', 'renameField', 'setFeatureProperty'],
  ],
  [
    'attribute-expressions',
    [task6Fixture],
    ['loadAttributeExpressions', 'applyExpression', 'Expression', 'Where'],
  ],
  [
    'data-engineering',
    [task6Fixture],
    ['loadDataEngineering', 'sortFeatures', 'uniqueFeatures', 'filterFields', 'renameFields'],
  ],
  [
    'feature-attributes',
    [task6Fixture],
    ['loadFeatureAttributes', 'queryFeatures', 'setHighlightedFeatures'],
  ],
  ['filter-features', [task6Fixture], ['loadFilterFeatures', 'filterFeatures', 'Expression']],
  [
    'geoparquet-viewer',
    [],
    [
      'loadGeoParquetViewer',
      'initParquetWasm',
      '.parquet,.geoparquet,.arrow,.arrows,.feather',
      'geoarrow',
    ],
  ],
  [
    'export-geoparquet',
    [task6Fixture],
    ['loadExportGeoparquet', 'geoparquet-native', 'geoarrow', 'downloadBlob'],
  ],
  ['export-roundtrip', [task6Fixture], ['loadExportRoundtrip', 'DrawFeatureControl', 'export']],
  [
    'join',
    [task6Fixture, task6CsvFixture],
    ['loadJoin', 'joinTable', 'Target key', 'Source key', 'joined_'],
  ],
  [
    'merge-layers',
    [task6Fixture, task6MergeFixture],
    ['loadMergeLayers', 'multiple: true', 'force', 'flatten', 'mergeLayers'],
  ],
  ['merge-selected', [task6Fixture], ['loadMergeSelected', 'mergeSelected', 'Clear selection']],
  ['rename-layer', [task6Fixture], ['loadRenameLayer', 'renameLayer', 'New layer name']],
  ['split-layer', [task6Fixture], ['loadSplitLayer', 'splitLayer', 'Split field']],
  ['interaction-handlers', [task6Fixture], ['loadInteractionHandlers', 'dragPan', 'scrollZoom']],
  [
    'feature-selection',
    [task6Fixture],
    ['loadFeatureSelection', 'selectionchange', 'shiftKey', 'toggle'],
  ],
  ['box-select', [task6Fixture], ['loadBoxSelect', 'BoxSelectControl', 'Delete selected']],
  ['lasso-select', [task6Fixture], ['loadLassoSelect', 'LassoSelectControl', 'BoxSelectControl']],
  ['china-editing', [task6Fixture], ['loadChinaEditing', 'EditToolbar', 'VertexEditControl']],
  [
    'draw-snap-clear',
    [task6Fixture],
    ['loadDrawSnapClear', 'drawFeature.setOptions', 'snapToVertex', 'snapToEdge'],
  ],
  [
    'draw-snap-edge',
    [task6Fixture],
    ['loadDrawSnapEdge', 'DrawFeatureControl', 'snapToVertex', 'snapToEdge'],
  ],
  [
    'feature-rotate-scale',
    [task6Fixture],
    ['loadFeatureRotateScale', 'beginAffineSession', 'rotateMatrix', 'scaleMatrix'],
  ],
  [
    'feature-translate',
    [task6Fixture],
    ['loadFeatureTranslate', 'beginTranslateSession', 'move(0.01, 0)'],
  ],
  ['snapshot', [task6Fixture], ['loadSnapshot', 'exportSnapshot']],
  ['transaction', [task6Fixture], ['loadTransaction', 'beginTransaction', 'commit', 'rollback']],
  ['undo-redo', [task6Fixture], ['loadUndoRedo', 'HistoryControl', 'undo', 'redo']],
  ['vertex-editing', [task6Fixture], ['loadVertexEditing', 'VertexEditControl', 'EditToolbar']],
] as const satisfies readonly (readonly [string, readonly string[], readonly string[]])[];

const task6ControlMatrix = {
  history: [
    'attribute-editing',
    'attribute-expressions',
    'data-engineering',
    'filter-features',
    'join',
    'merge-layers',
    'merge-selected',
    'rename-layer',
    'split-layer',
    'feature-selection',
    'box-select',
    'lasso-select',
    'draw-snap-clear',
    'draw-snap-edge',
    'feature-rotate-scale',
    'feature-translate',
    'transaction',
    'undo-redo',
  ],
  basemap: [
    'feature-attributes',
    'geoparquet-viewer',
    'export-geoparquet',
    'china-editing',
    'vertex-editing',
  ],
} as const;

const task7Fixture = 'fixtures/task-7-polygons.geojson';
const task7LineFixture = 'fixtures/task-7-lines.geojson';
const task7MaskFixture = 'fixtures/task-7-mask.geojson';

const task7Matrix = [
  [
    'buffer',
    [task7Fixture],
    ['loadBuffer', 'setupBuffer', 'bufferLayer', 'capStyle', 'arcQuality', 'planar'],
  ],
  ['check-geometry', [task7Fixture], ['loadCheckGeometry', 'checkGeometry', 'rebuildTopology']],
  [
    'clip-erase',
    [task7Fixture, task7MaskFixture],
    ['loadClipErase', 'clipLayer', 'eraseLayer', 'mask'],
  ],
  ['dissolve', [task7Fixture], ['loadDissolve', 'dissolveLayer', 'refreshFieldOptions']],
  [
    'divide',
    [task7LineFixture, task7MaskFixture],
    ['loadDivide', 'divideLayer', 'fields', 'force'],
  ],
  ['explode', [task7Fixture], ['loadExplode', 'explodeLayer']],
  ['innerlines', [task7Fixture], ['loadInnerlines', 'innerlinesLayer', 'noReplace']],
  ['mosaic', [task7Fixture], ['loadMosaic', 'mosaicLayer', 'snapInterval', 'noSnap']],
  ['project', [task7Fixture], ['loadProject', 'projectLayer', 'densify', 'EPSG:3857']],
  [
    'rebuild-topology',
    [task7Fixture],
    ['loadRebuildTopology', 'translateSelected', 'rebuildTopology', 'snapInterval'],
  ],
  ['simplify-control', [task7Fixture], ['loadSimplifyControl', 'SimplifyControl']],
  [
    'simplify',
    [task7Fixture],
    ['loadSimplify', 'simplifyLayer', 'percentage', 'getFilteredPointCount'],
  ],
  ['snap-layer', [task7LineFixture], ['loadSnapLayer', 'snapLayer', 'export', 'endpoints']],
  ['union', [task7Fixture, task7MaskFixture], ['loadUnion', 'unionLayers', 'selectedTargets']],
  ['crs-switch', [task7Fixture], ['loadCrsSwitch', 'projectLayer', 'Gauss-Kruger', 'setActive']],
  [
    'web-worker',
    [task7Fixture],
    ['loadWebWorker', 'workerUrl', 'workerjobstart', 'cancelWorkerJobs'],
  ],
  [
    'duckdb-buffer',
    [task7Fixture],
    ['loadDuckDbBuffer', '@zwishing/emap/duckdb', 'bufferDatasetWithDuckDb'],
  ],
  [
    'duckdb-geoparquet-query',
    [],
    [
      'loadDuckDbGeoParquetQuery',
      'createDuckDbGeoParquetQuerySource',
      'duckDbGeoParquetQueryLayer',
    ],
  ],
  [
    'duckdb-overlay',
    [task7Fixture, task7MaskFixture],
    [
      'loadDuckDbOverlay',
      'intersectionDatasetWithDuckDb',
      'differenceDatasetWithDuckDb',
      'duckDbOverlayLayer',
    ],
  ],
  [
    'duckdb-query',
    [task7Fixture],
    ['loadDuckDbQuery', 'queryDatasetWithDuckDb', 'duckDbQueryLayer', 'validateDuckDbSelectSql'],
  ],
  [
    'duckdb-spatial-ops',
    [task7Fixture],
    ['loadDuckDbSpatialOps', 'runRelationOperation', 'centroidDatasetWithDuckDb', 'distanceWithin'],
  ],
] as const satisfies readonly (readonly [string, readonly string[], readonly string[]])[];

describe('example catalog metadata', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    emapRuntime.reset();
    duckDbRuntime.reset();
    document.body.innerHTML = '<div id="example-map"></div>';
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const path = String(url).replace(/^\//, '');
      const content = await readFile(resolve(process.cwd(), 'packages/examples/public', path));
      return new Response(content);
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.innerHTML = '';
  });

  it('defines unique, complete runnable example entries', () => {
    const ids = new Set<string>();

    for (const example of examples) {
      expect(ids.has(example.id), `${example.id} is duplicated`).toBe(false);
      ids.add(example.id);

      expect(example.title.zh.trim(), `${example.id} is missing zh title`).not.toBe('');
      expect(example.title.en.trim(), `${example.id} is missing en title`).not.toBe('');
      expect(example.docs.length, `${example.id} docs`).toBeGreaterThanOrEqual(1);
      expect(example.api, `${example.id} api`).toHaveLength(1);
      expect(example.success.trim(), `${example.id} success`).not.toBe('');
      expect(example.description.zh.trim(), `${example.id} is missing zh description`).not.toBe('');
      expect(example.description.en.trim(), `${example.id} is missing en description`).not.toBe('');
      expect(example.learningGoals.zh, `${example.id} zh learning goals`).not.toHaveLength(0);
      expect(example.learningGoals.en, `${example.id} en learning goals`).not.toHaveLength(0);
      expect(example.tags, `${example.id} tags`).not.toHaveLength(0);
      expect(example.featureFlags, `${example.id} feature flags`).toBeDefined();
      expect(example.route).toBe(`/examples/${example.id}/`);
      expect(example.load, `${example.id} load module`).toEqual(expect.any(Function));
    }
  });

  it('preserves the Task 4 seed IDs and fixture associations', () => {
    expect(
      expectedExamples.map(({ id }) => {
        const example = examples.find((item) => item.id === id);
        return {
          id: example?.id,
          fixtures: [...(example?.fixtures ?? [])],
        };
      }),
    ).toEqual(expectedExamples);
  });

  it('covers every Task 6 original HTML migration with declared fixtures and loader markers', async () => {
    const byId = new Map(examples.map((example) => [example.id, example]));
    const catalogSource = await readFile(resolve(process.cwd(), 'docs-meta/examples.ts'), 'utf8');

    for (const [id, fixtures, loaderMarkers] of task6Matrix) {
      const example = byId.get(id);
      expect(example, `${id} is missing from the catalog`).toBeDefined();
      expect(
        examples.filter((item) => item.id === id),
        `${id} duplicates`,
      ).toHaveLength(1);
      expect(example?.source.html).toBe(`test/examples/${id}.html`);
      expect(example?.fixtures, `${id} declared fixtures`).toEqual(fixtures);

      const originalHtml = await readFile(
        resolve(process.cwd(), `test/examples/${id}.html`),
        'utf8',
      );
      expect(originalHtml, `${id} original HTML has map surface`).toContain('id="map"');

      for (const fixture of fixtures) {
        await readFile(resolve(process.cwd(), 'packages/examples/public', fixture), 'utf8');
      }

      for (const marker of loaderMarkers) {
        expect(catalogSource, `${id} missing migrated marker ${marker}`).toContain(marker);
      }
    }
  });

  it('declares only fixtures that the migrated Task 6 loaders fetch', () => {
    const task6Ids: ReadonlySet<string> = new Set(task6Matrix.map(([id]) => id));

    for (const example of examples.filter((item) => task6Ids.has(item.id))) {
      if (example.id === 'geoparquet-viewer') {
        expect(example.fixtures, `${example.id} waits for user parquet/arrow uploads`).toEqual([]);
        continue;
      }
      expect(example.fixtures, `${example.id} has a fixture-backed runtime`).toContain(
        task6Fixture,
      );
      if (example.id === 'join') {
        expect(example.fixtures).toContain(task6CsvFixture);
      } else {
        expect(example.fixtures, `${example.id} must not fetch join CSV`).not.toContain(
          task6CsvFixture,
        );
      }
      if (example.id === 'merge-layers') {
        expect(example.fixtures).toContain(task6MergeFixture);
      } else {
        expect(example.fixtures, `${example.id} must not fetch merge-only fixture`).not.toContain(
          task6MergeFixture,
        );
      }
    }
  });

  it('preserves representative Task 6 behavior families', async () => {
    const catalogSource = await readFile(resolve(process.cwd(), 'docs-meta/examples.ts'), 'utf8');

    expect(extractFunction(catalogSource, 'setupGeoParquetViewer')).toEqual(
      expect.stringContaining('initFormats'),
    );
    expect(extractFunction(catalogSource, 'initFormats')).toEqual(
      expect.stringContaining('initParquetWasm'),
    );
    expect(extractFunction(catalogSource, 'setupGeoParquetViewer')).toEqual(
      expect.stringContaining('.parquet,.geoparquet,.arrow,.arrows,.feather'),
    );
    expect(extractFunction(catalogSource, 'setupMergeLayers')).toEqual(
      expect.stringContaining('multiple: true'),
    );
    expect(extractFunction(catalogSource, 'setupMergeLayers')).toEqual(
      expect.stringContaining('flatten.checked'),
    );
    expect(extractFunction(catalogSource, 'setupAttributeEditing')).toEqual(
      expect.stringContaining('attribute-row'),
    );
    expect(extractFunction(catalogSource, 'setupAttributeEditing')).toEqual(
      expect.stringContaining('setFeatureProperty'),
    );
    expect(extractFunction(catalogSource, 'clickToSelect')).toEqual(
      expect.stringContaining('shiftKey'),
    );
    expect(extractFunction(catalogSource, 'clickToSelect')).toEqual(
      expect.stringContaining('toggle'),
    );
  });

  it('preserves Task 6 control families through catalog feature flags', async () => {
    const byId = new Map(examples.map((example) => [example.id, example]));
    const catalogSource = await readFile(resolve(process.cwd(), 'docs-meta/examples.ts'), 'utf8');
    const createRuntime = extractFunction(catalogSource, 'createRuntime');

    expect(createRuntime).toEqual(expect.stringContaining('new HistoryControl'));
    expect(createRuntime).toEqual(expect.stringContaining('bindHistoryShortcuts'));
    expect(createRuntime).toEqual(expect.stringContaining('new BasemapControl'));
    expect(createRuntime).toEqual(expect.stringContaining('new StatusControl'));

    for (const id of task6ControlMatrix.history) {
      expect(byId.get(id)?.featureFlags, `${id} history controls`).toContain('history');
    }
    for (const id of task6ControlMatrix.basemap) {
      expect(byId.get(id)?.featureFlags, `${id} basemap/status controls`).toContain('basemap');
    }
    for (const id of ['geoparquet-viewer', 'export-geoparquet']) {
      expect(byId.get(id)?.featureFlags, `${id} format status control`).toContain('formats');
    }
  });

  it('covers every Task 7 spatial, platform, and DuckDB HTML migration', async () => {
    const byId = new Map(examples.map((example) => [example.id, example]));
    const catalogSource = await readFile(resolve(process.cwd(), 'docs-meta/examples.ts'), 'utf8');

    for (const [id, fixtures, loaderMarkers] of task7Matrix) {
      const example = byId.get(id);
      expect(example, `${id} is missing from the catalog`).toBeDefined();
      expect(
        examples.filter((item) => item.id === id),
        `${id} duplicates`,
      ).toHaveLength(1);
      expect(example?.source.html).toBe(`test/examples/${id}.html`);
      expect(example?.fixtures, `${id} declared fixtures`).toEqual(fixtures);
      expect(example?.docs.length, `${id} docs`).toBeGreaterThan(0);
      expect(example?.title.zh.trim(), `${id} zh title`).not.toBe('');
      expect(example?.title.en.trim(), `${id} en title`).not.toBe('');
      expect(example?.description.zh.trim(), `${id} zh description`).not.toBe('');
      expect(example?.description.en.trim(), `${id} en description`).not.toBe('');

      const originalHtml = await readFile(
        resolve(process.cwd(), `test/examples/${id}.html`),
        'utf8',
      );
      expect(originalHtml, `${id} original HTML has map surface`).toContain('id="map"');

      for (const fixture of fixtures) {
        await readFile(resolve(process.cwd(), 'packages/examples/public', fixture), 'utf8');
      }

      for (const marker of loaderMarkers) {
        expect(catalogSource, `${id} missing migrated marker ${marker}`).toContain(marker);
      }
    }
  });

  it('keeps Task 7 DuckDB optional imports inside lazy loaders only', async () => {
    const catalogSource = await readFile(resolve(process.cwd(), 'docs-meta/examples.ts'), 'utf8');
    const duckDbImport = "import('@zwishing/emap/duckdb')";
    const loadDuckDbModule = extractFunction(catalogSource, 'loadDuckDbModule');
    const runDuckDbExampleAction = extractFunction(catalogSource, 'runDuckDbExampleAction');

    expect(loadDuckDbModule).toContain(duckDbImport);
    expect(loadDuckDbModule).toContain('duckDbModulePromise = null');
    expect(loadDuckDbModule).toContain('duckDbRuntimePromise = null');
    expect(runDuckDbExampleAction).toContain('loadDuckDbModule');
    expect(runDuckDbExampleAction).toContain("dataset.state = 'error'");

    for (const name of [
      'setupDuckDbBuffer',
      'setupDuckDbGeoParquetQuery',
      'setupDuckDbOverlay',
      'setupDuckDbQuery',
      'setupDuckDbSpatialOps',
    ]) {
      expect(extractFunction(catalogSource, name), `${name} lazy DuckDB loader`).toContain(
        'runDuckDbExampleAction',
      );
    }
  });

  it('rebuilds the web-worker example map with selected worker settings', async () => {
    const example = examples.find((item) => item.id === 'web-worker');
    expect(example, 'web-worker catalog entry').toBeDefined();

    await expect(example?.load()).resolves.toBeUndefined();

    expect(emapRuntime.getMaps()).toHaveLength(1);
    expect(emapRuntime.getLastMap()?.options).toMatchObject({
      useWorker: 'auto',
      workerThreshold: 1,
      workerUrl: '/dist/emap-worker.js',
    });

    const mode = document.querySelector('select');
    const threshold = document.querySelector('input');
    expect(mode, 'worker mode select').toBeInstanceOf(HTMLSelectElement);
    expect(threshold, 'worker threshold input').toBeInstanceOf(HTMLInputElement);

    if (mode instanceof HTMLSelectElement) mode.value = 'on';
    if (threshold instanceof HTMLInputElement) threshold.value = '12';
    buttonByText('Rebuild map').click();
    await settleAsyncWork();

    expect(emapRuntime.getMaps()).toHaveLength(2);
    expect(emapRuntime.getLastMap()?.options).toMatchObject({
      useWorker: true,
      workerThreshold: 12,
      workerUrl: '/dist/emap-worker.js',
    });
    expect(document.querySelector('.example-inline-status')?.textContent).toContain(
      'mode=on threshold=12',
    );
  });

  it('renders DuckDB runtime errors and retries after a rejected cached runtime promise', async () => {
    duckDbRuntime.module.createDuckDbRuntimeFromJsDelivr
      .mockRejectedValueOnce(new Error('cdn offline'))
      .mockResolvedValueOnce(duckDbRuntime.runtime);
    const example = examples.find((item) => item.id === 'duckdb-buffer');
    expect(example, 'duckdb-buffer catalog entry').toBeDefined();

    await expect(example?.load()).resolves.toBeUndefined();

    buttonByText('Generate DuckDB buffer').click();
    await settleAsyncWork();

    const status = document.querySelector('.example-inline-status');
    expect(status?.getAttribute('data-state')).toBe('error');
    expect(status?.textContent).toContain('DuckDB is unavailable or the operation failed');
    expect(status?.textContent).toContain('cdn offline');
    expect(duckDbRuntime.module.createDuckDbRuntimeFromJsDelivr).toHaveBeenCalledTimes(1);
    expect(duckDbRuntime.module.bufferDatasetWithDuckDb).not.toHaveBeenCalled();

    buttonByText('Generate DuckDB buffer').click();
    await settleAsyncWork();

    expect(duckDbRuntime.module.createDuckDbRuntimeFromJsDelivr).toHaveBeenCalledTimes(2);
    expect(duckDbRuntime.module.setDuckDbRuntime).toHaveBeenCalledWith(duckDbRuntime.runtime);
    expect(duckDbRuntime.module.bufferDatasetWithDuckDb).toHaveBeenCalledTimes(1);
    expect(status?.getAttribute('data-state')).toBe('ready');
    expect(status?.textContent).toContain('DuckDB buffer generated for polygons.');
  });

  it('renders DuckDB operation errors without rejecting button actions', async () => {
    duckDbRuntime.module.queryDatasetWithDuckDb.mockRejectedValueOnce(new Error('query failed'));
    const example = examples.find((item) => item.id === 'duckdb-query');
    expect(example, 'duckdb-query catalog entry').toBeDefined();

    await expect(example?.load()).resolves.toBeUndefined();

    buttonByText('Run SELECT').click();
    await settleAsyncWork();

    const status = document.querySelector('.example-inline-status');
    expect(status?.getAttribute('data-state')).toBe('error');
    expect(status?.textContent).toContain('DuckDB is unavailable or the operation failed');
    expect(status?.textContent).toContain('query failed');
  });

  it('smoke-loads the lasso example without enabling mutually exclusive controls together', async () => {
    const example = examples.find((item) => item.id === 'lasso-select');
    expect(example, 'lasso-select catalog entry').toBeDefined();

    await expect(example?.load()).resolves.toBeUndefined();

    const map = emapRuntime.getLastMap();
    expect(map?.boxSelect.isEnabled()).toBe(true);
    expect(map?.lassoSelect.isEnabled()).toBe(false);

    const buttons = Array.from(document.querySelectorAll('button'));
    const boxButton = buttons.find((button) => button.textContent === 'Box');
    const lassoButton = buttons.find((button) => button.textContent === 'Lasso');
    const status = document.querySelector('.example-inline-status');

    expect(boxButton, 'box mode button').toBeDefined();
    expect(lassoButton, 'lasso mode button').toBeDefined();
    expect(boxButton?.disabled).toBe(true);
    expect(lassoButton?.disabled).toBe(false);
    expect(status?.textContent).toContain('Box select is active');

    lassoButton?.click();
    expect(map?.boxSelect.isEnabled()).toBe(false);
    expect(map?.lassoSelect.isEnabled()).toBe(true);
    expect(boxButton?.disabled).toBe(false);
    expect(lassoButton?.disabled).toBe(true);
    expect(status?.textContent).toContain('Lasso select is active');

    boxButton?.click();
    expect(map?.boxSelect.isEnabled()).toBe(true);
    expect(map?.lassoSelect.isEnabled()).toBe(false);
    expect(boxButton?.disabled).toBe(true);
    expect(lassoButton?.disabled).toBe(false);
    expect(status?.textContent).toContain('Box select is active');
  });

  it('keeps one static route HTML input and Vite route ID for every catalog example', async () => {
    const routeRoot = resolve(process.cwd(), 'packages/examples/examples');
    const routeFiles = await collectHtmlFiles(routeRoot);
    const expectedFiles = examples
      .map(({ id }) => join('packages/examples/examples', id, 'index.html'))
      .sort();
    const viteConfig = await readFile(
      resolve(process.cwd(), 'packages/examples/vite.config.ts'),
      'utf8',
    );

    expect(routeFiles).toEqual(expectedFiles);

    for (const file of routeFiles) {
      const html = await readFile(resolve(process.cwd(), file), 'utf8');
      expect(html).toContain('src="/src/main.ts"');
    }

    for (const example of examples) {
      expect(viteConfig, `${example.id} missing from Vite routeIds`).toContain(`'${example.id}'`);
    }
  });

  it('normalizes direct static route paths to catalog IDs', () => {
    expect(exampleIdForPath('/examples/getting-started/points')).toBe('getting-started/points');
    expect(exampleIdForPath('/examples/getting-started/points/')).toBe('getting-started/points');
    expect(exampleIdForPath('/examples/getting-started/points/index.html')).toBe(
      'getting-started/points',
    );
    expect(exampleIdForPath('/examples/attribute-editing/index.html')).toBe('attribute-editing');
  });
});

async function collectHtmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return collectHtmlFiles(path);
      if (entry.isFile() && entry.name === 'index.html') {
        return [relative(process.cwd(), path)];
      }
      return [];
    }),
  );
  return files.flat().sort();
}

function exampleIdForPath(pathname: string): string | null {
  return resolveExampleId({
    hash: '',
    pathname,
  } as Location);
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(
    (item) => item.textContent === text,
  );
  expect(button, `${text} button`).toBeInstanceOf(HTMLButtonElement);
  return button as HTMLButtonElement;
}

async function settleAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  expect(start, `${name} start`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nfunction ', start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}
