import {
  BasemapControl,
  BoxSelectControl,
  DrawFeatureControl,
  EditToolbar,
  Emap,
  HistoryControl,
  LassoSelectControl,
  NavigationControl,
  StatusControl,
  TopologySource,
  VertexEditControl,
  rotateMatrix,
  scaleMatrix,
  type ExportFormat,
  type FeatureRef,
  type LayerSpecification,
  type MapOptions,
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

let activeMap: Emap | null = null;

const sourceId = 'example';
const docsIntro = '/docs/';
const task6Fixture = 'fixtures/task-6-polygons.geojson';
const task6CsvFixture = 'fixtures/task-6-join.csv';
const task6MergeFixture = 'fixtures/task-6-polygons-alt.geojson';

const route = (id: string) => `/examples/${id}/`;
const originalHtml = (id: string) => `test/examples/${id}.html`;
const docs = (slug: string) => [`/docs/examples/${slug}`];

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
    docs: [docsIntro],
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
    docs: [docsIntro],
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
    docs: [docsIntro],
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
    docs: [docsIntro],
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
    docs: [docsIntro],
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
  recipe('attribute-editing', 'data', '属性编辑', 'Attribute editing', 'FeaturePropertyChangeCommand', ['attributes', 'history'], [task6Fixture], 'attr-source', loadAttributeEditing),
  recipe('attribute-expressions', 'data', '属性表达式批量更新', 'Attribute expressions', 'MapshaperOps.applyExpression', ['expressions', 'attributes', 'history'], [task6Fixture], 'attribute-expressions-source', loadAttributeExpressions),
  recipe('data-engineering', 'data', '数据工程批次', 'Data engineering batch', 'MapshaperOps.sortFeatures', ['expressions', 'layer-ops', 'history'], [task6Fixture], 'data-engineering-source', loadDataEngineering),
  recipe('feature-attributes', 'data', '要素属性查询', 'Feature attributes', 'Emap.queryFeatures', ['query', 'highlight', 'basemap'], [task6Fixture], 'feature-attributes-source', loadFeatureAttributes),
  recipe('filter-features', 'data', '要素过滤', 'Filter features', 'MapshaperOps.filterFeatures', ['expressions', 'layer-ops', 'history'], [task6Fixture], 'filter-features-source', loadFilterFeatures),
  recipe('geoparquet-viewer', 'data', 'GeoParquet / GeoArrow 查看器', 'GeoParquet / GeoArrow viewer', 'TopologySource.setData', ['formats', 'basemap'], [], 'parquet-source', loadGeoParquetViewer),
  recipe('export-geoparquet', 'data', '导出 GeoParquet / GeoArrow', 'Export GeoParquet / GeoArrow', 'TopologySource.export', ['formats', 'export', 'basemap'], [task6Fixture], 'main-source', loadExportGeoparquet),
  recipe('export-roundtrip', 'data', '导出往返', 'Export roundtrip', 'TopologySource.export', ['export', 'editing'], [task6Fixture], 'export-roundtrip-source', loadExportRoundtrip),
  recipe('join', 'data', '属性表连接', 'Join table', 'MapshaperOps.joinTable', ['join', 'history'], [task6Fixture, task6CsvFixture], 'join-source', loadJoin),
  recipe('merge-layers', 'layers', '合并图层', 'Merge layers', 'MapshaperOps.mergeLayers', ['layer-ops', 'history'], [task6Fixture, task6MergeFixture], 'merge-source', loadMergeLayers),
  recipe('merge-selected', 'layers', '合并选中要素', 'Merge selected features', 'MapshaperOps.mergeSelected', ['selection', 'layer-ops', 'history'], [task6Fixture], 'merge-selected-source', loadMergeSelected),
  recipe('rename-layer', 'layers', '图层重命名', 'Rename layer', 'MapshaperOps.renameLayer', ['layer-ops', 'history'], [task6Fixture], 'rename-layer-source', loadRenameLayer),
  recipe('split-layer', 'layers', '图层拆分', 'Split layer', 'MapshaperOps.splitLayer', ['expressions', 'layer-ops', 'history'], [task6Fixture], 'split-layer-source', loadSplitLayer),
  recipe('interaction-handlers', 'interaction', '交互 Handler', 'Interaction handlers', 'Emap.dragPan', ['handlers'], [task6Fixture], 'interaction-handlers-source', loadInteractionHandlers),
  recipe('feature-selection', 'interaction', '要素选择', 'Feature selection', 'Emap.select', ['selection', 'history'], [task6Fixture], 'select-source', loadFeatureSelection),
  recipe('box-select', 'interaction', '拉框选择', 'Box select', 'BoxSelectControl', ['selection', 'box-select', 'history'], [task6Fixture], 'box-select-source', loadBoxSelect),
  recipe('lasso-select', 'interaction', '拉框 / 套索选择切换', 'Box and lasso select', 'LassoSelectControl', ['selection', 'box-select', 'lasso-select', 'history'], [task6Fixture], 'lasso-select-source', loadLassoSelect),
  recipe('china-editing', 'editing', '中国行政区划编辑', 'China administrative editing', 'EditToolbar', ['editing', 'basemap'], [task6Fixture], 'china-editing-source', loadChinaEditing),
  recipe('draw-snap-clear', 'editing', '绘制吸附清理', 'Draw snap and clear', 'Emap.drawFeature', ['drawing', 'snap', 'history'], [task6Fixture], 'draw-snap-clear-source', loadDrawSnapClear),
  recipe('draw-snap-edge', 'editing', '绘制时吸附顶点 + 边', 'Draw snap to vertex and edge', 'DrawFeatureControl', ['drawing', 'snap', 'history'], [task6Fixture], 'draw-snap-edge-source', loadDrawSnapEdge),
  recipe('feature-rotate-scale', 'editing', '旋转 / 缩放选中要素', 'Rotate and scale selected feature', 'Emap.editSession.beginAffineSession', ['selection', 'transform', 'history'], [task6Fixture], 'feature-rotate-scale-source', loadFeatureRotateScale),
  recipe('feature-translate', 'editing', '平移选中要素', 'Translate selected feature', 'Emap.editSession.beginTranslateSession', ['selection', 'transform', 'history'], [task6Fixture], 'feature-translate-source', loadFeatureTranslate),
  recipe('snapshot', 'editing', '多源快照保存 / 恢复', 'Snapshot save and restore', 'Emap.exportSnapshot', ['snapshot'], [task6Fixture], 'snapshot-source', loadSnapshot),
  recipe('transaction', 'editing', 'Transaction + Validation', 'Transaction and validation', 'Emap.beginTransaction', ['transaction', 'validation', 'history'], [task6Fixture], 'transaction-source', loadTransaction),
  recipe('undo-redo', 'editing', '撤销 / 重做', 'Undo and redo', 'HistoryControl', ['editing', 'history'], [task6Fixture], 'undo-redo-source', loadUndoRedo),
  recipe('vertex-editing', 'editing', '顶点编辑', 'Vertex editing', 'VertexEditControl', ['editing', 'vertex', 'basemap'], [task6Fixture], 'vertex-editing-source', loadVertexEditing),
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
    docs: docs(id),
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
  ctx.map.addControl(new BoxSelectControl(), 'top-left');
  ctx.map.addControl(new LassoSelectControl(), 'top-left');
  setupFeatureSelection(ctx);
  ctx.status.textContent = 'Box and lasso controls are active for selection QA.';
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
  return result.ok ? success : `Operation failed: ${result.error.kind}`;
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
