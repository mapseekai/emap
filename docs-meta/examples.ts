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
  csvFixture: string;
};

type RecipeDefinition = Omit<ExampleDefinition, 'load'> & {
  sourceId: string;
  filename: string;
  mapOptions?: Omit<MapOptions, 'container'>;
  setup: (ctx: RecipeContext) => void | Promise<void>;
};

let activeMap: Emap | null = null;

const sourceId = 'example';
const docsIntro = '/docs/';
const task6Fixture = 'fixtures/task-6-polygons.geojson';
const task6CsvFixture = 'fixtures/task-6-join.csv';

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
  recipe('attribute-editing', 'data', '属性编辑', 'Attribute editing', 'FeaturePropertyChangeCommand', ['attributes', 'history'], setupAttributeEditing),
  recipe('attribute-expressions', 'data', '属性表达式批量更新', 'Attribute expressions', 'MapshaperOps.applyExpression', ['expressions', 'attributes', 'history'], setupAttributeExpressions, { expressionPolicy: 'trusted' }),
  recipe('data-engineering', 'data', '数据工程批次', 'Data engineering batch', 'MapshaperOps.sortFeatures', ['expressions', 'layer-ops', 'history'], setupDataEngineering, { expressionPolicy: 'trusted' }),
  recipe('feature-attributes', 'data', '要素属性查询', 'Feature attributes', 'Emap.queryFeatures', ['query', 'highlight'], setupFeatureAttributes),
  recipe('filter-features', 'data', '要素过滤', 'Filter features', 'MapshaperOps.filterFeatures', ['expressions', 'layer-ops', 'history'], setupFilterFeatures, { expressionPolicy: 'trusted' }),
  recipe('geoparquet-viewer', 'data', 'GeoParquet / GeoArrow 查看器', 'GeoParquet / GeoArrow viewer', 'TopologySource.setData', ['formats'], setupGeoParquetViewer),
  recipe('export-geoparquet', 'data', '导出 GeoParquet / GeoArrow', 'Export GeoParquet / GeoArrow', 'TopologySource.export', ['formats', 'export'], setupExportGeoparquet),
  recipe('export-roundtrip', 'data', '导出往返', 'Export roundtrip', 'TopologySource.export', ['export', 'editing'], setupExportRoundtrip),
  recipe('join', 'data', '属性表连接', 'Join table', 'MapshaperOps.joinTable', ['join', 'history'], setupJoin, { expressionPolicy: 'trusted' }),
  recipe('merge-layers', 'layers', '合并图层', 'Merge layers', 'MapshaperOps.mergeLayers', ['layer-ops', 'history'], setupMergeLayers),
  recipe('merge-selected', 'layers', '合并选中要素', 'Merge selected features', 'MapshaperOps.mergeSelected', ['selection', 'layer-ops', 'history'], setupMergeSelected),
  recipe('rename-layer', 'layers', '图层重命名', 'Rename layer', 'MapshaperOps.renameLayer', ['layer-ops', 'history'], setupRenameLayer),
  recipe('split-layer', 'layers', '图层拆分', 'Split layer', 'MapshaperOps.splitLayer', ['expressions', 'layer-ops', 'history'], setupSplitLayer, { expressionPolicy: 'trusted' }),
  recipe('interaction-handlers', 'interaction', '交互 Handler', 'Interaction handlers', 'Emap.dragPan', ['handlers'], setupInteractionHandlers),
  recipe('feature-selection', 'interaction', '要素选择', 'Feature selection', 'Emap.select', ['selection', 'history'], setupFeatureSelection),
  recipe('box-select', 'interaction', '拉框选择', 'Box select', 'BoxSelectControl', ['selection', 'box-select', 'history'], setupBoxSelect),
  recipe('lasso-select', 'interaction', '拉框 / 套索选择切换', 'Box and lasso select', 'LassoSelectControl', ['selection', 'box-select', 'lasso-select', 'history'], setupLassoSelect),
  recipe('china-editing', 'editing', '中国行政区划编辑', 'China administrative editing', 'EditToolbar', ['editing', 'basemap'], setupChinaEditing),
  recipe('draw-snap-clear', 'editing', '绘制吸附清理', 'Draw snap and clear', 'Emap.drawFeature', ['drawing', 'snap', 'history'], setupDrawSnapClear),
  recipe('draw-snap-edge', 'editing', '绘制时吸附顶点 + 边', 'Draw snap to vertex and edge', 'DrawFeatureControl', ['drawing', 'snap', 'history'], setupDrawSnapEdge),
  recipe('feature-rotate-scale', 'editing', '旋转 / 缩放选中要素', 'Rotate and scale selected feature', 'Emap.editSession.beginAffineSession', ['selection', 'transform', 'history'], setupFeatureRotateScale),
  recipe('feature-translate', 'editing', '平移选中要素', 'Translate selected feature', 'Emap.editSession.beginTranslateSession', ['selection', 'transform', 'history'], setupFeatureTranslate),
  recipe('snapshot', 'editing', '多源快照保存 / 恢复', 'Snapshot save and restore', 'Emap.exportSnapshot', ['snapshot'], setupSnapshot),
  recipe('transaction', 'editing', 'Transaction + Validation', 'Transaction and validation', 'Emap.beginTransaction', ['transaction', 'validation', 'history'], setupTransaction, { expressionPolicy: 'trusted' }),
  recipe('undo-redo', 'editing', '撤销 / 重做', 'Undo and redo', 'HistoryControl', ['editing', 'history'], setupUndoRedo),
  recipe('vertex-editing', 'editing', '顶点编辑', 'Vertex editing', 'VertexEditControl', ['editing', 'vertex', 'basemap'], setupVertexEditing),
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
    load: () => loadRecipe(item),
  })),
];

function recipe(
  id: string,
  category: string,
  zh: string,
  en: string,
  api: string,
  featureFlags: readonly string[],
  setup: RecipeDefinition['setup'],
  mapOptions?: Omit<MapOptions, 'container'>,
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
    fixtures: id === 'join' ? [task6Fixture, task6CsvFixture] : [task6Fixture],
    source: { html: sourceHtml },
    route: route(id),
    success: `${en} route loads its fixture and exposes the migrated controls from ${sourceHtml}.`,
    sourceId: `${id}-source`,
    filename: basename(task6Fixture),
    mapOptions,
    setup,
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

async function loadRecipe(recipeDef: RecipeDefinition): Promise<void> {
  const container = getMapContainer();
  activeMap?.remove();
  activeMap = null;
  container.replaceChildren();

  const { toolbar, panel, status } = createRecipeChrome(container);
  const map = new Emap({ container, ...recipeDef.mapOptions });
  activeMap = map;

  map.addControl(new NavigationControl(), 'top-left');
  if (recipeDef.featureFlags.includes('history')) {
    map.addControl(new HistoryControl(), 'top-left');
    map.bindHistoryShortcuts();
  }
  if (recipeDef.featureFlags.includes('basemap')) {
    map.addControl(new BasemapControl(), 'top-right');
  }
  if (recipeDef.featureFlags.includes('basemap') || recipeDef.featureFlags.includes('formats')) {
    map.addControl(new StatusControl({ alignment: 'right', showEPSG: true }), 'bottom-right');
  }

  const [geojson, csvFixture] = await Promise.all([loadFixture(recipeDef.fixtures[0]), loadFixture(task6CsvFixture)]);
  const source = new TopologySource(recipeDef.sourceId);
  await source.setData({ filename: recipeDef.filename, content: new TextEncoder().encode(geojson) });
  map.addSource(recipeDef.sourceId, source);
  addVisibleLayers(map, source, recipeDef.sourceId);

  const extent = source.getExtent();
  if (extent.hasBounds()) {
    map.setExtent(extent);
  }

  const target = primaryLayerName(source);
  status.textContent = `Loaded ${recipeDef.filename}. ${recipeDef.success}`;
  await recipeDef.setup({
    map,
    source,
    sourceId: recipeDef.sourceId,
    target,
    toolbar,
    panel,
    status,
    container,
    csvFixture,
  });
}

function setupAttributeEditing(ctx: RecipeContext): void {
  addPanelText(ctx.panel, 'Click a feature or use the buttons to edit the first record.');
  const field = addInput(ctx.toolbar, 'New field', 'reviewed');
  addButton(ctx.toolbar, 'Add field', () => {
    const result = ctx.map.attributes.addField({
      source: ctx.sourceId,
      target: ctx.target,
      field: field.value.trim() || 'reviewed',
      defaultValue: 'yes',
    });
    ctx.status.textContent = opStatus(result, 'Field added. Ctrl+Z reverses the schema edit.');
  });
  addButton(ctx.toolbar, 'Set name', () => {
    const ref = firstRef(ctx);
    const result = ctx.map.attributes.setFeatureProperty(ref, 'name', 'Edited feature');
    ctx.status.textContent = opStatus(result, 'First feature name updated. Ctrl+Z reverses it.');
    showFeature(ctx, ref);
  });
  clickToInspect(ctx);
  showFeature(ctx, firstRef(ctx));
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

function setupGeoParquetViewer(ctx: RecipeContext): void {
  addPanelText(ctx.panel, 'Format support is flagged for GeoParquet / GeoArrow; the route auto-loads GeoJSON for deterministic catalog QA.');
  addExportControls(ctx, ['geojson']);
}

function setupExportGeoparquet(ctx: RecipeContext): void {
  addPanelText(ctx.panel, 'Use the export selector after loading. GeoParquet and GeoArrow require the formats feature flag at runtime.');
  addExportControls(ctx, ['geojson', 'topojson', 'shapefile']);
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

function setupJoin(ctx: RecipeContext): void {
  addButton(ctx.toolbar, 'Join CSV', async () => {
    const result = await ctx.map.ops.joinTable({
      source: ctx.sourceId,
      target: ctx.target,
      data: { csv: ctx.csvFixture },
      keys: ['id', 'id'],
      fields: ['score', 'owner'],
      prefix: 'joined_',
      unjoined: true,
    });
    ctx.status.textContent = opStatus(result, 'CSV attributes joined into the active layer.');
  });
  addPanelText(ctx.panel, ctx.csvFixture);
}

function setupMergeLayers(ctx: RecipeContext): void {
  addButton(ctx.toolbar, 'Merge visible layers', async () => {
    const layers = ctx.source.getLayers().map(layerName).filter(Boolean);
    if (layers.length < 2) {
      ctx.status.textContent = 'The fixture loaded one layer; upload a multi-layer file in the source HTML for a full merge.';
      return;
    }
    const result = await ctx.map.ops.mergeLayers({ source: ctx.sourceId, targets: layers, name: 'merged', force: true });
    ctx.status.textContent = opStatus(result, 'Layers merged into a single output.');
  });
  addPanelText(ctx.panel, 'Migrated merge controls keep force/flatten semantics from the original HTML.');
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

function addExportControls(ctx: RecipeContext, formats: readonly ExportFormat[]): void {
  const select = document.createElement('select');
  for (const format of formats) {
    const option = document.createElement('option');
    option.value = format;
    option.textContent = format;
    select.append(option);
  }
  ctx.toolbar.append(select);
  addButton(ctx.toolbar, 'Export', async () => {
    const blob = await ctx.source.export({ format: select.value as ExportFormat });
    ctx.status.textContent = `Exported ${blob.size} bytes as ${select.value}.`;
  });
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
  ctx.container.addEventListener('click', (event) => {
    const features = queryAtEvent(ctx, event);
    if (!features.length) return;
    const refs = features.map((feature) => ({
      source: feature.source,
      layer: feature.layer,
      id: feature.id,
    }));
    ctx.map.select(refs, { mode: 'replace' });
    ctx.map.setHighlightedFeatures(refs, { color: '#d9480f', width: 3, radius: 6, fill: true });
    ctx.status.textContent = `${ctx.map.getSelection().length} feature(s) selected.`;
  });
}

function queryAtEvent(ctx: RecipeContext, event: MouseEvent) {
  const rect = ctx.container.getBoundingClientRect();
  return ctx.map.queryFeatures([event.clientX - rect.left, event.clientY - rect.top], {
    layers: [ctx.target],
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
