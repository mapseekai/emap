import {
  BasemapControl,
  BoxSelectControl,
  DrawFeatureControl,
  EditToolbar,
  Emap,
  HistoryControl,
  LassoSelectControl,
  NavigationControl,
  SimplifyControl,
  StatusControl,
  TopologySource,
  VertexEditControl,
  rotateMatrix,
  scaleMatrix,
  type ExportFormat,
  type FeatureRef,
  type LayerSpecification,
  type MapOptions,
  type MapshaperDataset,
  type MapshaperLayer,
  type OpResult,
} from '@zwishing/emap';
import { initParquetWasm } from '@zwishing/emap/formats';

type LocalizedText = { zh: string; en: string };

export interface ExampleDefinition {
  id: string;
  category: string;
  title: LocalizedText;
  description: LocalizedText;
  learningGoals: { zh: readonly string[]; en: readonly string[] };
  docs: readonly string[];
  api: readonly string[];
  tags: readonly string[];
  featureFlags: readonly string[];
  fixtures: readonly string[];
  source: { html: string };
  route: string;
  success: string;
  load: () => Promise<void>;
}

type GeoJsonFeature = {
  type: 'Feature';
  properties: Record<string, number | string>;
  geometry: {
    type: 'Point' | 'MultiPoint' | 'LineString' | 'Polygon';
    coordinates: unknown;
  };
};

type FeatureCollection = {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
};

type ExampleSeed = Omit<ExampleDefinition, 'load'> & {
  filename: string;
  geojson: FeatureCollection;
  layer: Omit<LayerSpecification, 'source'>;
};

type RecipeContext = {
  map: Emap;
  source: TopologySource;
  sourceId: string;
  target: string;
  toolbar: HTMLElement;
  panel: HTMLElement;
  status: HTMLElement;
  container: HTMLElement;
  csvFixture?: string;
  workerSettings?: WebWorkerSettings;
  rebuildWebWorker?: (settings: WebWorkerSettings) => Promise<void>;
};

type RecipeDefinition = Omit<ExampleDefinition, 'load'> & {
  sourceId: string;
  filename: string;
  load: () => Promise<void>;
};

type RuntimeOptions = {
  sourceId: string;
  filename: string;
  fixture?: string;
  fixtures?: readonly string[];
  mapOptions?: Omit<MapOptions, 'container'>;
};

type GeoJsonRuntimeOptions = RuntimeOptions & {
  setup: (ctx: RecipeContext) => void | Promise<void>;
  csvFixture?: string;
};

type FileData = {
  filename: string;
  content: Uint8Array;
};

type DuckDbModule = typeof import('@zwishing/emap/duckdb');
type DuckDbMapOpContext = Parameters<DuckDbModule['duckDbQueryLayer']>[0];
type WebWorkerMode = 'auto' | 'on' | 'off';

type WebWorkerSettings = {
  mode: WebWorkerMode;
  threshold: number;
};

let activeMap: Emap | null = null;
let duckDbModulePromise: Promise<DuckDbModule> | null = null;
let duckDbRuntimePromise: Promise<
  Awaited<ReturnType<DuckDbModule['createDuckDbRuntimeFromJsDelivr']>>
> | null = null;

const sourceId = 'example';
const docsEmap = '/docs/concepts/emap';
const docsSourceLayer = '/docs/concepts/source-layer';
const docsCrs = '/docs/concepts/coordinates-crs';
const docsStyling = '/docs/guides/styling';
const docsEvents = '/docs/guides/events';
const docsSelection = '/docs/guides/selection';
const docsEditing = '/docs/guides/editing';
const docsControls = '/docs/guides/controls';
const docsWorker = '/docs/guides/worker';
const docsFormats = '/docs/data/formats';
const docsAttributes = '/docs/data/attributes';
const docsOperations = '/docs/data/operations';
const docsDuckDb = '/docs/data/duckdb';
const docsFileUpload = '/docs/recipes/file-upload';
const docsStatusControl = '/docs/recipes/status-control';
const docsUndoRedo = '/docs/recipes/undo-redo';
const docsFitBounds = '/docs/recipes/fit-bounds';
const docsPerformance = '/docs/recipes/performance';
const docsErrorHandling = '/docs/recipes/error-handling';
const docsErrors = '/docs/reference/errors';
const docsCompatibility = '/docs/reference/compatibility';
const docsMigration = '/docs/reference/migration';
const task6Fixture = 'fixtures/task-6-polygons.geojson';
const task6CsvFixture = 'fixtures/task-6-join.csv';
const task6MergeFixture = 'fixtures/task-6-polygons-alt.geojson';
const task7Fixture = 'fixtures/task-7-polygons.geojson';
const task7LineFixture = 'fixtures/task-7-lines.geojson';
const task7MaskFixture = 'fixtures/task-7-mask.geojson';
const workerUrl = '/dist/emap-worker.js';
const defaultWebWorkerSettings: WebWorkerSettings = { mode: 'auto', threshold: 1 };

const route = (id: string) => `/examples/${id}/`;
const originalHtml = (id: string) => `test/examples/${id}.html`;
const seedMetadata = {
  description: {
    zh: '加载内联 GeoJSON，演示最小化地图初始化和图层渲染路径。',
    en: 'Loads inline GeoJSON to demonstrate the minimal map setup and layer rendering path.',
  },
  learningGoals: {
    zh: ['初始化 Emap 容器', '通过 TopologySource 加载内联数据', '添加可见图层并缩放至范围'],
    en: ['Initialize an Emap container', 'Load inline data with TopologySource', 'Add a visible layer and fit its extent'],
  },
  tags: ['getting-started', 'inline-fixture'],
  featureFlags: [] as readonly string[],
};

const seeds: readonly ExampleSeed[] = [
  {
    id: 'getting-started/geojson-viewer',
    category: 'getting-started',
    title: { zh: 'GeoJSON 查看器', en: 'GeoJSON viewer' },
    ...seedMetadata,
    docs: [docsEmap, docsSourceLayer, docsFitBounds],
    api: ['Emap'],
    fixtures: ['inline:geojson-viewer.geojson'],
    source: { html: 'packages/examples/examples/getting-started/geojson-viewer/index.html' },
    route: route('getting-started/geojson-viewer'),
    success: 'The map renders a small mixed GeoJSON scene and fits it in the viewport.',
    filename: 'geojson-viewer.geojson',
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Harbor district' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-122.43, 37.77],
                [-122.39, 37.77],
                [-122.39, 37.8],
                [-122.43, 37.8],
                [-122.43, 37.77],
              ],
            ],
          },
        },
      ],
    },
    layer: {
      id: 'geojson-viewer-fill',
      type: 'fill',
      paint: { 'fill-color': '#2f6f73', 'fill-opacity': 0.32, 'line-color': '#173e43' },
    },
  },
  {
    id: 'getting-started/points',
    category: 'getting-started',
    title: { zh: '点图层', en: 'Points' },
    ...seedMetadata,
    docs: [docsSourceLayer, docsFileUpload],
    api: ['TopologySource.fromBytes'],
    fixtures: ['inline:points.geojson'],
    source: { html: 'packages/examples/examples/getting-started/points/index.html' },
    route: route('getting-started/points'),
    success: 'Three point features render as circle marks with distinct attribute records.',
    filename: 'points.geojson',
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'North', rank: 1 },
          geometry: { type: 'Point', coordinates: [-122.42, 37.81] },
        },
        {
          type: 'Feature',
          properties: { name: 'Central', rank: 2 },
          geometry: { type: 'Point', coordinates: [-122.41, 37.78] },
        },
        {
          type: 'Feature',
          properties: { name: 'South', rank: 3 },
          geometry: { type: 'Point', coordinates: [-122.39, 37.75] },
        },
      ],
    },
    layer: {
      id: 'points-circle',
      type: 'circle',
      paint: { 'circle-color': '#b3425f', 'circle-radius': 6 },
    },
  },
  {
    id: 'getting-started/lines',
    category: 'getting-started',
    title: { zh: '线图层', en: 'Lines' },
    ...seedMetadata,
    docs: [docsSourceLayer, docsStyling],
    api: ['LayerSpecification'],
    fixtures: ['inline:lines.geojson'],
    source: { html: 'packages/examples/examples/getting-started/lines/index.html' },
    route: route('getting-started/lines'),
    success: 'Two route features render as stroked line paths.',
    filename: 'lines.geojson',
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { route: 'waterfront' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-122.45, 37.78],
              [-122.43, 37.8],
              [-122.4, 37.79],
              [-122.38, 37.81],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { route: 'market' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-122.44, 37.76],
              [-122.42, 37.765],
              [-122.4, 37.77],
              [-122.38, 37.775],
            ],
          },
        },
      ],
    },
    layer: {
      id: 'lines-stroke',
      type: 'line',
      paint: { 'line-color': '#335c99', 'line-width': 2 },
    },
  },
  {
    id: 'getting-started/polygons',
    category: 'getting-started',
    title: { zh: '面边界', en: 'Polygons' },
    ...seedMetadata,
    docs: [docsStyling],
    api: ['LinePaint'],
    fixtures: ['inline:polygons.geojson'],
    source: { html: 'packages/examples/examples/getting-started/polygons/index.html' },
    route: route('getting-started/polygons'),
    success: 'Two polygon boundaries render as linework while preserving topology.',
    filename: 'polygons.geojson',
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { zone: 'A' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-122.45, 37.76],
                [-122.42, 37.76],
                [-122.42, 37.79],
                [-122.45, 37.79],
                [-122.45, 37.76],
              ],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { zone: 'B' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-122.41, 37.76],
                [-122.38, 37.76],
                [-122.38, 37.79],
                [-122.41, 37.79],
                [-122.41, 37.76],
              ],
            ],
          },
        },
      ],
    },
    layer: {
      id: 'polygons-outline',
      type: 'line',
      paint: { 'line-color': '#5a5f33', 'line-width': 1.6 },
    },
  },
  {
    id: 'getting-started/polygon-fill',
    category: 'getting-started',
    title: { zh: '面填充', en: 'Polygon fill' },
    ...seedMetadata,
    docs: [docsStyling],
    api: ['FillPaint'],
    fixtures: ['inline:polygon-fill.geojson'],
    source: { html: 'packages/examples/examples/getting-started/polygon-fill/index.html' },
    route: route('getting-started/polygon-fill'),
    success: 'The polygon layer renders with a translucent fill and visible outline.',
    filename: 'polygon-fill.geojson',
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Park' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-122.44, 37.75],
                [-122.38, 37.75],
                [-122.37, 37.8],
                [-122.43, 37.82],
                [-122.46, 37.78],
                [-122.44, 37.75],
              ],
            ],
          },
        },
      ],
    },
    layer: {
      id: 'polygon-fill',
      type: 'fill',
      paint: { 'fill-color': '#6b8f3d', 'fill-opacity': 0.42, 'line-color': '#324719' },
    },
  },
];

const recipes: readonly RecipeDefinition[] = [
  recipe('attribute-editing', 'data', '属性编辑', 'Attribute editing', [docsAttributes, docsEditing, docsUndoRedo], 'Emap', ['attributes', 'history'], [task6Fixture], 'attr-source', loadAttributeEditing),
  recipe('attribute-expressions', 'data', '属性表达式批量更新', 'Attribute expressions', [docsAttributes, docsMigration], 'Emap', ['expressions', 'attributes', 'history'], [task6Fixture], 'attribute-expressions-source', loadAttributeExpressions),
  recipe('data-engineering', 'data', '数据工程批次', 'Data engineering batch', [docsOperations, docsAttributes], 'Emap', ['expressions', 'layer-ops', 'history'], [task6Fixture], 'data-engineering-source', loadDataEngineering),
  recipe('feature-attributes', 'data', '要素属性查询', 'Feature attributes', [docsAttributes, docsEvents], 'Emap', ['query', 'highlight', 'basemap'], [task6Fixture], 'feature-attributes-source', loadFeatureAttributes),
  recipe('filter-features', 'data', '要素过滤', 'Filter features', [docsAttributes, docsOperations], 'Emap', ['expressions', 'layer-ops', 'history'], [task6Fixture], 'filter-features-source', loadFilterFeatures),
  recipe('geoparquet-viewer', 'data', 'GeoParquet / GeoArrow 查看器', 'GeoParquet / GeoArrow viewer', [docsFormats, docsFileUpload, docsCompatibility], 'TopologySource.fromBytes', ['formats', 'basemap'], [], 'parquet-source', loadGeoParquetViewer),
  recipe('export-geoparquet', 'data', '导出 GeoParquet / GeoArrow', 'Export GeoParquet / GeoArrow', [docsFormats], 'TopologySource.fromBytes', ['formats', 'export', 'basemap'], [task6Fixture], 'main-source', loadExportGeoparquet),
  recipe('export-roundtrip', 'data', '导出往返', 'Export roundtrip', [docsFormats, docsEditing], 'TopologySource.fromBytes', ['export', 'editing'], [task6Fixture], 'export-roundtrip-source', loadExportRoundtrip),
  recipe('join', 'data', '属性表连接', 'Join table', [docsAttributes], 'Emap', ['join', 'history'], [task6Fixture, task6CsvFixture], 'join-source', loadJoin),
  recipe('merge-layers', 'layers', '合并图层', 'Merge layers', [docsSourceLayer, docsOperations], 'Emap', ['layer-ops', 'history'], [task6Fixture, task6MergeFixture], 'merge-source', loadMergeLayers),
  recipe('merge-selected', 'layers', '合并选中要素', 'Merge selected features', [docsSelection, docsOperations], 'Emap', ['selection', 'layer-ops', 'history'], [task6Fixture], 'merge-selected-source', loadMergeSelected),
  recipe('rename-layer', 'layers', '图层重命名', 'Rename layer', [docsSourceLayer, docsOperations], 'Emap', ['layer-ops', 'history'], [task6Fixture], 'rename-layer-source', loadRenameLayer),
  recipe('split-layer', 'layers', '图层拆分', 'Split layer', [docsSourceLayer, docsOperations, docsAttributes], 'Emap', ['expressions', 'layer-ops', 'history'], [task6Fixture], 'split-layer-source', loadSplitLayer),
  recipe('interaction-handlers', 'interaction', '交互 Handler', 'Interaction handlers', [docsEvents, docsControls], 'Emap', ['handlers'], [task6Fixture], 'interaction-handlers-source', loadInteractionHandlers),
  recipe('feature-selection', 'interaction', '要素选择', 'Feature selection', [docsSelection], 'Emap', ['selection', 'history'], [task6Fixture], 'select-source', loadFeatureSelection),
  recipe('box-select', 'interaction', '拉框选择', 'Box select', [docsSelection, docsControls], 'Emap', ['selection', 'box-select', 'history'], [task6Fixture], 'box-select-source', loadBoxSelect),
  recipe('lasso-select', 'interaction', '拉框 / 套索选择切换', 'Box and lasso select', [docsSelection, docsControls], 'Emap', ['selection', 'box-select', 'lasso-select', 'history'], [task6Fixture], 'lasso-select-source', loadLassoSelect),
  recipe('china-editing', 'editing', '中国行政区划编辑', 'China administrative editing', [docsEditing, docsControls], 'Emap', ['editing', 'basemap'], [task6Fixture], 'china-editing-source', loadChinaEditing),
  recipe('draw-snap-clear', 'editing', '绘制吸附清理', 'Draw snap and clear', [docsEditing], 'Emap', ['drawing', 'snap', 'history'], [task6Fixture], 'draw-snap-clear-source', loadDrawSnapClear),
  recipe('draw-snap-edge', 'editing', '绘制时吸附顶点 + 边', 'Draw snap to vertex and edge', [docsEditing, docsControls], 'Emap', ['drawing', 'snap', 'history'], [task6Fixture], 'draw-snap-edge-source', loadDrawSnapEdge),
  recipe('feature-rotate-scale', 'editing', '旋转 / 缩放选中要素', 'Rotate and scale selected feature', [docsEditing, docsSelection], 'Emap', ['selection', 'transform', 'history'], [task6Fixture], 'feature-rotate-scale-source', loadFeatureRotateScale),
  recipe('feature-translate', 'editing', '平移选中要素', 'Translate selected feature', [docsEditing, docsSelection], 'Emap', ['selection', 'transform', 'history'], [task6Fixture], 'feature-translate-source', loadFeatureTranslate),
  recipe('snapshot', 'editing', '多源快照保存 / 恢复', 'Snapshot save and restore', [docsEditing], 'Emap', ['snapshot'], [task6Fixture], 'snapshot-source', loadSnapshot),
  recipe('transaction', 'editing', 'Transaction + Validation', 'Transaction and validation', [docsEditing, docsErrors], 'Emap', ['transaction', 'validation', 'history'], [task6Fixture], 'transaction-source', loadTransaction),
  recipe('undo-redo', 'editing', '撤销 / 重做', 'Undo and redo', [docsUndoRedo, docsEditing], 'Emap', ['editing', 'history'], [task6Fixture], 'undo-redo-source', loadUndoRedo),
  recipe('vertex-editing', 'editing', '顶点编辑', 'Vertex editing', [docsEditing, docsControls], 'Emap', ['editing', 'vertex', 'basemap'], [task6Fixture], 'vertex-editing-source', loadVertexEditing),
  recipe('buffer', 'spatial', '缓冲区', 'Buffer', [docsOperations], 'Emap', ['spatial', 'history'], [task7Fixture], 'buffer-source', loadBuffer),
  recipe('check-geometry', 'validation', '几何检查', 'Check geometry', [docsOperations, docsErrors], 'Emap', ['validation', 'history'], [task7Fixture], 'check-geometry-source', loadCheckGeometry),
  recipe('clip-erase', 'spatial', '裁剪 / 擦除', 'Clip and erase', [docsOperations], 'Emap', ['spatial', 'overlay', 'history'], [task7Fixture, task7MaskFixture], 'cliperase-source', loadClipErase),
  recipe('dissolve', 'spatial', '融合', 'Dissolve', [docsOperations], 'Emap', ['spatial', 'history'], [task7Fixture], 'dissolve-source', loadDissolve),
  recipe('divide', 'spatial', '按面切分线', 'Divide lines by polygons', [docsOperations], 'Emap', ['spatial', 'overlay', 'history'], [task7LineFixture, task7MaskFixture], 'divide-source', loadDivide),
  recipe('explode', 'spatial', '拆分多部件', 'Explode multipart features', [docsOperations], 'Emap', ['spatial', 'history'], [task7Fixture], 'explode-source', loadExplode),
  recipe('innerlines', 'spatial', '抽取共享边', 'Innerlines', [docsOperations], 'Emap', ['spatial', 'history'], [task7Fixture], 'inner-source', loadInnerlines),
  recipe('mosaic', 'spatial', '平展重叠面', 'Mosaic', [docsOperations], 'Emap', ['spatial', 'history'], [task7Fixture], 'mosaic-source', loadMosaic),
  recipe('project', 'crs', '投影转换', 'Project CRS', [docsCrs, docsOperations], 'Emap', ['crs', 'history', 'basemap'], [task7Fixture], 'project-source', loadProject),
  recipe('rebuild-topology', 'validation', '重建拓扑', 'Rebuild topology', [docsOperations, docsEditing], 'Emap', ['validation', 'editing', 'history'], [task7Fixture], 'rebuild-source', loadRebuildTopology),
  recipe('simplify-control', 'spatial', '简化控件', 'Simplify control', [docsOperations, docsControls, docsPerformance], 'Emap', ['spatial', 'controls', 'history'], [task7Fixture], 'simplify-control-source', loadSimplifyControl),
  recipe('simplify', 'spatial', '几何简化', 'Simplify geometry', [docsOperations, docsPerformance], 'Emap', ['spatial', 'history'], [task7Fixture], 'simplify-source', loadSimplify),
  recipe('snap-layer', 'spatial', '批量吸附', 'Snap layer', [docsOperations], 'Emap', ['spatial', 'export', 'history'], [task7LineFixture], 'snap-source', loadSnapLayer),
  recipe('union', 'spatial', '面并集', 'Union polygons', [docsOperations], 'Emap', ['spatial', 'overlay', 'history'], [task7Fixture, task7MaskFixture], 'union-source', loadUnion),
  recipe('crs-switch', 'crs', '坐标系切换', 'CRS switch', [docsCrs], 'Emap', ['crs', 'history', 'basemap'], [task7Fixture], 'crs-demo', loadCrsSwitch),
  recipe('web-worker', 'platform', 'Web Worker 重命令', 'Web Worker heavy operations', [docsWorker, docsPerformance], 'Emap', ['worker', 'history'], [task7Fixture], 'worker-demo-source', loadWebWorker),
  recipe('duckdb-buffer', 'duckdb', 'DuckDB 缓冲区', 'DuckDB buffer', [docsDuckDb, docsErrorHandling], 'Emap', ['duckdb', 'basemap'], [task7Fixture], 'duckdb-input', loadDuckDbBuffer),
  recipe('duckdb-geoparquet-query', 'duckdb', 'DuckDB GeoParquet 查询', 'DuckDB GeoParquet query', [docsDuckDb, docsFormats, docsStatusControl], 'Emap', ['duckdb', 'geoparquet', 'basemap'], [], 'duckdb-geoparquet-bytes', loadDuckDbGeoParquetQuery),
  recipe('duckdb-overlay', 'duckdb', 'DuckDB Overlay', 'DuckDB overlay', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'overlay', 'basemap'], [task7Fixture, task7MaskFixture], 'duckdb-overlay-input', loadDuckDbOverlay),
  recipe('duckdb-query', 'duckdb', 'DuckDB 受限 SELECT', 'DuckDB restricted SELECT', [docsDuckDb, docsStatusControl, docsErrorHandling], 'Emap', ['duckdb', 'query', 'basemap'], [task7Fixture], 'duckdb-query-input', loadDuckDbQuery),
  recipe('duckdb-spatial-ops', 'duckdb', 'DuckDB 空间函数', 'DuckDB spatial functions', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'basemap'], [task7Fixture], 'duckdb-spatial-input', loadDuckDbSpatialOps),
];

export const examples: readonly ExampleDefinition[] = [
  ...seeds.map((seed) => ({
    id: seed.id,
    category: seed.category,
    title: seed.title,
    description: seed.description,
    learningGoals: seed.learningGoals,
    docs: seed.docs,
    api: seed.api,
    tags: seed.tags,
    featureFlags: seed.featureFlags,
    fixtures: seed.fixtures,
    source: seed.source,
    route: seed.route,
    success: seed.success,
    load: () => loadSeed(seed),
  })),
  ...recipes.map((item) => ({
    id: item.id,
    category: item.category,
    title: item.title,
    description: item.description,
    learningGoals: item.learningGoals,
    docs: item.docs,
    api: item.api,
    tags: item.tags,
    featureFlags: item.featureFlags,
    fixtures: item.fixtures,
    source: item.source,
    route: item.route,
    success: item.success,
    load: item.load,
  })),
];

function recipe(
  id: string,
  category: string,
  zh: string,
  en: string,
  docRefs: readonly string[],
  api: string,
  featureFlags: readonly string[],
  fixtures: readonly string[],
  sourceId: string,
  load: () => Promise<void>,
): RecipeDefinition {
  const sourceHtml = originalHtml(id);
  return {
    id,
    category,
    title: { zh, en },
    description: {
      zh: `从 ${sourceHtml} 迁移的独立 Vite 示例，自动加载静态夹具并保留原始交互控件。`,
      en: `Standalone Vite migration of ${sourceHtml}; it auto-loads a static fixture and keeps the original interaction controls.`,
    },
    learningGoals: {
      zh: [`复现 ${zh} 的数据加载顺序`, `运行 ${api} 相关 API`, '确认页面状态栏中的成功条件'],
      en: [`Reproduce the data-loading order for ${en}`, `Run the ${api} API path`, 'Confirm the success condition in the status bar'],
    },
    docs: docRefs,
    api: [api],
    tags: [category, id, ...featureFlags],
    featureFlags,
    fixtures,
    source: { html: sourceHtml },
    route: route(id),
    success: `${en} route loads its fixture and exposes the migrated controls from ${sourceHtml}.`,
    sourceId,
    filename: fixtures[0] ? basename(fixtures[0]) : '',
    load,
  };
}

async function loadSeed(seed: ExampleSeed): Promise<void> {
  const container = getMapContainer();
  activeMap?.remove();
  activeMap = null;
  container.replaceChildren();

  const map = new Emap({ container });
  activeMap = map;

  const source = await TopologySource.fromBytes(sourceId, encodeGeoJson(seed), {
    filename: seed.filename,
  });
  map.addSource(sourceId, source);
  map.addLayer({ ...seed.layer, source: sourceId });

  const extent = source.getExtent();
  if (extent.hasBounds()) {
    map.fitBounds(extent, { padding: 48, duration: 0 });
  }
}

async function loadAttributeEditing(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'attr-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    setup: setupAttributeEditing,
  });
}

async function loadAttributeExpressions(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'attribute-expressions-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    mapOptions: { expressionPolicy: 'trusted' },
    setup: setupAttributeExpressions,
  });
}

async function loadDataEngineering(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'data-engineering-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    mapOptions: { expressionPolicy: 'trusted' },
    setup: setupDataEngineering,
  });
}

async function loadFeatureAttributes(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'feature-attributes-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    setup: setupFeatureAttributes,
  });
}

async function loadFilterFeatures(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'filter-features-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    mapOptions: { expressionPolicy: 'trusted' },
    setup: setupFilterFeatures,
  });
}

async function loadGeoParquetViewer(): Promise<void> {
  const runtime = createRuntime({
    sourceId: 'parquet-source',
    filename: '',
  });
  await setupGeoParquetViewer({
    map: runtime.map,
    source: new TopologySource('parquet-source'),
    sourceId: 'parquet-source',
    target: '',
    toolbar: runtime.toolbar,
    panel: runtime.panel,
    status: runtime.status,
    container: runtime.container,
  });
}

async function loadExportGeoparquet(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'main-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    setup: setupExportGeoparquet,
  });
}

async function loadExportRoundtrip(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'export-roundtrip-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    setup: setupExportRoundtrip,
  });
}

async function loadJoin(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'join-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    csvFixture: task6CsvFixture,
    mapOptions: { expressionPolicy: 'trusted' },
    setup: setupJoin,
  });
}

async function loadMergeLayers(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'merge-source',
    filename: basename(task6Fixture),
    fixtures: [task6Fixture, task6MergeFixture],
    setup: setupMergeLayers,
  });
}

async function loadMergeSelected(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'merge-selected-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    setup: setupMergeSelected,
  });
}

async function loadRenameLayer(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'rename-layer-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    setup: setupRenameLayer,
  });
}

async function loadSplitLayer(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'split-layer-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    mapOptions: { expressionPolicy: 'trusted' },
    setup: setupSplitLayer,
  });
}

async function loadInteractionHandlers(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'interaction-handlers-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    setup: setupInteractionHandlers,
  });
}

async function loadFeatureSelection(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'select-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    setup: setupFeatureSelection,
  });
}

async function loadBoxSelect(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'box-select-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    setup: setupBoxSelect,
  });
}

async function loadLassoSelect(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'lasso-select-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    setup: setupLassoSelect,
  });
}

async function loadChinaEditing(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'china-editing-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    setup: setupChinaEditing,
  });
}

async function loadDrawSnapClear(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'draw-snap-clear-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    setup: setupDrawSnapClear,
  });
}

async function loadDrawSnapEdge(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'draw-snap-edge-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    setup: setupDrawSnapEdge,
  });
}

async function loadFeatureRotateScale(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'feature-rotate-scale-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    setup: setupFeatureRotateScale,
  });
}

async function loadFeatureTranslate(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'feature-translate-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    setup: setupFeatureTranslate,
  });
}

async function loadSnapshot(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'snapshot-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    setup: setupSnapshot,
  });
}

async function loadTransaction(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'transaction-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    mapOptions: { expressionPolicy: 'trusted' },
    setup: setupTransaction,
  });
}

async function loadUndoRedo(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'undo-redo-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    setup: setupUndoRedo,
  });
}

async function loadVertexEditing(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'vertex-editing-source',
    filename: basename(task6Fixture),
    fixture: task6Fixture,
    setup: setupVertexEditing,
  });
}

async function loadBuffer(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'buffer-source',
    filename: basename(task7Fixture),
    fixture: task7Fixture,
    mapOptions: { expressionPolicy: 'trusted' },
    setup: setupBuffer,
  });
}

async function loadCheckGeometry(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'check-geometry-source',
    filename: basename(task7Fixture),
    fixture: task7Fixture,
    setup: setupCheckGeometry,
  });
}

async function loadClipErase(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'cliperase-source',
    filename: basename(task7Fixture),
    fixtures: [task7Fixture, task7MaskFixture],
    setup: setupClipErase,
  });
}

async function loadDissolve(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'dissolve-source',
    filename: basename(task7Fixture),
    fixture: task7Fixture,
    setup: setupDissolve,
  });
}

async function loadDivide(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'divide-source',
    filename: basename(task7LineFixture),
    fixtures: [task7LineFixture, task7MaskFixture],
    setup: setupDivide,
  });
}

async function loadExplode(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'explode-source',
    filename: basename(task7Fixture),
    fixture: task7Fixture,
    setup: setupExplode,
  });
}

async function loadInnerlines(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'inner-source',
    filename: basename(task7Fixture),
    fixture: task7Fixture,
    mapOptions: { expressionPolicy: 'trusted' },
    setup: setupInnerlines,
  });
}

async function loadMosaic(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'mosaic-source',
    filename: basename(task7Fixture),
    fixture: task7Fixture,
    setup: setupMosaic,
  });
}

async function loadProject(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'project-source',
    filename: basename(task7Fixture),
    fixture: task7Fixture,
    setup: setupProject,
  });
}

async function loadRebuildTopology(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'rebuild-source',
    filename: basename(task7Fixture),
    fixture: task7Fixture,
    setup: setupRebuildTopology,
  });
}

async function loadSimplifyControl(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'simplify-control-source',
    filename: basename(task7Fixture),
    fixture: task7Fixture,
    setup: setupSimplifyControl,
  });
}

async function loadSimplify(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'simplify-source',
    filename: basename(task7Fixture),
    fixture: task7Fixture,
    setup: setupSimplify,
  });
}

async function loadSnapLayer(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'snap-source',
    filename: basename(task7LineFixture),
    fixture: task7LineFixture,
    setup: setupSnapLayer,
  });
}

async function loadUnion(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'union-source',
    filename: basename(task7Fixture),
    fixtures: [task7Fixture, task7MaskFixture],
    setup: setupUnion,
  });
}

async function loadCrsSwitch(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'crs-demo',
    filename: basename(task7Fixture),
    fixture: task7Fixture,
    setup: setupCrsSwitch,
  });
}

async function loadWebWorker(): Promise<void> {
  return loadWebWorkerWithSettings(defaultWebWorkerSettings);
}

async function loadWebWorkerWithSettings(settings: WebWorkerSettings): Promise<void> {
  const runtime = createRuntime({
    sourceId: 'worker-demo-source',
    filename: basename(task7Fixture),
    fixture: task7Fixture,
    mapOptions: {
      useWorker: workerModeToMapOption(settings.mode),
      workerThreshold: settings.threshold,
      workerUrl,
    },
  });
  runtime.status.textContent = `workerUrl=${workerUrl} mode=${settings.mode} threshold=${settings.threshold}; run a heavy operation to observe worker events.`;
  const source = new TopologySource('worker-demo-source');
  const fixture = await loadFixtureBytes(task7Fixture);
  await importSourceData(runtime.map, source, 'worker-demo-source', fixture);
  addVisibleLayers(runtime.map, source, 'worker-demo-source');
  setSourceExtent(runtime.map, source);
  setupWebWorker({
    map: runtime.map,
    source,
    sourceId: 'worker-demo-source',
    target: primaryLayerName(source),
    toolbar: runtime.toolbar,
    panel: runtime.panel,
    status: runtime.status,
    container: runtime.container,
    workerSettings: settings,
    rebuildWebWorker: loadWebWorkerWithSettings,
  });
}

async function loadDuckDbBuffer(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'duckdb-input',
    filename: basename(task7Fixture),
    fixture: task7Fixture,
    setup: setupDuckDbBuffer,
  });
}

async function loadDuckDbGeoParquetQuery(): Promise<void> {
  const runtime = createRuntime({
    sourceId: 'duckdb-geoparquet-bytes',
    filename: '',
  });
  setupDuckDbGeoParquetQuery({
    map: runtime.map,
    source: new TopologySource('duckdb-geoparquet-bytes'),
    sourceId: 'duckdb-geoparquet-bytes',
    target: '',
    toolbar: runtime.toolbar,
    panel: runtime.panel,
    status: runtime.status,
    container: runtime.container,
  });
}

async function loadDuckDbOverlay(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'duckdb-overlay-input',
    filename: basename(task7Fixture),
    fixture: task7Fixture,
    setup: setupDuckDbOverlay,
  });
}

async function loadDuckDbQuery(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'duckdb-query-input',
    filename: basename(task7Fixture),
    fixture: task7Fixture,
    setup: setupDuckDbQuery,
  });
}

async function loadDuckDbSpatialOps(): Promise<void> {
  return loadGeoJsonExample({
    sourceId: 'duckdb-spatial-input',
    filename: basename(task7Fixture),
    fixture: task7Fixture,
    setup: setupDuckDbSpatialOps,
  });
}

async function loadGeoJsonExample(options: GeoJsonRuntimeOptions): Promise<void> {
  const runtime = createRuntime(options);
  const source = new TopologySource(options.sourceId);
  const fixtures = options.fixtures ?? (options.fixture ? [options.fixture] : []);
  const entries = await Promise.all(fixtures.map(loadFixtureBytes));

  await importSourceData(runtime.map, source, options.sourceId, entries.length === 1 ? entries[0] : entries);
  addVisibleLayers(runtime.map, source, options.sourceId);
  setSourceExtent(runtime.map, source);

  const target = primaryLayerName(source);
  runtime.status.textContent = `Loaded ${options.filename || entries.map((entry) => entry.filename).join(', ')}.`;
  await options.setup({
    map: runtime.map,
    source,
    sourceId: options.sourceId,
    target,
    toolbar: runtime.toolbar,
    panel: runtime.panel,
    status: runtime.status,
    container: runtime.container,
    csvFixture: options.csvFixture,
  });
}

async function loadFixtureBytes(path: string): Promise<FileData> {
  const response = await fetch(`/${path}`);
  if (!response.ok) {
    throw new Error(`Unable to load fixture ${path}`);
  }
  return {
    filename: basename(path),
    content: new Uint8Array(await response.arrayBuffer()),
  };
}

async function importSourceData(
  map: Emap,
  source: TopologySource,
  sourceId: string,
  data: FileData | FileData[],
): Promise<void> {
  if (map.getSource(sourceId)) map.removeSource(sourceId);
  await source.setData(data);
  map.addSource(sourceId, source);
}

function setSourceExtent(map: Emap, source: TopologySource): void {
  const extent = source.getExtent();
  if (extent.hasBounds()) {
    map.setExtent(extent);
  }
}

function createRuntime(options: RuntimeOptions): {
  container: HTMLElement;
  map: Emap;
  toolbar: HTMLElement;
  panel: HTMLElement;
  status: HTMLElement;
} {
  const container = getMapContainer();
  activeMap?.remove();
  activeMap = null;
  container.replaceChildren();

  const { toolbar, panel, status } = createRecipeChrome(container);
  const map = new Emap({ container, ...options.mapOptions });
  activeMap = map;

  const featureFlags = featureFlagsForSource(options.sourceId);
  map.addControl(new NavigationControl(), 'top-left');
  if (featureFlags.includes('history')) {
    map.addControl(new HistoryControl(), 'top-left');
    map.bindHistoryShortcuts();
  }
  if (featureFlags.includes('basemap')) {
    map.addControl(new BasemapControl(), 'top-right');
  }
  if (featureFlags.includes('basemap') || featureFlags.includes('formats')) {
    map.addControl(new StatusControl({ alignment: 'right', showEPSG: true }), 'bottom-right');
  }
  return { container, map, toolbar, panel, status };
}

function featureFlagsForSource(id: string): readonly string[] {
  return recipes.find((item) => item.sourceId === id)?.featureFlags ?? [];
}

function setupAttributeEditing(ctx: RecipeContext): void {
  let activeRef: FeatureRef | null = null;
  let activeTarget = ctx.target;

  addUploadControl(ctx, {
    label: 'File',
    accept: '.geojson,.json,.topojson,.zip',
    onLoad: (source) => {
      activeTarget = primaryLayerName(source);
      activeRef = null;
      renderAttributeRows();
      ctx.status.textContent = 'File loaded. Click a feature to inspect or edit properties.';
    },
  });
  const field = addInput(ctx.toolbar, 'New field', 'reviewed');
  addButton(ctx.toolbar, 'Add field', () => {
    const result = ctx.map.attributes.addField({
      source: ctx.sourceId,
      target: activeTarget,
      field: field.value.trim() || 'reviewed',
      defaultValue: 'yes',
    });
    ctx.status.textContent = opStatus(result, 'Field added. Ctrl+Z reverses the schema edit.');
    renderAttributeRows();
  });
  const renameFrom = addInput(ctx.toolbar, 'Rename from', 'name');
  const renameTo = addInput(ctx.toolbar, 'Rename to', 'label');
  addButton(ctx.toolbar, 'Rename field', () => {
    const from = renameFrom.value.trim();
    const to = renameTo.value.trim();
    if (!from || !to) return;
    const result = ctx.map.attributes.renameField({ source: ctx.sourceId, target: activeTarget, from, to });
    ctx.status.textContent = opStatus(result, `Field ${from} renamed to ${to}. Ctrl+Z reverses it.`);
    renderAttributeRows();
  });
  const removeField = addInput(ctx.toolbar, 'Remove field', 'area');
  addButton(ctx.toolbar, 'Remove field', () => {
    const fieldName = removeField.value.trim();
    if (!fieldName) return;
    const result = ctx.map.attributes.removeField({ source: ctx.sourceId, target: activeTarget, field: fieldName });
    ctx.status.textContent = opStatus(result, `Field ${fieldName} removed. Ctrl+Z reverses it.`);
    renderAttributeRows();
  });

  ctx.map.on('historychange', renderAttributeRows);
  ctx.container.addEventListener('click', (event) => {
    const features = queryAtEvent(ctx, event, activeTarget);
    if (!features.length) {
      ctx.panel.textContent = '(no feature hit)';
      return;
    }
    const feature = features[0];
    activeRef = { source: feature.source, layer: feature.layer, id: feature.id };
    activeTarget = feature.layer;
    renderAttributeRows();
  });
  activeRef = firstRef({ ...ctx, target: activeTarget });
  renderAttributeRows();

  function renderAttributeRows(): void {
    if (!activeRef) {
      ctx.panel.textContent = '(click a feature)';
      return;
    }
    const feature = ctx.map.features.get(activeRef);
    if (!feature) {
      ctx.panel.textContent = '(selected feature no longer exists)';
      return;
    }
    ctx.panel.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = `${activeRef.layer}#${activeRef.id}`;
    ctx.panel.append(title);
    for (const [key, value] of Object.entries(feature.properties ?? {})) {
      const row = document.createElement('label');
      row.className = 'attribute-row';
      row.textContent = `${key}: `;
      const input = document.createElement('input');
      input.value = value == null ? '' : String(value);
      input.addEventListener('change', () => {
        const next = parsePropertyValue(input.value);
        if (!activeRef) return;
        const result = ctx.map.attributes.setFeatureProperty(activeRef, key, next === '' ? undefined : next);
        ctx.status.textContent = opStatus(result, `${key} updated. Ctrl+Z reverses it.`);
      });
      row.append(input);
      ctx.panel.append(row);
    }
  }
}

function setupAttributeExpressions(ctx: RecipeContext): void {
  const expression = addInput(ctx.toolbar, 'Expression', 'density = pop / area');
  const where = addInput(ctx.toolbar, 'Where', 'pop > 0');
  addButton(ctx.toolbar, 'Run expression', async () => {
    const result = await ctx.map.ops.applyExpression({
      source: ctx.sourceId,
      target: ctx.target,
      expression: expression.value,
      where: where.value,
    });
    ctx.status.textContent = opStatus(result, 'Expression applied. Click a feature to inspect density.');
  });
  clickToInspect(ctx);
  addPanelText(ctx.panel, 'Supports mapshaper expressions such as density = pop / area.');
}

function setupDataEngineering(ctx: RecipeContext): void {
  addButton(ctx.toolbar, 'Sort by pop', async () => {
    ctx.status.textContent = opStatus(
      await ctx.map.ops.sortFeatures({ source: ctx.sourceId, target: ctx.target, expression: 'pop', descending: true }),
      'Features sorted by pop descending.',
    );
  });
  addButton(ctx.toolbar, 'Unique by group', async () => {
    ctx.status.textContent = opStatus(
      await ctx.map.ops.uniqueFeatures({ source: ctx.sourceId, target: ctx.target, expression: 'group' }),
      'Duplicate groups removed.',
    );
  });
  addButton(ctx.toolbar, 'Keep id/name/pop', async () => {
    ctx.status.textContent = opStatus(
      await ctx.map.ops.filterFields({ source: ctx.sourceId, target: ctx.target, fields: ['id', 'name', 'pop'] }),
      'Fields filtered to id, name and pop.',
    );
  });
  addButton(ctx.toolbar, 'Rename pop', async () => {
    ctx.status.textContent = opStatus(
      await ctx.map.ops.renameFields({ source: ctx.sourceId, target: ctx.target, mapping: { pop: 'population' } }),
      'Field pop renamed to population.',
    );
  });
  addPanelText(ctx.panel, 'Drop, sort, unique, filter-fields, and rename-fields controls are migrated from the source HTML.');
}

function setupFeatureAttributes(ctx: RecipeContext): void {
  addPanelText(ctx.panel, 'Click the map to query features and highlight the hit set.');
  clickToInspect(ctx);
  showFeature(ctx, firstRef(ctx));
}

function setupFilterFeatures(ctx: RecipeContext): void {
  const expression = addInput(ctx.toolbar, 'Expression', 'pop > 100');
  addButton(ctx.toolbar, 'Filter', async () => {
    const result = await ctx.map.ops.filterFeatures({
      source: ctx.sourceId,
      target: ctx.target,
      expression: expression.value,
    });
    ctx.status.textContent = opStatus(result, 'Filter applied. Ctrl+Z restores removed features.');
  });
}

async function setupGeoParquetViewer(ctx: RecipeContext): Promise<void> {
  const fileInput = addUploadControl(ctx, {
    label: 'File',
    accept: '.parquet,.geoparquet,.arrow,.arrows,.feather',
    disabled: true,
    onLoad: (source, file) => {
      const layer = source.getDataset()?.layers?.[0];
      const featureCount = layer?.shapes?.length ?? 0;
      const geomType = layer?.geometry_type ?? 'unknown';
      ctx.status.textContent = `${file.filename} - ${featureCount} features (${geomType}).`;
    },
  });
  await initFormats((message) => {
    ctx.status.textContent = message;
  });
  fileInput.disabled = false;
  ctx.status.textContent = 'Upload a .parquet / .arrow file to start.';
  addExportControls(ctx, ['geoparquet', 'geoarrow', 'geojson']);
  addPanelText(ctx.panel, 'GeoParquet / GeoArrow formats are registered through @zwishing/emap/formats.');
}

async function setupExportGeoparquet(ctx: RecipeContext): Promise<void> {
  addUploadControl(ctx, {
    label: 'Input file',
    accept: '.geojson,.json,.topojson,.zip,.parquet,.geoparquet,.arrow,.arrows,.feather',
    onLoad: (source, file) => {
      const layer = source.getDataset()?.layers?.[0];
      const featureCount = layer?.shapes?.length ?? 0;
      const geomType = layer?.geometry_type ?? 'unknown';
      ctx.status.textContent = `Loaded ${file.filename} - ${featureCount} features (${geomType}).`;
    },
  });
  await initFormats((message) => {
    ctx.status.textContent = message;
  });
  addExportControls(ctx, ['geoparquet', 'geoparquet-native', 'geoarrow', 'geojson', 'shapefile']);
  addPanelText(ctx.panel, 'Export supports GeoParquet, GeoArrow IPC, GeoJSON, and Shapefile after formats registration.');
}

function setupExportRoundtrip(ctx: RecipeContext): void {
  ctx.map.addControl(
    new EditToolbar({
      controls: [
        new DrawFeatureControl({ source: ctx.sourceId, type: 'polyline' }),
        new DrawFeatureControl({ source: ctx.sourceId, type: 'polygon' }),
      ],
    }),
    'top-left',
  );
  addExportControls(ctx, ['geojson', 'topojson', 'shapefile']);
}

async function setupJoin(ctx: RecipeContext): Promise<void> {
  const csv = ctx.csvFixture ? await loadFixture(ctx.csvFixture) : '';
  addUploadControl(ctx, {
    label: 'Geometry file',
    accept: '.geojson,.json,.topojson,.zip',
    onLoad: () => {
      ctx.status.textContent = 'Geometry file loaded. Configure CSV keys, then join.';
    },
  });
  const csvInput = addTextarea(ctx.toolbar, 'CSV', csv);
  const targetKey = addInput(ctx.toolbar, 'Target key', 'id');
  const sourceKey = addInput(ctx.toolbar, 'Source key', 'id');
  const fields = addInput(ctx.toolbar, 'Fields', 'score,owner');
  const prefix = addInput(ctx.toolbar, 'Prefix', 'joined_');
  const unjoined = addCheckbox(ctx.toolbar, 'unjoined', true);
  addButton(ctx.toolbar, 'Join CSV', async () => {
    if (!csvInput.value.trim() || !targetKey.value.trim() || !sourceKey.value.trim()) {
      ctx.status.textContent = 'Fill CSV, target key, and source key before joining.';
      return;
    }
    const result = await ctx.map.ops.joinTable({
      source: ctx.sourceId,
      target: ctx.target,
      data: { csv: csvInput.value },
      keys: [targetKey.value.trim(), sourceKey.value.trim()],
      fields: splitCsvList(fields.value),
      prefix: prefix.value.trim() || undefined,
      unjoined: unjoined.checked,
    });
    ctx.status.textContent = opStatus(result, 'CSV attributes joined into the active layer.');
    showRecords(ctx);
  });
  showRecords(ctx);
}

function setupMergeLayers(ctx: RecipeContext): void {
  const uploaded = new Map<string, Uint8Array>();
  const layerList = document.createElement('div');
  layerList.className = 'layer-list';
  addUploadControl(ctx, {
    label: 'Files',
    accept: '.geojson,.json,.topojson,.zip',
    multiple: true,
    onFiles: async (files) => {
      for (const file of files) uploaded.set(file.filename, file.content);
      await reimport(Array.from(uploaded, ([filename, content]) => ({ filename, content })));
    },
  });
  addButton(ctx.toolbar, 'Clear files', async () => {
    uploaded.clear();
    if (ctx.map.getSource(ctx.sourceId)) ctx.map.removeSource(ctx.sourceId);
    layerList.replaceChildren();
    ctx.status.textContent = 'Cleared files; upload two or more layers.';
  });
  const name = addInput(ctx.toolbar, 'New layer name', 'merged');
  const force = addCheckbox(ctx.toolbar, 'force', true);
  const flatten = addCheckbox(ctx.toolbar, 'flatten', false);
  const mergeButton = addButton(ctx.toolbar, 'Merge', async () => {
    const targets = selectedTargets();
    if (targets.length < 2) {
      ctx.status.textContent = 'Select two or more layers before merging.';
      return;
    }
    const result = await ctx.map.ops.mergeLayers({
      source: ctx.sourceId,
      targets,
      name: name.value.trim() || undefined,
      force: force.checked,
      flatten: flatten.checked,
    });
    ctx.status.textContent = opStatus(result, `Merged ${targets.join(' / ')}. Ctrl+Z reverses it.`);
    refreshLayerList();
  });
  ctx.toolbar.append(layerList);
  refreshLayerList();
  addPanelText(ctx.panel, 'Multi-upload, layer selection, force, and flatten controls match the original merge-layers example.');

  async function reimport(entries: FileData[]): Promise<void> {
    const source = new TopologySource(ctx.sourceId);
    await importSourceData(ctx.map, source, ctx.sourceId, entries);
    addVisibleLayers(ctx.map, source, ctx.sourceId);
    setSourceExtent(ctx.map, source);
    ctx.source = source;
    refreshLayerList();
    ctx.status.textContent = `Loaded ${entries.length} file(s). Select two or more layers, then merge.`;
  }

  function refreshLayerList(): void {
    layerList.replaceChildren();
    for (const [index, layer] of ctx.source.getLayers().entries()) {
      const layerValue = layerName(layer) || `layer-${index}`;
      const label = document.createElement('label');
      label.className = 'layer-choice active';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = true;
      input.value = layerValue;
      input.addEventListener('change', () => {
        label.classList.toggle('active', input.checked);
        mergeButton.disabled = selectedTargets().length < 2;
      });
      label.append(input, document.createTextNode(`${layerValue} (${layer.geometry_type ?? '?'})`));
      layerList.append(label);
    }
    mergeButton.disabled = selectedTargets().length < 2;
  }

  function selectedTargets(): string[] {
    return Array.from(layerList.querySelectorAll('input:checked'), (input) => (input as HTMLInputElement).value);
  }
}

function setupMergeSelected(ctx: RecipeContext): void {
  selectFirst(ctx);
  addButton(ctx.toolbar, 'Merge selected', async () => {
    const result = await ctx.map.ops.mergeSelected();
    ctx.status.textContent = opStatus(result, 'Selected features merged.');
  });
  addButton(ctx.toolbar, 'Clear selection', () => {
    ctx.map.clearSelection();
    ctx.map.clearHighlightedFeatures();
    ctx.status.textContent = 'Selection cleared.';
  });
}

function setupRenameLayer(ctx: RecipeContext): void {
  const name = addInput(ctx.toolbar, 'New layer name', 'renamed-layer');
  addButton(ctx.toolbar, 'Rename layer', async () => {
    const result = await ctx.map.ops.renameLayer({ source: ctx.sourceId, target: ctx.target, name: name.value });
    ctx.status.textContent = opStatus(result, `Layer renamed to ${name.value}.`);
  });
}

function setupSplitLayer(ctx: RecipeContext): void {
  const expression = addInput(ctx.toolbar, 'Split field', 'group');
  addButton(ctx.toolbar, 'Split', async () => {
    const result = await ctx.map.ops.splitLayer({
      source: ctx.sourceId,
      target: ctx.target,
      expression: expression.value,
      noReplace: true,
    });
    ctx.status.textContent = opStatus(result, 'Layer split by group while preserving the original.');
  });
}

function setupInteractionHandlers(ctx: RecipeContext): void {
  addButton(ctx.toolbar, 'Toggle pan', () => {
    toggleHandler(ctx.map.dragPan);
    ctx.status.textContent = `dragPan ${ctx.map.dragPan.isEnabled() ? 'enabled' : 'disabled'}.`;
  });
  addButton(ctx.toolbar, 'Toggle zoom', () => {
    toggleHandler(ctx.map.scrollZoom);
    ctx.status.textContent = `scrollZoom ${ctx.map.scrollZoom.isEnabled() ? 'enabled' : 'disabled'}.`;
  });
  addPanelText(ctx.panel, 'Drag and wheel handlers can be toggled without recreating the map.');
}

function setupFeatureSelection(ctx: RecipeContext): void {
  clickToSelect(ctx);
  addButton(ctx.toolbar, 'Clear selection', () => {
    ctx.map.clearSelection();
    ctx.map.clearHighlightedFeatures();
    ctx.status.textContent = 'Selection cleared.';
  });
  addButton(ctx.toolbar, 'Delete selected', () => {
    ctx.status.textContent = ctx.map.deleteSelected() ? 'Selected features deleted. Ctrl+Z restores them.' : 'No selected features to delete.';
  });
}

function setupBoxSelect(ctx: RecipeContext): void {
  ctx.map.addControl(new BoxSelectControl(), 'top-left');
  setupFeatureSelection(ctx);
  ctx.status.textContent = 'Box select control is active. Drag with Shift to select features.';
}

function setupLassoSelect(ctx: RecipeContext): void {
  const boxControl = new BoxSelectControl();
  const lassoControl = new LassoSelectControl();
  lassoControl.disable();

  ctx.map.addControl(boxControl, 'top-left');
  ctx.map.addControl(lassoControl, 'top-left');
  setupFeatureSelection(ctx);

  const boxButton = addButton(ctx.toolbar, 'Box', () => {
    lassoControl.disable();
    boxControl.enable();
    boxButton.disabled = true;
    lassoButton.disabled = false;
    ctx.status.textContent = 'Box select is active. Drag to select features.';
  });
  const lassoButton = addButton(ctx.toolbar, 'Lasso', () => {
    boxControl.disable();
    lassoControl.enable();
    boxButton.disabled = false;
    lassoButton.disabled = true;
    ctx.status.textContent = 'Lasso select is active. Draw a lasso to select features.';
  });
  boxButton.disabled = true;
  ctx.status.textContent = 'Box select is active. Drag to select features.';
}

function setupChinaEditing(ctx: RecipeContext): void {
  ctx.map.addControl(new EditToolbar({ controls: [new VertexEditControl()] }), 'top-left');
  addPanelText(ctx.panel, 'The original China editing example toggled administrative fixtures; this route uses the bundled Task 6 fixture for offline QA.');
}

function setupDrawSnapClear(ctx: RecipeContext): void {
  ctx.map.drawFeature.setOptions({
    source: ctx.sourceId,
    type: 'polyline',
    snapThreshold: 12,
    snapToVertex: true,
    snapToEdge: true,
  });
  ctx.map.drawFeature.enable();
  addButton(ctx.toolbar, 'Cancel draw', () => {
    ctx.map.drawFeature.disable();
    ctx.status.textContent = 'Draw mode cancelled.';
  });
  addButton(ctx.toolbar, 'Snap layer', async () => {
    const result = await ctx.map.ops.snapLayer({ source: ctx.sourceId, target: ctx.target, interval: 0.0001 });
    ctx.status.textContent = opStatus(result, 'Layer snapped and remains undoable.');
  });
}

function setupDrawSnapEdge(ctx: RecipeContext): void {
  const control = new EditToolbar({
    controls: [
      new DrawFeatureControl({
        source: ctx.sourceId,
        type: 'polyline',
        snapThreshold: 12,
        snapToVertex: true,
        snapToEdge: true,
      }),
      new DrawFeatureControl({
        source: ctx.sourceId,
        type: 'polygon',
        snapThreshold: 12,
        snapToVertex: true,
        snapToEdge: true,
      }),
    ],
  });
  ctx.map.addControl(control, 'top-left');
  addPanelText(ctx.panel, 'Draw controls are configured with both vertex and edge snapping.');
}

function setupFeatureRotateScale(ctx: RecipeContext): void {
  selectFirst(ctx);
  addButton(ctx.toolbar, 'Rotate 15 degrees', () => {
    const session = ctx.map.editSession.beginAffineSession();
    if (!session) {
      ctx.status.textContent = 'Select a feature first.';
      return;
    }
    session.applyDelta(rotateMatrix((15 * Math.PI) / 180, session.origin[0], session.origin[1]));
    session.commit('Rotate selected feature');
    ctx.status.textContent = 'Selected feature rotated. Ctrl+Z reverses it.';
  });
  addButton(ctx.toolbar, 'Scale 1.1x', () => {
    const session = ctx.map.editSession.beginAffineSession();
    if (!session) {
      ctx.status.textContent = 'Select a feature first.';
      return;
    }
    session.applyDelta(scaleMatrix(1.1, 1.1, session.origin[0], session.origin[1]));
    session.commit('Scale selected feature');
    ctx.status.textContent = 'Selected feature scaled. Ctrl+Z reverses it.';
  });
}

function setupFeatureTranslate(ctx: RecipeContext): void {
  selectFirst(ctx);
  addButton(ctx.toolbar, 'Translate east', () => {
    const session = ctx.map.editSession.beginTranslateSession();
    if (!session) {
      ctx.status.textContent = 'Select a feature first.';
      return;
    }
    session.move(0.01, 0);
    session.commit();
    ctx.status.textContent = 'Selected feature translated east. Ctrl+Z reverses it.';
  });
}

function setupSnapshot(ctx: RecipeContext): void {
  addButton(ctx.toolbar, 'Save snapshot', async () => {
    const blob = await ctx.map.exportSnapshot({ compact: true });
    ctx.status.textContent = `Snapshot exported (${blob.size} bytes).`;
  });
  addPanelText(ctx.panel, 'Use exportSnapshot and loadSnapshot for multi-source state handoff.');
}

function setupTransaction(ctx: RecipeContext): void {
  addButton(ctx.toolbar, 'Run transaction', async () => {
    const tx = ctx.map.beginTransaction();
    const result = await ctx.map.ops.applyExpression({
      source: ctx.sourceId,
      target: ctx.target,
      expression: 'tx_run = true',
    });
    if (result.ok) {
      await tx.commit('Task 6 example transaction');
      ctx.status.textContent = 'Transaction committed after an expression update.';
    } else {
      tx.rollback();
      ctx.status.textContent = opStatus(result, 'Transaction rolled back.');
    }
  });
  addButton(ctx.toolbar, 'Undo', () => {
    ctx.status.textContent = ctx.map.undo() ? 'Undo applied.' : 'Nothing to undo.';
  });
}

function setupUndoRedo(ctx: RecipeContext): void {
  ctx.map.addControl(
    new EditToolbar({
      controls: [
        new VertexEditControl(),
        new DrawFeatureControl({ source: ctx.sourceId, type: 'polygon' }),
      ],
    }),
    'top-left',
  );
  addButton(ctx.toolbar, 'Make edit', () => {
    const ref = firstRef(ctx);
    const result = ctx.map.attributes.setFeatureProperty(ref, 'last_action', Date.now());
    ctx.status.textContent = opStatus(result, 'Edit recorded in history.');
  });
  addButton(ctx.toolbar, 'Undo', () => {
    ctx.status.textContent = ctx.map.undo() ? 'Undo applied.' : 'Nothing to undo.';
  });
  addButton(ctx.toolbar, 'Redo', () => {
    ctx.status.textContent = ctx.map.redo() ? 'Redo applied.' : 'Nothing to redo.';
  });
}

function setupVertexEditing(ctx: RecipeContext): void {
  ctx.map.addControl(new EditToolbar({ controls: [new VertexEditControl()] }), 'top-left');
  addPanelText(ctx.panel, 'Vertex editing toolbar is mounted. Select a feature, then drag vertices on the canvas.');
}

function setupBuffer(ctx: RecipeContext): void {
  const target = addLayerSelect(ctx.toolbar, 'Target layer', ctx.source);
  const radius = addInput(ctx.toolbar, 'Radius', '0.01');
  const capStyle = addSelect(ctx.toolbar, 'capStyle', [
    ['', 'round default'],
    ['round', 'round'],
    ['flat', 'flat'],
  ]);
  const vertices = addInput(ctx.toolbar, 'vertices', '72');
  const arcQuality = addInput(ctx.toolbar, 'arcQuality', '');
  const type = addSelect(ctx.toolbar, 'type', [
    ['', 'all'],
    ['left', 'left'],
    ['right', 'right'],
    ['outer', 'outer'],
    ['inner', 'inner'],
  ]);
  const planar = addCheckbox(ctx.toolbar, 'planar', false);
  const v2 = addCheckbox(ctx.toolbar, 'v2', false);
  addButton(ctx.toolbar, 'Generate buffer', async () => {
    const result = await ctx.map.ops.bufferLayer({
      source: ctx.sourceId,
      target: target.value,
      radius: parseDistance(radius.value),
      capStyle: capStyleValue(capStyle.value),
      vertices: numberValue(vertices.value),
      arcQuality: numberValue(arcQuality.value),
      type: bufferTypeValue(type.value),
      planar: planar.checked || undefined,
      v2: v2.checked || undefined,
    });
    ctx.status.textContent = opStatus(result, `Buffered ${target.value}. Ctrl+Z reverses it.`);
    refreshLayerSelect(target, ctx.source);
  });
  addPanelText(ctx.panel, 'Buffer keeps the original radius, cap style, vertices, arcQuality, type, planar, and v2 controls.');
}

function setupCheckGeometry(ctx: RecipeContext): void {
  const tolerance = addInput(ctx.toolbar, 'tolerance', '');
  addButton(ctx.toolbar, 'Check geometry', async () => {
    const report = await ctx.map.ops.checkGeometry({
      source: ctx.sourceId,
      tolerance: numberValue(tolerance.value),
    });
    if (report.ok) {
      ctx.status.textContent = report.value.intersectionCount === 0
        ? 'Topology is clean: 0 intersections.'
        : `Found ${report.value.intersectionCount} intersections.`;
      ctx.panel.textContent = JSON.stringify(report.value.intersections.slice(0, 5), null, 2);
    } else {
      ctx.status.textContent = opStatus(report, 'Geometry checked.');
    }
  });
  addButton(ctx.toolbar, 'Rebuild topology', async () => {
    const result = await ctx.map.ops.rebuildTopology({ source: ctx.sourceId });
    ctx.status.textContent = opStatus(result, 'Topology rebuilt. Run checkGeometry again to confirm.');
  });
  addPanelText(ctx.panel, 'checkGeometry reports intersections; rebuildTopology repairs shared arcs and inserted cuts.');
}

function setupClipErase(ctx: RecipeContext): void {
  const target = addLayerSelect(ctx.toolbar, 'Target', ctx.source);
  const mask = addLayerSelect(ctx.toolbar, 'Mask', ctx.source, (layer) => layer.geometry_type === 'polygon');
  addButton(ctx.toolbar, 'Clip', async () => {
    ctx.status.textContent = opStatus(
      await ctx.map.ops.clipLayer({ source: ctx.sourceId, target: target.value, mask: mask.value }),
      `Clipped ${target.value} by mask ${mask.value}.`,
    );
  });
  addButton(ctx.toolbar, 'Erase', async () => {
    ctx.status.textContent = opStatus(
      await ctx.map.ops.eraseLayer({ source: ctx.sourceId, target: target.value, mask: mask.value }),
      `Erased ${target.value} by mask ${mask.value}.`,
    );
  });
  addPanelText(ctx.panel, 'Static multi-file import preserves the original clipLayer / eraseLayer target and polygon mask flow.');
}

function setupDissolve(ctx: RecipeContext): void {
  const target = addLayerSelect(ctx.toolbar, 'Target', ctx.source);
  const field = addSelect(ctx.toolbar, 'Field', [['', 'whole layer']]);
  refreshFieldOptions(ctx.source, target.value, field);
  target.addEventListener('change', () => refreshFieldOptions(ctx.source, target.value, field));
  addButton(ctx.toolbar, 'Dissolve', async () => {
    const result = await ctx.map.ops.dissolveLayer({
      source: ctx.sourceId,
      target: target.value,
      field: field.value || undefined,
    });
    ctx.status.textContent = opStatus(result, field.value ? `Dissolved by ${field.value}.` : 'Dissolved the whole layer.');
  });
  addPanelText(ctx.panel, 'refreshFieldOptions reads real layer records so the field picker mirrors the original dissolve example.');
}

function setupDivide(ctx: RecipeContext): void {
  const target = addLayerSelect(ctx.toolbar, 'Line target', ctx.source, (layer) => layer.geometry_type === 'polyline');
  const divider = addLayerSelect(ctx.toolbar, 'Polygon divider', ctx.source, (layer) => layer.geometry_type === 'polygon');
  const fields = addInput(ctx.toolbar, 'fields', 'name');
  const force = addCheckbox(ctx.toolbar, 'force', true);
  addButton(ctx.toolbar, 'Divide', async () => {
    const result = await ctx.map.ops.divideLayer({
      source: ctx.sourceId,
      target: target.value,
      divider: divider.value,
      fields: splitCsvList(fields.value),
      force: force.checked || undefined,
    });
    ctx.status.textContent = opStatus(result, `Divided ${target.value} by ${divider.value}.`);
  });
  addPanelText(ctx.panel, 'divideLayer keeps the original accumulated multi-file import with line target, polygon divider, fields, and force.');
}

function setupExplode(ctx: RecipeContext): void {
  const target = addLayerSelect(ctx.toolbar, 'Target', ctx.source);
  addButton(ctx.toolbar, 'Explode', async () => {
    ctx.status.textContent = opStatus(
      await ctx.map.ops.explodeLayer({ source: ctx.sourceId, target: target.value }),
      `Exploded multipart features in ${target.value}.`,
    );
  });
}

function setupInnerlines(ctx: RecipeContext): void {
  const target = addLayerSelect(ctx.toolbar, 'Target', ctx.source);
  const where = addInput(ctx.toolbar, 'where', '');
  const noReplace = addCheckbox(ctx.toolbar, 'noReplace', false);
  addButton(ctx.toolbar, 'Innerlines', async () => {
    const result = await ctx.map.ops.innerlinesLayer({
      source: ctx.sourceId,
      target: target.value,
      where: where.value.trim() || undefined,
      noReplace: noReplace.checked || undefined,
    });
    ctx.status.textContent = opStatus(result, `Extracted innerlines from ${target.value}.`);
    refreshLayerSelect(target, ctx.source);
  });
}

function setupMosaic(ctx: RecipeContext): void {
  const target = addLayerSelect(ctx.toolbar, 'Target', ctx.source);
  const snapInterval = addInput(ctx.toolbar, 'snapInterval', '');
  const noSnap = addCheckbox(ctx.toolbar, 'noSnap', false);
  const noReplace = addCheckbox(ctx.toolbar, 'noReplace', false);
  addButton(ctx.toolbar, 'Mosaic', async () => {
    const result = await ctx.map.ops.mosaicLayer({
      source: ctx.sourceId,
      target: target.value,
      snapInterval: numberValue(snapInterval.value),
      noSnap: noSnap.checked || undefined,
      noReplace: noReplace.checked || undefined,
    });
    ctx.status.textContent = opStatus(result, `Mosaiced ${target.value}.`);
  });
}

function setupProject(ctx: RecipeContext): void {
  const scope = addLayerSelect(ctx.toolbar, 'Scope', ctx.source, undefined, true);
  const preset = addSelect(ctx.toolbar, 'Preset', [
    ['EPSG:3857', 'EPSG:3857'],
    ['wgs84', 'wgs84'],
    ['webmercator', 'webmercator'],
    ['natearth', 'natearth'],
    ['wintri', 'wintri'],
  ]);
  const crs = addInput(ctx.toolbar, 'CRS', 'EPSG:3857');
  const init = addInput(ctx.toolbar, 'init', '');
  const densify = addCheckbox(ctx.toolbar, 'densify', false);
  preset.addEventListener('change', () => {
    crs.value = preset.value;
  });
  addButton(ctx.toolbar, 'Project', async () => {
    const result = await ctx.map.ops.projectLayer({
      source: ctx.sourceId,
      target: scope.value || undefined,
      crs: crs.value.trim(),
      init: init.value.trim() || undefined,
      densify: densify.checked || undefined,
    });
    if (result.ok) setSourceExtent(ctx.map, ctx.source);
    ctx.status.textContent = opStatus(result, `Projected ${scope.value || 'source'} to ${crs.value}.`);
  });
  addPanelText(ctx.panel, 'projectLayer accepts EPSG codes, mapshaper aliases, and Proj.4 strings; densify and init are preserved.');
}

function setupRebuildTopology(ctx: RecipeContext): void {
  clickToSelect(ctx);
  const dx = addInput(ctx.toolbar, 'dx', '0.01');
  const dy = addInput(ctx.toolbar, 'dy', '0');
  const snapInterval = addInput(ctx.toolbar, 'snapInterval', '');
  const noSnap = addCheckbox(ctx.toolbar, 'noSnap', false);
  const rebuildTopology = addCheckbox(ctx.toolbar, 'rebuildTopology', true);
  addButton(ctx.toolbar, 'Translate selected', () => {
    const result = ctx.map.editSession.translateSelected(Number(dx.value), Number(dy.value));
    ctx.status.textContent = result ? 'Translated selected feature; topology stats may change.' : 'Select a feature before translating.';
  });
  addButton(ctx.toolbar, 'Rebuild topology', async () => {
    const result = await ctx.map.ops.rebuildTopology({
      source: ctx.sourceId,
      snapInterval: numberValue(snapInterval.value),
      noSnap: noSnap.checked || undefined,
      rebuildTopology: rebuildTopology.checked || undefined,
    });
    ctx.status.textContent = opStatus(result, topologyStats(ctx.source));
  });
  addPanelText(ctx.panel, topologyStats(ctx.source));
}

function setupSimplifyControl(ctx: RecipeContext): void {
  ctx.map.addControl(new SimplifyControl({ source: ctx.sourceId, initialPercentage: 10 }), 'top-left');
  addPanelText(ctx.panel, 'SimplifyControl is mounted with initialPercentage 10; use the map control to commit simplification.');
}

function setupSimplify(ctx: RecipeContext): void {
  const scope = addLayerSelect(ctx.toolbar, 'Scope', ctx.source, (layer) => layer.geometry_type !== 'point', true);
  const thresholdMode = addSelect(ctx.toolbar, 'threshold', [
    ['percentage', 'percentage'],
    ['interval', 'interval'],
    ['resolution', 'resolution'],
  ]);
  const thresholdValue = addInput(ctx.toolbar, 'value', '10');
  const method = addSelect(ctx.toolbar, 'method', [
    ['', 'weighted'],
    ['weighted', 'weighted'],
    ['visvalingam', 'visvalingam'],
    ['dp', 'dp'],
  ]);
  const planar = addCheckbox(ctx.toolbar, 'planar', false);
  const keepShapes = addCheckbox(ctx.toolbar, 'keep-shapes', true);
  const lockBox = addCheckbox(ctx.toolbar, 'lock-box', false);
  const noRepair = addCheckbox(ctx.toolbar, 'no-repair', false);
  addButton(ctx.toolbar, 'Simplify', async () => {
    const mode = thresholdMode.value;
    const result = await ctx.map.ops.simplifyLayer({
      source: ctx.sourceId,
      target: scope.value || undefined,
      percentage: mode === 'percentage' ? Number(thresholdValue.value) : undefined,
      interval: mode === 'interval' ? Number(thresholdValue.value) : undefined,
      resolution: mode === 'resolution' ? thresholdValue.value : undefined,
      method: simplifyMethodValue(method.value),
      planar: planar.checked || undefined,
      keepShapes: keepShapes.checked || undefined,
      lockBox: lockBox.checked || undefined,
      noRepair: noRepair.checked || undefined,
    });
    const arcs = ctx.source.getArcs?.();
    const total = arcs?.getPointCount?.() ?? 0;
    const kept = arcs?.getFilteredPointCount?.() ?? total;
    ctx.status.textContent = opStatus(result, `Simplified ${scope.value || 'source'}; retained ${kept}/${total} vertices.`);
  });
}

function setupSnapLayer(ctx: RecipeContext): void {
  const target = addLayerSelect(ctx.toolbar, 'Target', ctx.source);
  const interval = addInput(ctx.toolbar, 'interval', '0.0001');
  const precision = addInput(ctx.toolbar, 'precision', '');
  const endpoints = addCheckbox(ctx.toolbar, 'endpoints', false);
  addButton(ctx.toolbar, 'Snap', async () => {
    const before = ctx.source.getArcs?.()?.getPointCount?.() ?? 0;
    const result = await ctx.map.ops.snapLayer({
      source: ctx.sourceId,
      target: target.value,
      interval: numberValue(interval.value),
      precision: numberValue(precision.value),
      endpoints: endpoints.checked || undefined,
    });
    const after = ctx.source.getArcs?.()?.getPointCount?.() ?? before;
    ctx.status.textContent = opStatus(result, `Snapped ${target.value}: vertices ${before} -> ${after}.`);
  });
  addExportControls(ctx, ['geojson', 'topojson', 'shapefile']);
}

function setupUnion(ctx: RecipeContext): void {
  const layerList = document.createElement('div');
  layerList.className = 'layer-list';
  ctx.toolbar.append(layerList);
  refreshChoices();
  addButton(ctx.toolbar, 'Union', async () => {
    const targets = selectedTargets();
    if (targets.length < 2) {
      ctx.status.textContent = 'Select at least two polygon layers before union.';
      return;
    }
    const result = await ctx.map.ops.unionLayers({ source: ctx.sourceId, targets });
    ctx.status.textContent = opStatus(result, `Unioned ${targets.join(' / ')}.`);
    refreshChoices();
  });
  addPanelText(ctx.panel, 'selectedTargets mirrors the original checkbox list and feeds unionLayers.');

  function refreshChoices(): void {
    layerList.replaceChildren();
    ctx.source.getLayers().forEach((layer, index) => {
      if (layer.geometry_type !== 'polygon') return;
      const name = layerName(layer) || `layer-${index}`;
      const label = document.createElement('label');
      label.className = 'layer-choice active';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = true;
      input.value = name;
      label.append(input, document.createTextNode(name));
      layerList.append(label);
    });
  }

  function selectedTargets(): string[] {
    return Array.from(layerList.querySelectorAll('input:checked'), (input) => (input as HTMLInputElement).value);
  }
}

function setupCrsSwitch(ctx: RecipeContext): void {
  const current = document.createElement('strong');
  current.textContent = 'EPSG:4326 initial';
  ctx.toolbar.append(current);
  const presets: readonly (readonly [string, string, string])[] = [
    ['WGS84', 'wgs84', 'WGS84'],
    ['WebMercator', 'webmercator', 'Web Mercator'],
    ['Natural Earth', 'natearth', 'Natural Earth'],
    ['Winkel Tripel', 'wintri', 'Winkel Tripel'],
  ];
  const setActive = (label: string) => {
    current.textContent = label;
  };
  for (const [buttonLabel, crs, label] of presets) {
    addButton(ctx.toolbar, buttonLabel, async () => {
      const result = await ctx.map.ops.projectLayer({ source: ctx.sourceId, crs });
      if (result.ok) {
        setSourceExtent(ctx.map, ctx.source);
        setActive(label);
      }
      ctx.status.textContent = opStatus(result, `Switched CRS to ${label}.`);
    });
  }
  const lon = addInput(ctx.toolbar, 'Gauss-Kruger lon', '105');
  addButton(ctx.toolbar, 'Gauss-Kruger', async () => {
    const center = Number(lon.value);
    const crs = `+proj=tmerc +lat_0=0 +lon_0=${center} +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs`;
    const result = await ctx.map.ops.projectLayer({ source: ctx.sourceId, crs });
    if (result.ok) {
      setSourceExtent(ctx.map, ctx.source);
      setActive(`Gauss-Kruger ${center}`);
    }
    ctx.status.textContent = opStatus(result, `Switched to custom Gauss-Kruger ${center}.`);
  });
}

function setupWebWorker(ctx: RecipeContext): void {
  const initialSettings = ctx.workerSettings ?? defaultWebWorkerSettings;
  const mode = addSelect(ctx.toolbar, 'mode', [
    ['auto', 'auto'],
    ['on', 'on'],
    ['off', 'off'],
  ]);
  mode.value = initialSettings.mode;
  const threshold = addInput(ctx.toolbar, 'threshold', '1');
  threshold.value = String(initialSettings.threshold);
  const log = document.createElement('pre');
  log.className = 'example-inspector';
  ctx.panel.replaceWith(log);
  const logEvent = (message: string) => {
    log.textContent += `${message}\n`;
  };
  ctx.map.on('workerjobstart', (event) => {
    logEvent(`workerjobstart #${event.id}: ${event.label}`);
  });
  ctx.map.on('workerjobend', (event) => {
    logEvent(`workerjobend #${event.id}: ${event.ok ? 'ok' : event.errorMessage}`);
  });
  addButton(ctx.toolbar, 'Rebuild map', async () => {
    const settings = {
      mode: workerModeValue(mode.value),
      threshold: workerThresholdValue(threshold.value),
    };
    ctx.status.textContent = `Rebuilding with workerUrl=${workerUrl} mode=${settings.mode} threshold=${settings.threshold}...`;
    await ctx.rebuildWebWorker?.(settings);
  });
  addButton(ctx.toolbar, 'Dissolve', async () => {
    const result = await ctx.map.ops.dissolveLayer({ source: ctx.sourceId, target: ctx.target });
    ctx.status.textContent = opStatus(result, 'Dissolve completed through the configured worker route.');
  });
  addButton(ctx.toolbar, 'Simplify 5%', async () => {
    const result = await ctx.map.ops.simplifyLayer({ source: ctx.sourceId, target: ctx.target, percentage: 5 });
    ctx.status.textContent = opStatus(result, 'Simplify completed through the configured worker route.');
  });
  addButton(ctx.toolbar, 'Cancel jobs', () => {
    ctx.map.cancelWorkerJobs();
    logEvent('cancelWorkerJobs()');
  });
  ctx.status.textContent = `workerUrl=${workerUrl} mode=${initialSettings.mode} threshold=${initialSettings.threshold}; run a heavy operation to observe worker events.`;
}

function workerModeToMapOption(mode: WebWorkerMode): MapOptions['useWorker'] {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return 'auto';
}

function workerModeValue(value: string): WebWorkerMode {
  if (value === 'on' || value === 'off') return value;
  return 'auto';
}

function workerThresholdValue(value: string): number {
  const threshold = Number(value);
  return Number.isFinite(threshold) && threshold >= 0 ? threshold : defaultWebWorkerSettings.threshold;
}

function setupDuckDbBuffer(ctx: RecipeContext): void {
  const target = addLayerSelect(ctx.toolbar, 'Target', ctx.source);
  const crs = addInput(ctx.toolbar, 'CRS', 'EPSG:3857');
  const distance = addInput(ctx.toolbar, 'Distance', '1000');
  const allowGeographic = addCheckbox(ctx.toolbar, 'allow geographic CRS', false);
  addButton(ctx.toolbar, 'Generate DuckDB buffer', async () => {
    await runDuckDbExampleAction(ctx, async (duckdb) => {
      const dataset = requireDataset(ctx.source);
      dataset.info = { ...dataset.info, crs_string: crs.value.trim() || undefined };
      const result = await duckdb.bufferDatasetWithDuckDb(dataset, {
        layer: target.value,
        distance: Number(distance.value),
        outputLayer: `${target.value}_buffer`,
        failOnGeographicCrs: !allowGeographic.checked,
      });
      const source = addDatasetAsSource(ctx.map, 'duckdb-buffered', result);
      setSourceExtent(ctx.map, source);
      return `DuckDB buffer generated for ${target.value}.`;
    });
  });
  addPanelText(ctx.panel, 'DuckDB buffer preserves CRS override, distance, target layer, and failOnGeographicCrs behavior.');
}

function setupDuckDbGeoParquetQuery(ctx: RecipeContext): void {
  const fileInput = addUploadControl(ctx, {
    label: 'GeoParquet',
    accept: '.parquet,.geoparquet',
    onLoad: () => undefined,
  });
  const entrypoint = addSelect(ctx.toolbar, 'Entrypoint', [
    ['source', 'DuckDbGeoParquetQuerySource.query'],
    ['mapop', 'duckDbGeoParquetQueryLayer'],
  ]);
  const layerName = addInput(ctx.toolbar, 'Layer name', 'duckdb_geoparquet_query');
  const geometryColumn = addInput(ctx.toolbar, 'Geometry column', '');
  const sql = addTextarea(ctx.toolbar, 'SQL', 'SELECT * FROM input LIMIT 100');
  let geoParquetBytes: Uint8Array | null = null;
  let geoParquetQuerySource: Awaited<ReturnType<DuckDbModule['createDuckDbGeoParquetQuerySource']>> | null = null;
  const contextSources = new Map<string, { getDataset(): MapshaperDataset | null }>();

  fileInput.addEventListener('change', () => {
    void (async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      geoParquetBytes = new Uint8Array(await file.arrayBuffer());
      await geoParquetQuerySource?.close();
      geoParquetQuerySource = null;
      ctx.status.textContent = `Read ${file.name}; DuckDB query can run now.`;
    })();
  });

  addButton(ctx.toolbar, 'Query GeoParquet', async () => {
    if (!geoParquetQuerySource) {
      if (!geoParquetBytes) {
        ctx.status.textContent = 'Upload a GeoParquet file before querying.';
        return;
      }
    }
    await runDuckDbExampleAction(ctx, async (duckdb) => {
      if (!geoParquetQuerySource) {
        if (!geoParquetBytes) throw new Error('Upload a GeoParquet file before querying.');
        geoParquetQuerySource = await duckdb.createDuckDbGeoParquetQuerySource(geoParquetBytes);
        geoParquetBytes = null;
      }
      const opts = {
        sql: sql.value,
        layerName: layerName.value.trim() || 'duckdb_geoparquet_query',
        geometryColumn: geometryColumn.value.trim() || undefined,
      };
      const querySource = geoParquetQuerySource;
      if (!querySource) throw new Error('GeoParquet query source is not initialized.');
      const resultDataset = entrypoint.value === 'mapop'
        ? await runDuckDbGeoParquetMapOp(duckdb, {
          getSource(id: string) {
            if (id === ctx.sourceId) {
              return {
                getBytes: () => geoParquetBytes,
                getDataset: () => null,
                getGeoParquetQuerySource: () => geoParquetQuerySource,
              };
            }
            return contextSources.get(id);
          },
          setSourceDataset(id: string, dataset: MapshaperDataset) {
            contextSources.set(id, { getDataset: () => dataset });
          },
        }, ctx.sourceId, opts)
        : await querySource.query(opts);
      const output = addDatasetAsSource(ctx.map, 'duckdb-geoparquet-output', resultDataset);
      setSourceExtent(ctx.map, output);
      return `GeoParquet query output ${countFeatures(resultDataset)} feature(s).`;
    });
  });
  addPanelText(ctx.panel, 'GeoParquet upload stays user-driven; the optional DuckDB module is loaded only when Query GeoParquet runs.');
}

async function runDuckDbGeoParquetMapOp(
  duckdb: DuckDbModule,
  context: Parameters<DuckDbModule['duckDbGeoParquetQueryLayer']>[0],
  sourceId: string,
  opts: {
    sql: string;
    layerName: string;
    geometryColumn?: string;
  },
): Promise<MapshaperDataset> {
  const result = await duckdb.duckDbGeoParquetQueryLayer(context, {
    ...opts,
    src: sourceId,
    output: { sourceId: 'duckdb-geoparquet-output' },
  });
  if (!result.ok) throw new Error(duckDbErrorMessage(result.error));
  return result.value.dataset;
}

async function setupDuckDbOverlay(ctx: RecipeContext): Promise<void> {
  const duckdbMask = await loadFixtureBytes(task7MaskFixture);
  const maskSource = new TopologySource('duckdb-overlay-mask');
  await maskSource.setData(duckdbMask);
  ctx.map.addSource('duckdb-overlay-mask', maskSource);
  addVisibleLayers(ctx.map, maskSource, 'duckdb-overlay-mask');
  const inputLayer = addLayerSelect(ctx.toolbar, 'Input layer', ctx.source);
  const maskLayer = addLayerSelect(ctx.toolbar, 'Mask layer', maskSource);
  const operation = addSelect(ctx.toolbar, 'operation', [
    ['intersection', 'intersectionDatasetWithDuckDb'],
    ['difference', 'differenceDatasetWithDuckDb'],
  ]);
  const entrypoint = addSelect(ctx.toolbar, 'entrypoint', [
    ['helper', 'helper'],
    ['mapop', 'duckDbOverlayLayer'],
  ]);
  const outputLayer = addInput(ctx.toolbar, 'Output layer', 'duckdb_overlay_result');
  const contextSources = new Map<string, { getDataset(): MapshaperDataset | null }>();
  addButton(ctx.toolbar, 'Run overlay', async () => {
    await runDuckDbExampleAction(ctx, async (duckdb) => {
      const inputDataset = requireDataset(ctx.source);
      const maskDataset = requireDataset(maskSource);
      const opts = {
        inputLayer: layerIndexByName(inputDataset, inputLayer.value),
        maskLayer: layerIndexByName(maskDataset, maskLayer.value),
        outputLayer: outputLayer.value.trim() || `duckdb_${operation.value}_result`,
      };
      const resultDataset = entrypoint.value === 'mapop'
        ? await runDuckDbOverlayMapOp(duckdb, {
          getSource(id: string) {
            if (id === ctx.sourceId) return { getDataset: () => inputDataset };
            if (id === 'duckdb-overlay-mask') return { getDataset: () => maskDataset };
            return contextSources.get(id);
          },
          setSourceDataset(id: string, dataset: MapshaperDataset) {
            contextSources.set(id, { getDataset: () => dataset });
          },
        },
          ctx.sourceId,
          'duckdb-overlay-mask',
          operation.value,
          opts,
        )
        : operation.value === 'intersection'
          ? await duckdb.intersectionDatasetWithDuckDb(inputDataset, maskDataset, opts)
          : await duckdb.differenceDatasetWithDuckDb(inputDataset, maskDataset, opts);
      const source = addDatasetAsSource(ctx.map, 'duckdb-overlay-output', resultDataset);
      setSourceExtent(ctx.map, source);
      return `${operation.value} output ${countFeatures(resultDataset)} feature(s).`;
    });
  });
}

async function runDuckDbOverlayMapOp(
  duckdb: DuckDbModule,
  context: Parameters<DuckDbModule['duckDbOverlayLayer']>[0],
  sourceId: string,
  maskId: string,
  operation: string,
  opts: Omit<Parameters<DuckDbModule['duckDbOverlayLayer']>[1], 'src' | 'mask' | 'operation'>,
): Promise<MapshaperDataset> {
  const result = await duckdb.duckDbOverlayLayer(context, {
    ...opts,
    src: sourceId,
    mask: maskId,
    operation,
    output: { sourceId: 'duckdb-overlay-output' },
  });
  if (!result.ok) throw new Error(duckDbErrorMessage(result.error));
  return result.value.dataset;
}

function setupDuckDbQuery(ctx: RecipeContext): void {
  const target = addLayerSelect(ctx.toolbar, 'Target', ctx.source);
  const entrypoint = addSelect(ctx.toolbar, 'entrypoint', [
    ['helper', 'queryDatasetWithDuckDb'],
    ['mapop', 'duckDbQueryLayer'],
  ]);
  const outputLayer = addInput(ctx.toolbar, 'Output layer', 'duckdb_query_result');
  const sql = addTextarea(ctx.toolbar, 'SQL', 'SELECT * FROM input LIMIT 50');
  const contextSources = new Map<string, { getDataset(): MapshaperDataset | null }>();
  addButton(ctx.toolbar, 'Run SELECT', async () => {
    await runDuckDbExampleAction(ctx, async (duckdb) => {
      const dataset = requireDataset(ctx.source);
      const layerIndex = layerIndexByName(dataset, target.value);
      duckdb.validateDuckDbSelectSql(sql.value, {
        availableColumns: fieldsForLayer(dataset, layerIndex),
        physicalTableName: 'input_preview',
        rowIdColumn: '__emap_rowid',
      });
      const opts = {
        inputLayer: layerIndex,
        sql: sql.value,
        outputLayer: outputLayer.value.trim() || 'duckdb_query_result',
      };
      const resultDataset = entrypoint.value === 'mapop'
        ? await runDuckDbQueryMapOp(duckdb, {
          getSource(id: string) {
            if (id === ctx.sourceId) return { getDataset: () => dataset };
            return contextSources.get(id);
          },
          setSourceDataset(id: string, nextDataset: MapshaperDataset) {
            contextSources.set(id, { getDataset: () => nextDataset });
          },
        }, ctx.sourceId, opts)
        : await duckdb.queryDatasetWithDuckDb(dataset, opts);
      const output = addDatasetAsSource(ctx.map, 'duckdb-query-output', resultDataset);
      setSourceExtent(ctx.map, output);
      return `Query output ${countFeatures(resultDataset)} feature(s).`;
    });
  });
}

async function runDuckDbQueryMapOp(
  duckdb: DuckDbModule,
  context: DuckDbMapOpContext,
  sourceId: string,
  opts: Omit<Parameters<DuckDbModule['duckDbQueryLayer']>[1], 'src'>,
): Promise<MapshaperDataset> {
  const result = await duckdb.duckDbQueryLayer(context, {
    ...opts,
    src: sourceId,
    output: { sourceId: 'duckdb-query-output' },
  });
  if (!result.ok) throw new Error(duckDbErrorMessage(result.error));
  return result.value.dataset;
}

function setupDuckDbSpatialOps(ctx: RecipeContext): void {
  const target = addLayerSelect(ctx.toolbar, 'Target', ctx.source);
  const operation = addSelect(ctx.toolbar, 'operation', [
    ['centroid', 'Centroid'],
    ['envelope', 'Envelope'],
    ['convexHull', 'Convex Hull'],
    ['boundary', 'Boundary'],
    ['simplify', 'Simplify'],
    ['simplifyPreserveTopology', 'Simplify Preserve Topology'],
    ['makeValid', 'Make Valid'],
    ['area', 'Area Attribute'],
    ['length', 'Length Attribute'],
    ['perimeter', 'Perimeter Attribute'],
    ['geometryType', 'Geometry Type Attribute'],
    ['isValid', 'Is Valid Attribute'],
    ['isEmpty', 'Is Empty Attribute'],
    ['isSimple', 'Is Simple Attribute'],
    ['x', 'X Attribute'],
    ['y', 'Y Attribute'],
    ['centroidX', 'Centroid X Attribute'],
    ['centroidY', 'Centroid Y Attribute'],
    ['intersects', 'Intersects'],
    ['contains', 'Contains'],
    ['within', 'Within'],
    ['touches', 'Touches'],
    ['disjoint', 'Disjoint'],
    ['distance', 'Distance'],
    ['distanceWithin', 'Distance Within'],
  ]);
  const relationMode = addSelect(ctx.toolbar, 'relation mode', [
    ['filter', 'Filter'],
    ['attribute', 'Attribute'],
  ]);
  const maskLayer = addLayerSelect(ctx.toolbar, 'Mask', ctx.source);
  const tolerance = addInput(ctx.toolbar, 'tolerance', '10');
  const distance = addInput(ctx.toolbar, 'distance', '0');
  const crs = addInput(ctx.toolbar, 'CRS', 'EPSG:3857');
  const allowGeographic = addCheckbox(ctx.toolbar, 'allow geographic simplification', false);
  addButton(ctx.toolbar, 'Run DuckDB', async () => {
    await runDuckDbExampleAction(ctx, async (duckdb) => {
      const dataset = requireDataset(ctx.source);
      dataset.info = { ...dataset.info, crs_string: crs.value.trim() || undefined };
      const layerIndex = layerIndexByName(dataset, target.value);
      const baseOpts = {
        layer: layerIndex,
        outputLayer: `${target.value}_${operation.value}`,
        tolerance: Number(tolerance.value),
        failOnGeographicCrs: !allowGeographic.checked,
      };
      const resultDataset = relationOperationIds.has(operation.value)
        ? await duckdb.runRelationOperation(dataset, dataset, {
          src: ctx.sourceId,
          mask: ctx.sourceId,
          inputLayer: layerIndex,
          maskLayer: layerIndexByName(dataset, maskLayer.value),
          outputLayer: `${target.value}_${operation.value}`,
          operation: operation.value,
          mode: relationMode.value,
          distance: Number(distance.value),
          failOnGeographicCrs: !allowGeographic.checked,
        })
        : await runDuckDbUnaryOperation(duckdb, dataset, operation.value, baseOpts);
      const output = addDatasetAsSource(ctx.map, 'duckdb-spatial-output', resultDataset);
      refreshLayerSelect(target, output);
      setSourceExtent(ctx.map, output);
      return `${operation.value} output ${countFeatures(resultDataset)} feature(s).`;
    });
  });
  clickToInspect(ctx);
  addPanelText(ctx.panel, 'DuckDB spatial ops include unary geometry, attribute, and distanceWithin relation operations with click-to-inspect output.');
}

function addExportControls(ctx: RecipeContext, formats: readonly (ExportFormat | 'geoparquet-native')[]): void {
  const select = document.createElement('select');
  for (const format of formats) {
    const option = document.createElement('option');
    option.value = format;
    option.textContent = format;
    select.append(option);
  }
  ctx.toolbar.append(select);
  addButton(ctx.toolbar, 'Export', async () => {
    const value = select.value;
    const format = value === 'geoparquet-native' ? 'geoparquet' : (value as ExportFormat);
    const encoding = value === 'geoparquet-native' ? 'native' : undefined;
    const ext = extensionForFormat(format);
    const filename = `export${ext}`;
    ctx.status.textContent = `Exporting ${filename}...`;
    const blob = await ctx.source.export({ format, encoding });
    downloadBlob(blob, filename);
    ctx.status.textContent = `Exported ${blob.size} bytes as ${filename}.`;
  });
}

function addUploadControl(
  ctx: RecipeContext,
  options: {
    label: string;
    accept: string;
    disabled?: boolean;
    multiple?: boolean;
    onLoad?: (source: TopologySource, file: FileData) => void | Promise<void>;
    onFiles?: (files: FileData[]) => void | Promise<void>;
  },
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = options.accept;
  input.multiple = options.multiple ?? false;
  input.disabled = options.disabled ?? false;
  input.addEventListener('change', () => {
    void (async () => {
      const files = await Promise.all(Array.from(input.files ?? []).map(readBrowserFile));
      input.value = '';
      if (!files.length) return;
      if (options.onFiles) {
        await options.onFiles(files);
        return;
      }
      const source = new TopologySource(ctx.sourceId);
      await importSourceData(ctx.map, source, ctx.sourceId, files.length === 1 ? files[0] : files);
      addVisibleLayers(ctx.map, source, ctx.sourceId);
      setSourceExtent(ctx.map, source);
      ctx.source = source;
      ctx.target = primaryLayerName(source);
      await options.onLoad?.(source, files[0]);
    })().catch((error: unknown) => {
      ctx.status.textContent = error instanceof Error ? error.message : 'File load failed.';
    });
  });

  const wrapper = document.createElement('label');
  wrapper.textContent = `${options.label}: `;
  wrapper.append(input);
  ctx.toolbar.append(wrapper);
  return input;
}

async function readBrowserFile(file: File): Promise<FileData> {
  return {
    filename: file.name,
    content: new Uint8Array(await file.arrayBuffer()),
  };
}

async function initFormats(setStatus: (message: string) => void): Promise<void> {
  setStatus('Initializing GeoParquet / GeoArrow support...');
  try {
    await initParquetWasm();
    setStatus('GeoParquet / GeoArrow support initialized.');
  } catch (error) {
    setStatus(`GeoArrow support initialized; GeoParquet needs parquet-wasm (${error instanceof Error ? error.message : error}).`);
  }
}

function addTextarea(parent: HTMLElement, label: string, value: string): HTMLTextAreaElement {
  const wrapper = document.createElement('label');
  wrapper.textContent = `${label}: `;
  const input = document.createElement('textarea');
  input.value = value;
  wrapper.append(input);
  parent.append(wrapper);
  return input;
}

function addCheckbox(parent: HTMLElement, label: string, checked: boolean): HTMLInputElement {
  const wrapper = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  wrapper.append(input, document.createTextNode(` ${label}`));
  parent.append(wrapper);
  return input;
}

function addSelect(
  parent: HTMLElement,
  label: string,
  options: readonly (readonly [string, string])[],
): HTMLSelectElement {
  const wrapper = document.createElement('label');
  wrapper.textContent = `${label}: `;
  const select = document.createElement('select');
  for (const [value, text] of options) {
    select.append(new Option(text, value));
  }
  wrapper.append(select);
  parent.append(wrapper);
  return select;
}

function addLayerSelect(
  parent: HTMLElement,
  label: string,
  source: TopologySource,
  predicate?: (layer: MapshaperLayer) => boolean,
  includeSourceOption = false,
): HTMLSelectElement {
  const select = addSelect(parent, label, []);
  refreshLayerSelect(select, source, predicate, includeSourceOption);
  return select;
}

function refreshLayerSelect(
  select: HTMLSelectElement,
  source: TopologySource,
  predicate?: (layer: MapshaperLayer) => boolean,
  includeSourceOption = false,
): void {
  select.replaceChildren();
  if (includeSourceOption) select.append(new Option('entire source', ''));
  source.getLayers().forEach((layer, index) => {
    if (predicate && !predicate(layer)) return;
    const name = layerName(layer) || `layer-${index}`;
    select.append(new Option(`${name} (${layer.geometry_type ?? '?'})`, name));
  });
  select.disabled = select.options.length === 0 || (includeSourceOption && select.options.length === 1);
}

function refreshFieldOptions(
  source: TopologySource,
  target: string,
  select: HTMLSelectElement,
): void {
  select.replaceChildren(new Option('whole layer', ''));
  const layer = source.getLayers().find((item) => layerName(item) === target) ?? source.getLayers()[0];
  const records = layer?.data?.getRecords?.() ?? [];
  const fields = layer?.data?.getFields?.() ?? Object.keys(records[0] ?? {});
  for (const field of fields) {
    select.append(new Option(field, field));
  }
}

function numberValue(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseDistance(value: string): number | string {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  return trimmed && Number.isFinite(parsed) ? parsed : trimmed;
}

function capStyleValue(value: string): 'flat' | 'round' | undefined {
  if (value === 'flat' || value === 'round') return value;
  return undefined;
}

function bufferTypeValue(value: string): 'left' | 'right' | 'outer' | 'inner' | undefined {
  if (value === 'left' || value === 'right' || value === 'outer' || value === 'inner') {
    return value;
  }
  return undefined;
}

function simplifyMethodValue(value: string): 'weighted' | 'visvalingam' | 'dp' | undefined {
  if (value === 'weighted' || value === 'visvalingam' || value === 'dp') return value;
  return undefined;
}

function topologyStats(source: TopologySource): string {
  const dataset = source.getDataset();
  const arcs = dataset?.arcs;
  return `layers: ${dataset?.layers.length ?? 0}, arcs: ${arcs?.size?.() ?? 0}, vertices: ${arcs?.getPointCount?.() ?? 0}`;
}

function requireDataset(source: TopologySource): MapshaperDataset {
  const dataset = source.getDataset();
  if (!dataset) throw new Error('Example source did not produce a dataset.');
  return dataset;
}

function removeSourceWithLayers(map: Emap, sourceId: string): void {
  for (const layer of map.getLayers().filter((item) => item.source === sourceId)) {
    map.removeLayer(layer.id);
  }
  if (map.getSource(sourceId)) map.removeSource(sourceId);
}

function addDatasetAsSource(map: Emap, sourceId: string, dataset: MapshaperDataset): TopologySource {
  const source = new TopologySource(sourceId);
  removeSourceWithLayers(map, sourceId);
  source.setDataset(dataset);
  map.addSource(sourceId, source);
  addVisibleLayers(map, source, sourceId);
  return source;
}

function countFeatures(dataset: MapshaperDataset): number {
  return dataset.layers.reduce((total, layer) => total + (layer.shapes?.length ?? 0), 0);
}

function layerIndexByName(dataset: MapshaperDataset, name: string): number {
  const index = dataset.layers.findIndex((layer, layerIndex) => (layerName(layer) || `layer-${layerIndex}`) === name);
  return index >= 0 ? index : 0;
}

function fieldsForLayer(dataset: MapshaperDataset, layerIndex: number): string[] {
  const layer = dataset.layers[layerIndex];
  const records = layer?.data?.getRecords?.() ?? [];
  return layer?.data?.getFields?.() ?? Object.keys(records[0] ?? {});
}

async function loadDuckDbModule(setStatus?: (message: string) => void): Promise<DuckDbModule> {
  setStatus?.('Loading optional DuckDB browser module...');
  try {
    const module = await (duckDbModulePromise ??= import('@zwishing/emap/duckdb'));
    duckDbRuntimePromise ??= module.createDuckDbRuntimeFromJsDelivr().then((runtime) => {
      module.setDuckDbRuntime(runtime);
      return runtime;
    });
    await duckDbRuntimePromise;
    setStatus?.('DuckDB-Wasm runtime is ready.');
    return module;
  } catch (error) {
    duckDbModulePromise = null;
    duckDbRuntimePromise = null;
    throw error;
  }
}

async function runDuckDbExampleAction(
  ctx: RecipeContext,
  action: (duckdb: DuckDbModule) => Promise<string>,
): Promise<void> {
  ctx.status.dataset.state = 'loading';
  try {
    const duckdb = await loadDuckDbModule((message) => {
      ctx.status.textContent = message;
    });
    ctx.status.textContent = await action(duckdb);
    ctx.status.dataset.state = 'ready';
  } catch (error) {
    ctx.status.textContent = `DuckDB is unavailable or the operation failed: ${duckDbErrorMessage(error)}`;
    ctx.status.dataset.state = 'error';
  }
}

const relationOperationIds = new Set([
  'intersects',
  'contains',
  'within',
  'touches',
  'disjoint',
  'distance',
  'distanceWithin',
]);

function duckDbErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return JSON.stringify(error) ?? String(error);
}

async function runDuckDbUnaryOperation(
  duckdb: DuckDbModule,
  dataset: MapshaperDataset,
  operation: string,
  opts: {
    layer: number;
    outputLayer: string;
    tolerance: number;
    failOnGeographicCrs: boolean;
  },
): Promise<MapshaperDataset> {
  switch (operation) {
    case 'centroid':
      return duckdb.centroidDatasetWithDuckDb(dataset, opts);
    case 'envelope':
      return duckdb.envelopeDatasetWithDuckDb(dataset, opts);
    case 'convexHull':
      return duckdb.convexHullDatasetWithDuckDb(dataset, opts);
    case 'boundary':
      return duckdb.boundaryDatasetWithDuckDb(dataset, opts);
    case 'simplify':
      return duckdb.simplifyDatasetWithDuckDb(dataset, opts);
    case 'simplifyPreserveTopology':
      return duckdb.simplifyPreserveTopologyDatasetWithDuckDb(dataset, opts);
    case 'makeValid':
      return duckdb.makeValidDatasetWithDuckDb(dataset, opts);
    case 'area':
      return duckdb.areaDatasetWithDuckDb(dataset, opts);
    case 'length':
      return duckdb.lengthDatasetWithDuckDb(dataset, opts);
    case 'perimeter':
      return duckdb.perimeterDatasetWithDuckDb(dataset, opts);
    case 'geometryType':
      return duckdb.geometryTypeDatasetWithDuckDb(dataset, opts);
    case 'isValid':
      return duckdb.isValidDatasetWithDuckDb(dataset, opts);
    case 'isEmpty':
      return duckdb.isEmptyDatasetWithDuckDb(dataset, opts);
    case 'isSimple':
      return duckdb.isSimpleDatasetWithDuckDb(dataset, opts);
    case 'x':
      return duckdb.xDatasetWithDuckDb(dataset, opts);
    case 'y':
      return duckdb.yDatasetWithDuckDb(dataset, opts);
    case 'centroidX':
      return duckdb.centroidXDatasetWithDuckDb(dataset, opts);
    case 'centroidY':
      return duckdb.centroidYDatasetWithDuckDb(dataset, opts);
    default:
      throw new Error(`Unknown DuckDB spatial operation ${operation}`);
  }
}

function splitCsvList(value: string): string[] | undefined {
  const fields = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return fields.length ? fields : undefined;
}

function showRecords(ctx: RecipeContext): void {
  const dataset = ctx.source.getDataset();
  const layer = dataset?.layers.find((item) => layerName(item) === ctx.target) ?? dataset?.layers[0];
  const records = layer?.data?.getRecords?.() ?? [];
  const fields = layer?.data?.getFields?.() ?? Object.keys(records[0] ?? {});
  const head = records.slice(0, 6);
  ctx.panel.textContent = head.length
    ? [fields.join('\t'), ...head.map((record) => fields.map((field) => record[field]).join('\t'))].join('\n')
    : '(no records)';
}

function parsePropertyValue(value: string): number | string {
  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
}

function extensionForFormat(format: ExportFormat): string {
  const extensions: Record<ExportFormat, string> = {
    geojson: '.geojson',
    topojson: '.topojson',
    shapefile: '.zip',
    msx: '.msx',
    geoparquet: '.parquet',
    geoarrow: '.arrow',
  };
  return extensions[format] ?? `.${format}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function clickToInspect(ctx: RecipeContext): void {
  ctx.container.addEventListener('click', (event) => {
    const features = queryAtEvent(ctx, event);
    if (!features.length) {
      ctx.panel.textContent = '(no feature hit)';
      ctx.map.clearHighlightedFeatures();
      return;
    }
    ctx.map.setHighlightedFeatures(features, { color: '#1e88e5', width: 3, radius: 6, fill: true });
    showFeature(ctx, { source: features[0].source, layer: features[0].layer, id: features[0].id });
  });
}

function clickToSelect(ctx: RecipeContext): void {
  ctx.map.on('selectionchange', (event) => {
    const refs = event.selected;
    ctx.panel.textContent = refs.length ? `${refs.length} selected\n${JSON.stringify(refs, null, 2)}` : '(none)';
    if (refs.length) {
      ctx.map.setHighlightedFeatures(refs, { color: '#d9480f', width: 3, radius: 6, fill: true });
    } else {
      ctx.map.clearHighlightedFeatures();
    }
    ctx.status.textContent = `${refs.length} feature(s) selected.`;
  });
  ctx.container.addEventListener('click', (event) => {
    const features = queryAtEvent(ctx, event);
    if (!features.length) {
      if (!event.shiftKey && !event.ctrlKey && !event.metaKey) ctx.map.clearSelection();
      return;
    }
    const refs = features.map((feature) => ({
      source: feature.source,
      layer: feature.layer,
      id: feature.id,
    }));
    const mode = event.shiftKey ? 'add' : event.ctrlKey || event.metaKey ? 'toggle' : 'replace';
    ctx.map.select(refs, { mode });
  });
}

function queryAtEvent(ctx: RecipeContext, event: MouseEvent, layer = ctx.target) {
  const rect = ctx.container.getBoundingClientRect();
  return ctx.map.queryFeatures([event.clientX - rect.left, event.clientY - rect.top], {
    layers: [layer],
  });
}

function showFeature(ctx: RecipeContext, ref: FeatureRef): void {
  const feature = ctx.map.features.get(ref);
  ctx.panel.textContent = feature
    ? `${ref.layer}#${ref.id}\n${JSON.stringify(feature.properties, null, 2)}`
    : `${ref.layer}#${ref.id}`;
}

function selectFirst(ctx: RecipeContext): void {
  const ref = firstRef(ctx);
  ctx.map.select([ref], { mode: 'replace' });
  ctx.map.setHighlightedFeatures([ref], { color: '#d9480f', width: 3, radius: 6, fill: true });
  ctx.status.textContent = 'First feature selected for the migrated editing control.';
}

function firstRef(ctx: RecipeContext): FeatureRef {
  return { source: ctx.sourceId, layer: ctx.target, id: 0 };
}

function addVisibleLayers(map: Emap, source: TopologySource, id: string): void {
  source.getLayers().forEach((layer, index) => {
    const name = layerName(layer) || `layer-${index}`;
    map.addLayer({
      id: `${id}-${name}-fill`,
      source: id,
      'source-layer': name,
      type: layerType(layer),
      paint: paintForLayer(layer),
    });
  });
}

function layerType(layer: MapshaperLayer): LayerSpecification['type'] {
  if (layer.geometry_type === 'point') return 'circle';
  if (layer.geometry_type === 'polyline') return 'line';
  return 'fill';
}

function paintForLayer(layer: MapshaperLayer): LayerSpecification['paint'] {
  if (layer.geometry_type === 'point') return { 'circle-color': '#b3425f', 'circle-radius': 6 };
  if (layer.geometry_type === 'polyline') return { 'line-color': '#335c99', 'line-width': 2 };
  return { 'fill-color': '#2f6f73', 'fill-opacity': 0.34, 'line-color': '#173e43' };
}

function primaryLayerName(source: TopologySource): string {
  const layer = source.getLayers()[0];
  const name = layer ? layerName(layer) : '';
  if (!name) throw new Error('Loaded fixture did not produce a named layer');
  return name;
}

function layerName(layer: MapshaperLayer): string {
  return layer.name || layer.id || '';
}

function createRecipeChrome(container: HTMLElement): {
  toolbar: HTMLElement;
  panel: HTMLElement;
  status: HTMLElement;
} {
  const toolbar = document.createElement('div');
  toolbar.className = 'example-tools';
  const panel = document.createElement('pre');
  panel.className = 'example-inspector';
  const status = document.createElement('span');
  status.className = 'example-inline-status';
  toolbar.append(status);
  container.append(toolbar, panel);
  return { toolbar, panel, status };
}

function addInput(parent: HTMLElement, label: string, value: string): HTMLInputElement {
  const wrapper = document.createElement('label');
  wrapper.textContent = `${label}: `;
  const input = document.createElement('input');
  input.value = value;
  wrapper.append(input);
  parent.append(wrapper);
  return input;
}

function addButton(parent: HTMLElement, label: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', () => {
    void onClick();
  });
  parent.append(button);
  return button;
}

function addPanelText(panel: HTMLElement, text: string): void {
  panel.textContent = text;
}

function toggleHandler(handler: { enable(): void; disable(): void; isEnabled(): boolean }): void {
  if (handler.isEnabled()) {
    handler.disable();
  } else {
    handler.enable();
  }
}

function opStatus(result: OpResult, success: string): string {
  if (result.ok) return success;
  const failure = result as Extract<OpResult, { ok: false }>;
  return `Operation failed: ${duckDbErrorMessage(failure.error)}`;
}

async function loadFixture(path: string): Promise<string> {
  const response = await fetch(`/${path}`);
  if (!response.ok) {
    throw new Error(`Unable to load fixture ${path}`);
  }
  return response.text();
}

function getMapContainer(): HTMLElement {
  const container = document.getElementById('example-map');
  if (!(container instanceof HTMLElement)) {
    throw new Error('Example map container #example-map was not found');
  }
  return container;
}

function encodeGeoJson(seed: ExampleSeed): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(seed.geojson));
}

function basename(path: string): string {
  return path.split('/').at(-1) ?? path;
}
