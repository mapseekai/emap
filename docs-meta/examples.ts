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
}

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

const route = (id: string) => `/examples/${id}/`;
const sourceHtml = (id: string) => `packages/examples/examples/${id}/index.html`;

const seeds: readonly ExampleDefinition[] = [
  seed(
    'getting-started/geojson-viewer',
    'GeoJSON 查看器',
    'GeoJSON viewer',
    [docsEmap, docsSourceLayer, docsFitBounds],
    'Emap',
    'fixtures/getting-started-geojson-viewer.geojson',
    'The map renders a small mixed GeoJSON scene and fits it in the viewport.',
  ),
  seed(
    'getting-started/points',
    '点图层',
    'Points',
    [docsSourceLayer, docsFileUpload],
    'TopologySource.fromBytes',
    'fixtures/getting-started-points.geojson',
    'Three point features render as circle marks with distinct attribute records.',
  ),
  seed(
    'getting-started/lines',
    '线图层',
    'Lines',
    [docsSourceLayer, docsStyling],
    'LayerSpecification',
    'fixtures/getting-started-lines.geojson',
    'Two route features render as stroked line paths.',
  ),
  seed(
    'getting-started/polygons',
    '面边界',
    'Polygons',
    [docsStyling],
    'LinePaint',
    'fixtures/getting-started-polygons.geojson',
    'Two polygon boundaries render as linework while preserving topology.',
  ),
  seed(
    'getting-started/polygon-fill',
    '面填充',
    'Polygon fill',
    [docsStyling],
    'FillPaint',
    'fixtures/getting-started-polygon-fill.geojson',
    'The polygon layer renders with a translucent fill and visible outline.',
  ),
];

const recipes: readonly ExampleDefinition[] = [
  recipe('attribute-editing', 'data', '属性编辑', 'Attribute editing', [docsAttributes, docsEditing, docsUndoRedo], 'Emap', ['attributes', 'history'], [task6Fixture]),
  recipe('attribute-expressions', 'data', '属性表达式批量更新', 'Attribute expressions', [docsAttributes, docsMigration], 'Emap', ['expressions', 'attributes', 'history'], [task6Fixture]),
  recipe('data-engineering', 'data', '数据工程批次', 'Data engineering batch', [docsOperations, docsAttributes], 'Emap', ['expressions', 'layer-ops', 'history'], [task6Fixture]),
  recipe('feature-attributes', 'data', '要素属性查询', 'Feature attributes', [docsAttributes, docsEvents], 'Emap', ['query', 'highlight', 'basemap'], [task6Fixture]),
  recipe('filter-features', 'data', '要素过滤', 'Filter features', [docsAttributes, docsOperations], 'Emap', ['expressions', 'layer-ops', 'history'], [task6Fixture]),
  recipe('geoparquet-viewer', 'data', 'GeoParquet / GeoArrow 查看器', 'GeoParquet / GeoArrow viewer', [docsFormats, docsFileUpload, docsCompatibility], 'TopologySource.fromBytes', ['formats', 'basemap'], ['fixtures/example-geoparquet.parquet']),
  recipe('export-geoparquet', 'data', '导出 GeoParquet / GeoArrow', 'Export GeoParquet / GeoArrow', [docsFormats], 'TopologySource.fromBytes', ['formats', 'export', 'basemap'], [task6Fixture]),
  recipe('export-roundtrip', 'data', '导出往返', 'Export roundtrip', [docsFormats, docsEditing], 'TopologySource.fromBytes', ['export', 'editing'], [task6Fixture]),
  recipe('join', 'data', '属性表连接', 'Join table', [docsAttributes], 'Emap', ['join', 'history'], [task6Fixture, task6CsvFixture]),
  recipe('merge-layers', 'layers', '合并图层', 'Merge layers', [docsSourceLayer, docsOperations], 'Emap', ['layer-ops', 'history'], [task6Fixture, task6MergeFixture]),
  recipe('merge-selected', 'layers', '合并选中要素', 'Merge selected features', [docsSelection, docsOperations], 'Emap', ['selection', 'layer-ops', 'history'], [task6Fixture]),
  recipe('rename-layer', 'layers', '图层重命名', 'Rename layer', [docsSourceLayer, docsOperations], 'Emap', ['layer-ops', 'history'], [task6Fixture]),
  recipe('split-layer', 'layers', '图层拆分', 'Split layer', [docsSourceLayer, docsOperations, docsAttributes], 'Emap', ['expressions', 'layer-ops', 'history'], [task6Fixture]),
  recipe('interaction-handlers', 'interaction', '交互 Handler', 'Interaction handlers', [docsEvents, docsControls], 'Emap', ['handlers'], [task6Fixture]),
  recipe('feature-selection', 'interaction', '要素选择', 'Feature selection', [docsSelection], 'Emap', ['selection', 'history'], [task6Fixture]),
  recipe('box-select', 'interaction', '拉框选择', 'Box select', [docsSelection, docsControls], 'Emap', ['selection', 'box-select', 'history'], [task6Fixture]),
  recipe('lasso-select', 'interaction', '拉框 / 套索选择切换', 'Box and lasso select', [docsSelection, docsControls], 'Emap', ['selection', 'box-select', 'lasso-select', 'history'], [task6Fixture]),
  recipe('china-editing', 'editing', '中国行政区划编辑', 'China administrative editing', [docsEditing, docsControls], 'Emap', ['editing', 'basemap'], [task6Fixture]),
  recipe('draw-snap-clear', 'editing', '绘制吸附清理', 'Draw snap and clear', [docsEditing], 'Emap', ['drawing', 'snap', 'history'], [task6Fixture]),
  recipe('draw-snap-edge', 'editing', '绘制时吸附顶点 + 边', 'Draw snap to vertex and edge', [docsEditing, docsControls], 'Emap', ['drawing', 'snap', 'history'], [task6Fixture]),
  recipe('feature-rotate-scale', 'editing', '旋转 / 缩放选中要素', 'Rotate and scale selected feature', [docsEditing, docsSelection], 'Emap', ['selection', 'transform', 'history'], [task6Fixture]),
  recipe('feature-translate', 'editing', '平移选中要素', 'Translate selected feature', [docsEditing, docsSelection], 'Emap', ['selection', 'transform', 'history'], [task6Fixture]),
  recipe('snapshot', 'editing', '多源快照保存 / 恢复', 'Snapshot save and restore', [docsEditing], 'Emap', ['snapshot'], [task6Fixture]),
  recipe('transaction', 'editing', 'Transaction + Validation', 'Transaction and validation', [docsEditing, docsErrors], 'Emap', ['transaction', 'validation', 'history'], [task6Fixture]),
  recipe('undo-redo', 'editing', '撤销 / 重做', 'Undo and redo', [docsUndoRedo, docsEditing], 'Emap', ['editing', 'history'], [task6Fixture]),
  recipe('vertex-editing', 'editing', '顶点编辑', 'Vertex editing', [docsEditing, docsControls], 'Emap', ['editing', 'vertex', 'basemap'], [task6Fixture]),
  recipe('buffer', 'spatial', '缓冲区', 'Buffer', [docsOperations], 'Emap', ['spatial', 'history'], [task7Fixture]),
  recipe('check-geometry', 'validation', '几何检查', 'Check geometry', [docsOperations, docsErrors], 'Emap', ['validation', 'history'], [task7Fixture]),
  recipe('clip-erase', 'spatial', '裁剪 / 擦除', 'Clip and erase', [docsOperations], 'Emap', ['spatial', 'overlay', 'history'], [task7Fixture, task7MaskFixture]),
  recipe('dissolve', 'spatial', '融合', 'Dissolve', [docsOperations], 'Emap', ['spatial', 'history'], [task7Fixture]),
  recipe('divide', 'spatial', '按面切分线', 'Divide lines by polygons', [docsOperations], 'Emap', ['spatial', 'overlay', 'history'], [task7LineFixture, task7MaskFixture]),
  recipe('explode', 'spatial', '拆分多部件', 'Explode multipart features', [docsOperations], 'Emap', ['spatial', 'history'], [task7Fixture]),
  recipe('innerlines', 'spatial', '抽取共享边', 'Innerlines', [docsOperations], 'Emap', ['spatial', 'history'], [task7Fixture]),
  recipe('mosaic', 'spatial', '平展重叠面', 'Mosaic', [docsOperations], 'Emap', ['spatial', 'history'], [task7Fixture]),
  recipe('project', 'crs', '投影转换', 'Project CRS', [docsCrs, docsOperations], 'Emap', ['crs', 'history', 'basemap'], [task7Fixture]),
  recipe('rebuild-topology', 'validation', '重建拓扑', 'Rebuild topology', [docsOperations, docsEditing], 'Emap', ['validation', 'editing', 'history'], [task7Fixture]),
  recipe('simplify-control', 'spatial', '简化控件', 'Simplify control', [docsOperations, docsControls, docsPerformance], 'Emap', ['spatial', 'controls', 'history'], [task7Fixture]),
  recipe('simplify', 'spatial', '几何简化', 'Simplify geometry', [docsOperations, docsPerformance], 'Emap', ['spatial', 'history'], [task7Fixture]),
  recipe('snap-layer', 'spatial', '批量吸附', 'Snap layer', [docsOperations], 'Emap', ['spatial', 'export', 'history'], [task7LineFixture]),
  recipe('union', 'spatial', '面并集', 'Union polygons', [docsOperations], 'Emap', ['spatial', 'overlay', 'history'], [task7Fixture, task7MaskFixture]),
  recipe('crs-switch', 'crs', '坐标系切换', 'CRS switch', [docsCrs], 'Emap', ['crs', 'history', 'basemap'], [task7Fixture]),
  recipe('web-worker', 'platform', 'Web Worker 重命令', 'Web Worker heavy operations', [docsWorker, docsPerformance], 'Emap', ['worker', 'history'], [task7Fixture]),
  recipe('duckdb-buffer', 'duckdb', 'DuckDB 缓冲区', 'DuckDB buffer', [docsDuckDb, docsErrorHandling], 'Emap', ['duckdb', 'basemap'], [task7Fixture]),
  recipe('duckdb-geoparquet-query', 'duckdb', 'DuckDB GeoParquet 查询', 'DuckDB GeoParquet query', [docsDuckDb, docsFormats, docsStatusControl], 'Emap', ['duckdb', 'geoparquet', 'basemap'], ['fixtures/example-geoparquet.parquet']),
  recipe('duckdb-overlay', 'duckdb', 'DuckDB Overlay', 'DuckDB overlay', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'overlay', 'basemap'], [task7Fixture, task7MaskFixture]),
  recipe('duckdb-query', 'duckdb', 'DuckDB 受限 SELECT', 'DuckDB restricted SELECT', [docsDuckDb, docsStatusControl, docsErrorHandling], 'Emap', ['duckdb', 'query', 'basemap'], [task7Fixture]),
  recipe('duckdb-spatial-ops', 'duckdb', 'DuckDB 空间函数', 'DuckDB spatial functions', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'basemap'], [task7Fixture]),
];

export const examples: readonly ExampleDefinition[] = [...seeds, ...recipes];

function seed(
  id: string,
  zh: string,
  en: string,
  docs: readonly string[],
  api: string,
  fixture: string,
  success: string,
): ExampleDefinition {
  return {
    id,
    category: 'getting-started',
    title: { zh, en },
    description: {
      zh: '加载本地 GeoJSON，演示最小化地图初始化和图层渲染路径。',
      en: 'Loads local GeoJSON to demonstrate the minimal map setup and layer rendering path.',
    },
    learningGoals: {
      zh: ['初始化 Emap 容器', '通过 TopologySource 加载本地数据', '添加可见图层并缩放至范围'],
      en: [
        'Initialize an Emap container',
        'Load local data with TopologySource',
        'Add a visible layer and fit its extent',
      ],
    },
    docs,
    api: [api],
    tags: ['getting-started', 'local-fixture'],
    featureFlags: [],
    fixtures: [fixture],
    source: { html: sourceHtml(id) },
    route: route(id),
    success,
  };
}

function recipe(
  id: string,
  category: string,
  zh: string,
  en: string,
  docs: readonly string[],
  api: string,
  featureFlags: readonly string[],
  fixtures: readonly string[],
): ExampleDefinition {
  const html = sourceHtml(id);
  return {
    id,
    category,
    title: { zh, en },
    description: {
      zh: `从 ${html} 迁移的独立 Vite 示例，自动加载静态夹具并保留原始交互控件。`,
      en: `Standalone Vite migration of ${html}; it auto-loads a static fixture and keeps the original interaction controls.`,
    },
    learningGoals: {
      zh: [`复现 ${zh} 的数据加载顺序`, `运行 ${api} 相关 API`, '确认页面状态栏中的成功条件'],
      en: [
        `Reproduce the data-loading order for ${en}`,
        `Run the ${api} API path`,
        'Confirm the success condition in the status bar',
      ],
    },
    docs,
    api: [api],
    tags: [category, id, ...featureFlags],
    featureFlags,
    fixtures,
    source: { html },
    route: route(id),
    success: `${en} route loads its fixture and exposes the migrated controls from ${html}.`,
  };
}
