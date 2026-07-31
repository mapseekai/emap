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

const exampleDescriptions = {
  'getting-started/geojson-viewer': {
    zh: '加载同时包含点、线和面的 GeoJSON，并自动缩放到全部要素范围。',
    en: 'Loads GeoJSON containing points, lines, and polygons, then fits the map to every feature.',
  },
  'getting-started/points': {
    zh: '加载带属性记录的点要素，并使用 circle 图层渲染不同样式的标记。',
    en: 'Loads point features with attribute records and renders styled markers with a circle layer.',
  },
  'getting-started/lines': {
    zh: '加载两条线路要素，并通过 line 图层设置描边颜色和宽度。',
    en: 'Loads two route features and styles their stroke color and width with a line layer.',
  },
  'getting-started/polygons': {
    zh: '加载共享拓扑的面要素，并以线图层显示各个面的边界。',
    en: 'Loads polygon features with shared topology and displays their boundaries as linework.',
  },
  'getting-started/polygon-fill': {
    zh: '加载面要素，并组合半透明填充和轮廓线展示基础面样式。',
    en: 'Loads polygon features and combines translucent fills with outlines for basic polygon styling.',
  },
  'attribute-editing': {
    zh: '选择地图要素后编辑字段值，并通过历史记录撤销或重做属性变化。',
    en: 'Selects map features, edits field values, and uses history to undo or redo attribute changes.',
  },
  'attribute-expressions': {
    zh: '对图层记录运行属性表达式，批量计算并更新 density 等字段。',
    en: 'Runs attribute expressions across layer records to calculate and update fields such as density.',
  },
  'data-engineering': {
    zh: '按顺序执行删除、排序、去重、筛选字段和重命名字段等数据整理操作。',
    en: 'Runs drop, sort, deduplication, field filtering, and field renaming as a data-cleaning batch.',
  },
  'feature-attributes': {
    zh: '点击地图要素读取属性记录，同时高亮当前命中的要素并显示查询结果。',
    en: 'Queries attributes on map click, highlights the matched feature, and displays its record.',
  },
  'filter-features': {
    zh: '使用属性表达式筛选图层要素，并将筛选结果作为可撤销的数据操作应用。',
    en: 'Filters layer features with an attribute expression and records the result as an undoable operation.',
  },
  'geoparquet-viewer': {
    zh: '从本地文件加载 GeoParquet 或 GeoArrow 数据，并将解析后的几何显示在地图上。',
    en: 'Loads local GeoParquet or GeoArrow data and displays the decoded geometry on the map.',
  },
  'export-geoparquet': {
    zh: '把当前数据源导出为 GeoParquet 或 GeoArrow 文件，并提供浏览器下载。',
    en: 'Exports the current source as GeoParquet or GeoArrow and downloads the result in the browser.',
  },
  'export-roundtrip': {
    zh: '导出当前数据集后立即重新导入，用于验证格式往返过程中的几何和属性。',
    en: 'Exports and immediately reimports a dataset to verify geometry and attributes across a format round trip.',
  },
  join: {
    zh: '加载 CSV 属性表，按连接字段把外部记录合并到地图图层的要素属性中。',
    en: 'Loads a CSV table and joins external records into feature attributes using a matching field.',
  },
  'merge-layers': {
    zh: '把多个兼容图层合并为一个图层，同时保留各图层中的几何和属性记录。',
    en: 'Combines compatible layers into one layer while preserving their geometry and attribute records.',
  },
  'merge-selected': {
    zh: '选择多个要素后将其合并，并通过选择状态和历史记录展示结果。',
    en: 'Merges multiple selected features and exposes the result through selection state and edit history.',
  },
  'rename-layer': {
    zh: '修改数据源中的图层名称，并同步刷新图层选择器和地图状态。',
    en: 'Renames a source layer and synchronizes the layer picker and map state with the new name.',
  },
  'split-layer': {
    zh: '按属性值把一个图层拆分成多个图层，并在操作后更新可选图层列表。',
    en: 'Splits one layer into multiple layers by attribute value and refreshes the available layer list.',
  },
  'interaction-handlers': {
    zh: '切换点击、拖拽和滚轮等命名交互 Handler，观察启用状态和事件响应。',
    en: 'Toggles named click, drag, and wheel handlers to demonstrate enablement state and event responses.',
  },
  'feature-selection': {
    zh: '通过地图点击选择要素，展示新增、切换和清空选择时的状态变化。',
    en: 'Selects features by map click and shows state changes when adding, toggling, or clearing selections.',
  },
  'box-select': {
    zh: '拖动矩形框批量选择范围内的要素，并显示选择数量和选择结果。',
    en: 'Drag-selects features inside a rectangular extent and reports the resulting selection count.',
  },
  'lasso-select': {
    zh: '在矩形框选和自由套索之间切换，比较两种区域选择方式的结果。',
    en: 'Switches between rectangular box selection and freehand lasso selection to compare their results.',
  },
  'china-editing': {
    zh: '加载中国行政区划数据，结合底图和编辑控件修改行政区几何。',
    en: 'Loads Chinese administrative boundaries and combines a basemap with controls for geometry editing.',
  },
  'draw-snap-clear': {
    zh: '绘制折线时吸附参考几何，并在完成后清理临时参考图层和绘制状态。',
    en: 'Snaps a drawn line to reference geometry and clears temporary layers and drawing state afterward.',
  },
  'draw-snap-edge': {
    zh: '绘制新要素时同时吸附已有顶点和边中点，展示两类吸附反馈。',
    en: 'Snaps new geometry to existing vertices and edge midpoints while showing both snap feedback types.',
  },
  'feature-rotate-scale': {
    zh: '选择要素后围绕中心点旋转或缩放，并将连续变换合并到编辑历史。',
    en: 'Rotates or scales a selected feature around its center and records the transform in edit history.',
  },
  'feature-translate': {
    zh: '拖动选中要素进行平移，同时保持共享拓扑并支持撤销和重做。',
    en: 'Translates selected features by dragging while preserving shared topology and undo/redo support.',
  },
  snapshot: {
    zh: '保存包含多个数据源的地图快照，并从快照恢复数据、图层和相关状态。',
    en: 'Saves a map snapshot with multiple sources and restores its datasets, layers, and related state.',
  },
  transaction: {
    zh: '在事务中组合多步编辑，运行验证器后统一提交或回滚所有变化。',
    en: 'Groups multiple edits in a transaction and commits or rolls them back after validation.',
  },
  'undo-redo': {
    zh: '执行可编辑操作并使用按钮或快捷键在历史记录中撤销和重做。',
    en: 'Performs editable operations and navigates history with undo and redo buttons or shortcuts.',
  },
  'vertex-editing': {
    zh: '进入顶点编辑模式，移动、插入或删除节点并观察共享边界同步更新。',
    en: 'Enters vertex-editing mode to move, insert, or delete nodes while shared boundaries stay synchronized.',
  },
  buffer: {
    zh: '为选定图层按给定距离生成缓冲区，并把处理结果作为新几何显示。',
    en: 'Builds distance-based buffers for a selected layer and displays the processed geometry.',
  },
  'check-geometry': {
    zh: '检查图层中的几何问题，汇总验证结果并定位需要修复的要素。',
    en: 'Checks a layer for geometry problems, summarizes validation results, and identifies affected features.',
  },
  'clip-erase': {
    zh: '使用遮罩图层对输入要素执行裁剪或擦除，并对比两种叠加结果。',
    en: 'Uses a mask layer to clip or erase input features and compares the two overlay results.',
  },
  dissolve: {
    zh: '按属性字段融合相邻或同组面要素，生成边界合并后的结果图层。',
    en: 'Dissolves polygon features by an attribute field and produces merged boundaries for each group.',
  },
  divide: {
    zh: '使用面图层边界切分线要素，生成按相交区域分段的折线结果。',
    en: 'Divides line features with polygon boundaries and returns line segments split by intersecting areas.',
  },
  explode: {
    zh: '把多部件几何拆分成独立要素，并保留原有属性记录。',
    en: 'Explodes multipart geometry into separate features while retaining the original attributes.',
  },
  innerlines: {
    zh: '从相邻面要素中提取共享内部边界，并作为独立线图层显示。',
    en: 'Extracts shared interior boundaries from adjacent polygons and displays them as a line layer.',
  },
  mosaic: {
    zh: '将重叠面平展为无重叠镶嵌单元，展示拓扑化后的分区结果。',
    en: 'Flattens overlapping polygons into non-overlapping mosaic cells and displays the topological partition.',
  },
  project: {
    zh: '把数据源重投影到目标坐标系，并更新地图范围和坐标系状态。',
    en: 'Reprojects a source to a target coordinate system and updates the map extent and CRS state.',
  },
  'rebuild-topology': {
    zh: '重新构建图层拓扑以修复共享边关系，并展示处理前后的数据状态。',
    en: 'Rebuilds layer topology to repair shared-edge relationships and exposes the resulting dataset state.',
  },
  'simplify-control': {
    zh: '通过地图控件交互调整简化比例，实时观察不同细节等级的几何。',
    en: 'Adjusts simplification interactively with a map control and previews geometry at different detail levels.',
  },
  simplify: {
    zh: '配置简化方法和保留比例处理图层，并支持查看和撤销结果。',
    en: 'Simplifies a layer with a chosen method and retention percentage, with result inspection and undo.',
  },
  'snap-layer': {
    zh: '将一个图层的顶点批量吸附到参考图层，并导出或撤销吸附结果。',
    en: 'Snaps one layer’s vertices to a reference layer in bulk and supports exporting or undoing the result.',
  },
  union: {
    zh: '计算多个面要素的并集，合并重叠区域并输出新的面图层。',
    en: 'Computes the union of polygon features, merges overlapping areas, and outputs a new polygon layer.',
  },
  'crs-switch': {
    zh: '在 EPSG:3857、EPSG:4326 和数据原始坐标系之间切换地图显示。',
    en: 'Switches the map among EPSG:3857, EPSG:4326, and the dataset’s original coordinate system.',
  },
  'web-worker': {
    zh: '把耗时的地图处理命令交给 Web Worker 执行，并显示运行状态和结果。',
    en: 'Runs expensive map-processing commands in a Web Worker and reports progress and results.',
  },
  'duckdb-buffer': {
    zh: '使用 DuckDB-Wasm 的 ST_Buffer 生成缓冲区，并把 SQL 结果转换为地图图层。',
    en: 'Uses DuckDB-Wasm ST_Buffer to create buffers and converts the SQL result into a map layer.',
  },
  'duckdb-geoparquet-query': {
    zh: '通过 DuckDB-Wasm 直接查询 GeoParquet 文件，并将查询结果加载为可视图层。',
    en: 'Queries a GeoParquet file directly with DuckDB-Wasm and loads the result as a visible layer.',
  },
  'duckdb-overlay': {
    zh: '使用 DuckDB 空间函数对输入图层和遮罩图层执行叠加分析并显示结果。',
    en: 'Uses DuckDB spatial functions to overlay an input layer with a mask layer and displays the result.',
  },
  'duckdb-query': {
    zh: '校验并执行受限 SELECT 查询，将安全的查询结果转换为地图数据。',
    en: 'Validates and executes a restricted SELECT statement, then converts the safe result into map data.',
  },
  'duckdb-spatial-ops': {
    zh: '集中演示 DuckDB 几何、属性和空间关系函数，并在共享图层选择器中查看结果。',
    en: 'Demonstrates DuckDB geometry, attribute, and spatial-relation functions through a shared layer picker.',
  },
} as const satisfies Record<string, LocalizedText>;

type ExampleId = keyof typeof exampleDescriptions;

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
  id: ExampleId,
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
    description: exampleDescriptions[id],
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
  id: ExampleId,
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
    description: exampleDescriptions[id],
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
    success: `The ${en} example loads its fixtures and exposes its interaction controls.`,
  };
}
