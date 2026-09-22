type LocalizedText = { zh: string; en: string };

export const exampleTopics = {
  duckdb: {
    category: 'data-analysis',
    title: { zh: 'DuckDB 空间数据分析', en: 'DuckDB spatial data analysis' },
    sections: [
      { id: 'query', title: { zh: '查询与数据接入', en: 'Query and data access' } },
      { id: 'workflow', title: { zh: '专项分析流程', en: 'Specialized workflows' } },
      { id: 'geometry', title: { zh: '几何处理', en: 'Geometry processing' } },
      { id: 'attribute', title: { zh: '属性派生', en: 'Derived attributes' } },
      { id: 'relation', title: { zh: '空间关系', en: 'Spatial relations' } },
    ],
  },
} as const;

export type ExampleTopicId = keyof typeof exampleTopics;
export type DuckDbTopicSectionId = (typeof exampleTopics)['duckdb']['sections'][number]['id'];

export interface ExampleTopicPlacement {
  id: ExampleTopicId;
  section: DuckDbTopicSectionId;
}

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
  topic?: ExampleTopicPlacement;
}

const docsEmap = '/docs/concepts/emap';
const docsSourceLayer = '/docs/concepts/source-layer';
const docsCrs = '/docs/concepts/coordinates-crs';
const docsStyling = '/docs/guides/styling';
const docsEvents = '/docs/guides/events';
const docsSelection = '/docs/guides/selection';
const docsEditing = '/docs/guides/editing';
const docsControls = '/docs/guides/controls';
const docsPlugins = '/docs/guides/plugins';
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

const task6Fixture = 'fixtures/task-6-polygons.geojson';
const task6CsvFixture = 'fixtures/task-6-join.csv';
const task6MergeFixture = 'fixtures/task-6-polygons-alt.geojson';
const task7Fixture = 'fixtures/task-7-polygons.geojson';
const task7LineFixture = 'fixtures/task-7-lines.geojson';
const ringPartHoledFixture = 'fixtures/reshape-ring-part-holed.geojson';
const task7MaskFixture = 'fixtures/task-7-mask.geojson';
const duckDbSpatialAggregatePointsFixture = 'fixtures/duckdb-spatial-aggregate-points.geojson';

const route = (id: string) => `/examples/${id}/`;
const sourceHtml = (id: string) => `packages/examples/examples/${id}/index.html`;

const exampleDescriptions = {
  'luma-raster': {zh: '动态读取本地 TIFF 的原生块和金字塔，对照正式 Canvas 与 UInt8/UInt16 WebGL2/WebGPU 数据纹理，支持文件夹与外部 OVR。', en: 'Dynamically reads TIFF blocks and overviews; compares the formal Canvas pipeline with UInt8/UInt16 WebGL2/WebGPU textures, folder selection and external OVRs.'},
  'luma-vertex-editing': {
    zh: '以真实文件验证 luma 选择、原始顶点拖动及撤销重做；背景显示 LOD，编辑保留原始拓扑精度。',
    en: 'Selects real features, drags original vertices and undoes edits with luma while background LOD preserves native topology for editing.',
  },
  'luma-benchmark': {
    zh: '加载真实本地大数据，对照共享空间裁剪和显示 LOD 下的 Canvas2D 与 luma WebGL2；保留原生 mapshaper dataset。',
    en: 'Loads real local datasets to compare Canvas2D and luma WebGL2 with shared spatial culling and display LOD while preserving the native mapshaper dataset.',
  },
  'create-layer': {
    zh: '设置名称、几何类型、坐标系和字段，从空图层开始绘制并查看默认属性。',
    en: 'Create an empty layer with a name, geometry type, CRS and fields, then draw features with default attributes.',
  },
  'point-lod': {
    zh: '用固定种子的十万或百万点比较自动 LOD、原始点绘制和过滤后的代表点。',
    en: 'Compares automatic LOD, full-detail drawing and filtered representatives with 100k or 1M seeded points.',
  },
  'getting-started/geojson-viewer': {
    zh: '加载同时包含点、线和面的 GeoJSON，并自动缩放到全部要素范围。',
    en: 'Loads GeoJSON containing points, lines, and polygons, then fits the map to every feature.',
  },
  'getting-started/shapefile-viewer': {
    zh: '加载 ZIP Shapefile，并在读取前指定或自动识别输入坐标系。',
    en: 'Loads a ZIP Shapefile with an explicit or archive-detected input CRS.',
  },
  'getting-started/topojson-viewer': {
    zh: '加载 TopoJSON 文件，并保留共享拓扑以供地图渲染。',
    en: 'Loads a TopoJSON file while preserving shared topology for map rendering.',
  },
  'getting-started/kml-viewer': {
    zh: '加载 KML 文件，面要素 Placemark 会以 WGS84 坐标导入并渲染。',
    en: 'Loads a KML file and imports polygon Placemarks as WGS84 geometry.',
  },

  'getting-started/points': {
    zh: '加载面或线要素，并按几何中心、顶点、端点或插值采样等方式转换为点图层。',
    en: 'Loads polygon or line features and converts them into points using centroids, vertices, endpoints, or interpolated samples.',
  },
  'getting-started/point-style': {
    zh: '加载点要素，并实时修改 circle 图层的形状、颜色、半径和填充样式。',
    en: 'Loads point features and updates the circle layer shape, color, radius, and fill style in real time.',
  },
  'getting-started/lines': {
    zh: '加载两条线路要素，并实时修改 line 图层的颜色、宽度以及实线、虚线、点线、点划线或方向箭头点划线样式。',
    en: 'Loads two route features and updates the line layer color, width, and solid, dashed, dotted, dash-dot, or directional arrow-dot style in real time.',
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
  'attribute-styling': {
    zh: '按属性字段渲染面填充：classifyFeatures 分级烘焙配合 styleSource，或直接使用 fill-color 表达式。',
    en: 'Renders polygon fills from attribute fields: classifyFeatures baking with styleSource opt-in, or fill-color expressions.',
  },
  'attribute-styling-line': {
    zh: '按属性字段渲染线颜色：classifyFeatures 烘焙 stroke 配合 styleSource，或直接使用 line-color 表达式。',
    en: 'Renders line colors from attributes using baked stroke values with styleSource or line-color expressions.',
  },
  'attribute-styling-point': {
    zh: '按属性字段渲染点颜色：classifyFeatures 烘焙 fill 配合 styleSource，或直接使用 circle-color 表达式。',
    en: 'Renders point colors from attributes using baked fill values with styleSource or circle-color expressions.',
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
  'export-formats': {
    zh: '通过单个选择器导出 GeoJSON、Shapefile、TopoJSON、FlatGeobuf、GeoParquet 或 GeoArrow 文件。',
    en: 'Downloads GeoJSON, Shapefile, TopoJSON, FlatGeobuf, GeoParquet, or GeoArrow from one format selector.',
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
    zh: '对同图层所选多边形执行几何并集，并由用户指定合并结果使用哪个要素的属性。',
    en: 'Geometrically unions selected polygons from one layer and lets the user choose the output attribute source.',
  },
  'split-features': {
    zh: '选择同图层线或面后，用点或折线切刀拆分要素，并查看自动更新的结果选择。',
    en: 'Selects same-layer lines or polygons, splits them with point or polyline cutters, and shows the updated result selection.',
  },
  'reshape-ring-part': {
    zh: '选择线或面要素后，使用整形、挖洞、删洞、加部分和删部分工具编辑几何。',
    en: 'Edits selected line or polygon geometry with reshape, hole, and multipart tools.',
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
  measurement: {
    zh: '使用 WGS84 球面距离和面积，交互绘制折线或闭合区域并查看实时测量结果。',
    en: 'Uses WGS84 spherical distance and area while interactively drawing paths or closed regions.',
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
    zh: '默认在线加载中国行政区划 TopoJSON，可切换为 GeoJSON 或上传本地数据后编辑几何。',
    en: 'Loads Chinese administrative TopoJSON online by default, with GeoJSON switching and local uploads for geometry editing.',
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
  'online-map-services': {
    zh: '在构造地图时注册在线底图和叠加服务，并通过共享控件切换或显隐服务。',
    en: 'Registers online basemap and overlay services at construction time and manages them with shared controls.',
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
  'duckdb-spatial-aggregate-join': {
    zh: '用 DuckDB-Wasm 把点位销售统计聚合到行政区域，并比较左连接和内连接结果。',
    en: 'Uses DuckDB-Wasm to aggregate point-sales statistics into administrative areas and compares left and inner results.',
  },
  'duckdb/geometry/centroid': {
    zh: '使用 DuckDB 的 ST_Centroid 计算目标图层每个几何的中心点。',
    en: 'Uses DuckDB ST_Centroid to calculate a center point for each geometry in the target layer.',
  },
  'duckdb/geometry/envelope': {
    zh: '使用 DuckDB 的 ST_Envelope 为目标图层中的每个几何生成外包矩形。',
    en: 'Uses DuckDB ST_Envelope to generate an enclosing rectangle for each target-layer geometry.',
  },
  'duckdb/geometry/convex-hull': {
    zh: '使用 DuckDB 的 ST_ConvexHull 计算目标图层中每个几何的凸包。',
    en: 'Uses DuckDB ST_ConvexHull to calculate the convex hull of each target-layer geometry.',
  },
  'duckdb/geometry/boundary': {
    zh: '使用 DuckDB 的 ST_Boundary 提取目标图层中每个几何的边界。',
    en: 'Uses DuckDB ST_Boundary to extract the boundary of each target-layer geometry.',
  },
  'duckdb/geometry/simplify': {
    zh: '使用 DuckDB 的 ST_Simplify 按给定容差简化目标图层中的几何。',
    en: 'Uses DuckDB ST_Simplify to simplify target-layer geometry with a selected tolerance.',
  },
  'duckdb/geometry/simplify-preserve-topology': {
    zh: '使用 DuckDB 的 ST_SimplifyPreserveTopology 按容差简化几何并保留拓扑。',
    en: 'Uses DuckDB ST_SimplifyPreserveTopology to simplify geometry with a tolerance while preserving topology.',
  },
  'duckdb/geometry/make-valid': {
    zh: '使用 DuckDB 的 ST_MakeValid 修复目标图层中的无效几何。',
    en: 'Uses DuckDB ST_MakeValid to repair invalid geometry in the target layer.',
  },
  'duckdb/attribute/area': {
    zh: '使用 DuckDB 的 ST_Area 计算目标图层中每个几何的面积属性。',
    en: 'Uses DuckDB ST_Area to calculate an area attribute for each target-layer geometry.',
  },
  'duckdb/attribute/length': {
    zh: '使用 DuckDB 的 ST_Length 计算目标图层中每个几何的长度属性。',
    en: 'Uses DuckDB ST_Length to calculate a length attribute for each target-layer geometry.',
  },
  'duckdb/attribute/perimeter': {
    zh: '使用 DuckDB 的 ST_Perimeter 计算目标图层中每个几何的周长属性。',
    en: 'Uses DuckDB ST_Perimeter to calculate a perimeter attribute for each target-layer geometry.',
  },
  'duckdb/attribute/geometry-type': {
    zh: '使用 DuckDB 的 ST_GeometryType 计算目标图层中每个几何的类型属性。',
    en: 'Uses DuckDB ST_GeometryType to calculate a geometry-type attribute for each target-layer geometry.',
  },
  'duckdb/attribute/is-valid': {
    zh: '使用 DuckDB 的 ST_IsValid 检查目标图层中每个几何的有效性。',
    en: 'Uses DuckDB ST_IsValid to check the validity of every target-layer geometry.',
  },
  'duckdb/attribute/is-empty': {
    zh: '使用 DuckDB 的 ST_IsEmpty 检查目标图层中每个几何是否为空。',
    en: 'Uses DuckDB ST_IsEmpty to check whether every target-layer geometry is empty.',
  },
  'duckdb/attribute/is-simple': {
    zh: '使用 DuckDB 的 ST_IsSimple 检查目标图层中每个几何的简单性。',
    en: 'Uses DuckDB ST_IsSimple to check the simplicity of every target-layer geometry.',
  },
  'duckdb/attribute/x': {
    zh: '使用 DuckDB 的 ST_X 提取目标图层中每个点几何的 X 坐标。',
    en: 'Uses DuckDB ST_X to extract the X coordinate of every target-layer point geometry.',
  },
  'duckdb/attribute/y': {
    zh: '使用 DuckDB 的 ST_Y 提取目标图层中每个点几何的 Y 坐标。',
    en: 'Uses DuckDB ST_Y to extract the Y coordinate of every target-layer point geometry.',
  },
  'duckdb/attribute/centroid-x': {
    zh: '使用 DuckDB 的 ST_X 和 ST_Centroid 提取目标图层中每个几何中心的 X 坐标。',
    en: 'Uses DuckDB ST_X and ST_Centroid to extract each target-layer geometry centroid X coordinate.',
  },
  'duckdb/attribute/centroid-y': {
    zh: '使用 DuckDB 的 ST_Y 和 ST_Centroid 提取目标图层中每个几何中心的 Y 坐标。',
    en: 'Uses DuckDB ST_Y and ST_Centroid to extract each target-layer geometry centroid Y coordinate.',
  },
  'duckdb/relation/intersects': {
    zh: '使用 DuckDB 的 ST_Intersects 判断目标图层是否与遮罩图层相交。',
    en: 'Uses DuckDB ST_Intersects to determine whether target features intersect the mask layer.',
  },
  'duckdb/relation/contains': {
    zh: '使用 DuckDB 的 ST_Contains 判断目标图层是否包含遮罩图层要素。',
    en: 'Uses DuckDB ST_Contains to determine whether target features contain mask features.',
  },
  'duckdb/relation/within': {
    zh: '使用 DuckDB 的 ST_Within 判断目标图层是否被遮罩图层包含。',
    en: 'Uses DuckDB ST_Within to determine whether target features are within the mask layer.',
  },
  'duckdb/relation/touches': {
    zh: '使用 DuckDB 的 ST_Touches 判断目标图层是否与遮罩图层相接。',
    en: 'Uses DuckDB ST_Touches to determine whether target features touch the mask layer.',
  },
  'duckdb/relation/disjoint': {
    zh: '使用 DuckDB 的 ST_Disjoint 判断目标图层是否与遮罩图层相离。',
    en: 'Uses DuckDB ST_Disjoint to determine whether target features are disjoint from the mask layer.',
  },
  'duckdb/relation/overlaps': {
    zh: '使用 DuckDB 的 ST_Overlaps 判断目标图层是否与遮罩图层重叠。',
    en: 'Uses DuckDB ST_Overlaps to determine whether target features overlap the mask layer.',
  },
  'duckdb/relation/equals': {
    zh: '使用 DuckDB 的 ST_Equals 判断目标图层是否与遮罩图层相等。',
    en: 'Uses DuckDB ST_Equals to determine whether target features equal mask features.',
  },
  'duckdb/relation/crosses': {
    zh: '使用 DuckDB 的 ST_Crosses 判断目标图层是否穿越遮罩图层。',
    en: 'Uses DuckDB ST_Crosses to determine whether target features cross the mask layer.',
  },
  'duckdb/relation/covers': {
    zh: '使用 DuckDB 的 ST_Covers 判断目标图层是否覆盖遮罩图层要素。',
    en: 'Uses DuckDB ST_Covers to determine whether target features cover mask features.',
  },
  'duckdb/relation/covered-by': {
    zh: '使用 DuckDB 的 ST_CoveredBy 判断目标图层是否被遮罩图层覆盖。',
    en: 'Uses DuckDB ST_CoveredBy to determine whether target features are covered by the mask layer.',
  },
  'duckdb/relation/contains-properly': {
    zh: '使用 DuckDB 的 ST_ContainsProperly 判断目标图层是否严格包含遮罩图层要素。',
    en: 'Uses DuckDB ST_ContainsProperly to determine whether target features properly contain mask features.',
  },
  'duckdb/relation/distance': {
    zh: '使用 DuckDB 的 ST_Distance 计算目标图层与遮罩图层之间的距离属性。',
    en: 'Uses DuckDB ST_Distance to calculate a distance attribute between target and mask layers.',
  },
  'duckdb/relation/distance-within': {
    zh: '使用 DuckDB 的 ST_Distance 按距离范围筛选或标注目标图层与遮罩图层的关系。',
    en: 'Uses DuckDB ST_Distance to filter or annotate target features within a distance of the mask layer.',
  },
  'duckdb/geometry/densify': {
    zh: '使用 DuckDB 按最大分段长度为线或面几何插入顶点。',
    en: 'Uses DuckDB to insert vertices so no segment exceeds a maximum length.',
  },
  'duckdb/geometry/multipart-to-singlepart': {
    zh: '使用 DuckDB 将多部件几何拆分为独立的单部件要素。',
    en: 'Uses DuckDB to split multi-part geometries into independent single-part features.',
  },
  'duckdb/geometry/extract-vertices': {
    zh: '使用 DuckDB 提取目标图层中每个几何的顶点并生成点要素。',
    en: 'Uses DuckDB to extract the vertices of each target-layer geometry into point features.',
  },
  'duckdb/transform/point-to-line': {
    zh: '使用 DuckDB 按可选分组字段把点要素连接成线。',
    en: 'Uses DuckDB to connect point features into lines with an optional grouping field.',
  },
  'duckdb/transform/line-to-polygon': {
    zh: '使用 DuckDB 把闭合线网多边形化为面要素。',
    en: 'Uses DuckDB to polygonize closed linework into polygon features.',
  },
  'duckdb/transform/polygon-to-line': {
    zh: '使用 DuckDB 把面要素的边界转换为线要素。',
    en: 'Uses DuckDB to convert polygon boundaries into line features.',
  },
  'duckdb/proximity/near': {
    zh: '使用 DuckDB 计算每个输入要素到参考图层的最小距离并追加为属性。',
    en: 'Uses DuckDB to append the minimum distance from each input feature to a reference layer.',
  },
  'duckdb/proximity/nearest': {
    zh: '使用 DuckDB 为每个输入要素查找最近的参考要素，并追加其标识与距离。',
    en: 'Uses DuckDB to find the nearest reference feature for each input and append its id and distance.',
  },
  'duckdb/selection/spatial-filter': {
    zh: '使用 DuckDB 按空间谓词筛选与参考图层满足关系的要素。',
    en: 'Uses DuckDB to filter features that satisfy a spatial predicate against a reference layer.',
  },
  'duckdb/join/spatial-join': {
    zh: '使用 DuckDB 按空间谓词把参考图层的属性连接到目标图层。',
    en: 'Uses DuckDB to join attributes from a reference layer using a spatial predicate.',
  },
  'duckdb/join/attribute-join': {
    zh: '使用 DuckDB 按键字段把第二个数据集的属性连接到目标图层。',
    en: 'Uses DuckDB to join attributes from a second dataset using matching key fields.',
  },
  'duckdb/aggregate/dissolve': {
    zh: '使用 DuckDB 按可选分组字段融合目标图层的几何。',
    en: 'Uses DuckDB to dissolve target-layer geometries, optionally grouped by a field.',
  },
  'duckdb/aggregate/collect': {
    zh: '使用 DuckDB 按可选分组字段把几何收集为多部件要素。',
    en: 'Uses DuckDB to collect geometries into multi-part features, optionally grouped by a field.',
  },
  'duckdb/data-management/merge': {
    zh: '使用 DuckDB 把两个数据集的图层合并为一个数据集。',
    en: 'Uses DuckDB to merge the layers of two datasets into one dataset.',
  },
  'duckdb/data-management/append': {
    zh: '使用 DuckDB 把第二个数据集的要素追加到目标图层。',
    en: 'Uses DuckDB to append features from a second dataset to the target layer.',
  },
  'duckdb/data-management/reproject': {
    zh: '使用 DuckDB 把目标图层投影转换到指定的目标坐标系。',
    en: 'Uses DuckDB to reproject the target layer to the chosen target CRS.',
  },
  'duckdb-toolbox': {
    zh: '通过 duckDbToolbox 搜索并按 JSON 参数执行任意 DuckDB 处理工具。',
    en: 'Searches DuckDB processing tools through duckDbToolbox and executes one with JSON parameters.',
  },
  'plugin-runtime': {
    zh: '实时查看 Cordis Context、Fiber、Service 与 Capability 状态，并动态启停交互插件或安装 MapLibre、Arrow、DuckDB。',
    en: 'Inspects native Cordis contexts, fibers, services, and capabilities live while toggling interaction plugins or installing MapLibre, Arrow, and DuckDB.',
  },
  'geotiff-viewer': {
    zh: '按视口读取本地 GeoTIFF/BigTIFF；超过 2GiB 必须具备金字塔，原始文件不复制到浏览器存储。',
    en: 'Reads local GeoTIFF/BigTIFF windows without copying source files into browser storage; overviews are mandatory above 2GiB.',
  },
  'mixed-data-viewer': {
    zh: '在同一地图中同时加载多个矢量文件与多个本地 GeoTIFF；矢量覆盖 emap 支持的全部导入格式，栅格通过目录授权并自动关联 .ovr。',
    en: 'Loads multiple vector files and local GeoTIFFs together; vector input covers every emap import format while raster input uses directory access with automatic .ovr pairing.',
  },
  'geopackage-viewer': {
    zh: '以 SQLite WASM 读取矢量表，直接将 GP Binary/WKB 解码成 TypedArray，并在一个 dataset 中保留多图层。支持 Web Worker。',
    en: 'Reads vector tables with SQLite WASM, decodes GP Binary/WKB directly into typed arrays, and keeps all layers in one dataset, optionally in a Web Worker.',
  },
  'flatgeobuf-viewer': {
    zh: '通过 registerFormat 注册的 FlatGeobuf 插件加载 .fgb 文件，并从文件头读取坐标系。',
    en: 'Loads .fgb files through a FlatGeobuf plugin registered via registerFormat, reading the CRS from the file header.',
  },
} as const satisfies Record<string, LocalizedText>;

type ExampleId = keyof typeof exampleDescriptions;

export const examples: readonly ExampleDefinition[] = [
  seed(
    'getting-started/geojson-viewer',
    'map-data',
    'GeoJSON 查看器',
    'GeoJSON viewer',
    [docsEmap, docsSourceLayer, docsFitBounds],
    'Emap',
    'fixtures/getting-started-geojson-viewer.geojson',
    'The map renders a small mixed GeoJSON scene and fits it in the viewport.',
  ),
  recipe(
    'getting-started/shapefile-viewer',
    'map-data',
    'Shapefile 查看器',
    'Shapefile viewer',
    [docsFormats, docsCrs, docsFileUpload, docsErrorHandling],
    'TopologySource',
    ['shapefile', 'crs', 'formats'],
    [],
  ),
  recipe(
    'getting-started/topojson-viewer',
    'map-data',
    'TopoJSON 查看器',
    'TopoJSON viewer',
    [docsFormats, docsFileUpload],
    'TopologySource',
    ['topojson', 'formats'],
    [],
  ),
  recipe(
    'getting-started/kml-viewer',
    'map-data',
    'KML 查看器',
    'KML viewer',
    [docsFormats, docsFileUpload],
    'TopologySource',
    ['kml', 'formats'],
    ['fixtures/example-kml.kml'],
  ),
  recipe(
    'geotiff-viewer', 'map-data', '本地 GeoTIFF 栅格', 'Local GeoTIFF raster',
    ['/docs/data/geotiff', docsCrs], 'openGeoTIFF',
    ['raster', 'geotiff', 'worker', 'pyramid'], ['fixtures/example-geotiff.tif', 'fixtures/example-geotiff-uint16.tif', 'fixtures/example-geotiff-int16.tif', 'fixtures/example-geotiff-float32.tif', 'fixtures/example-geotiff-float64.tif'],
  ),
  recipe(
    'mixed-data-viewer', 'map-data', '矢量与栅格混合加载', 'Mixed vector and raster loading',
    [docsFormats, '/docs/data/geotiff', '/docs/data/geopackage', docsFileUpload], 'TopologySource',
    ['formats', 'raster', 'geotiff', 'geopackage', 'arrow', 'flatgeobuf', 'multi-layer'], [],
  ),
  recipe(
    'geopackage-viewer', 'map-data', 'GeoPackage 多图层直接转换', 'GeoPackage direct multi-layer import',
    ['/docs/data/geopackage', docsFormats, docsFileUpload], 'importGeoPackage',
    ['geopackage', 'formats', 'worker'], ['fixtures/example-geopackage.gpkg'],
  ),
  recipe(
    'flatgeobuf-viewer',
    'map-data',
    'FlatGeobuf 查看器',
    'FlatGeobuf viewer',
    [docsFormats, docsFileUpload],
    'registerFormat',
    ['formats'],
    ['fixtures/example-flatgeobuf.fgb'],
  ),
  recipe(
    'geoparquet-viewer',
    'map-data',
    'GeoParquet / GeoArrow 查看器',
    'GeoParquet / GeoArrow viewer',
    [docsFormats, docsFileUpload, docsCompatibility],
    'TopologySource.fromBytes',
    ['formats', 'basemap'],
    ['fixtures/example-geoparquet.parquet'],
  ),
  recipe(
    'export-formats',
    'map-data',
    '格式导出',
    'Export formats',
    [docsFormats],
    'TopologySource.export',
    ['formats', 'export'],
    [task6Fixture],
  ),
  recipe(
    'plugin-runtime',
    'map-data',
    'Plugin Runtime / GIS Harness',
    'Plugin Runtime / GIS Harness',
    [docsPlugins, docsEmap],
    'Context',
    ['plugins', 'runtime', 'services', 'capabilities', 'maplibre', 'duckdb', 'arrow'],
    [task6Fixture],
  ),
  recipe(
    'online-map-services',
    'map-data',
    '在线地图服务',
    'Online map services',
    [docsControls],
    'MapLibreServiceManager',
    ['maplibre', 'basemap', 'overlay', 'controls'],
    [task6Fixture],
  ),
  recipe(
    'crs-switch',
    'map-data',
    '坐标系切换',
    'CRS switch',
    [docsCrs],
    'Emap',
    ['crs', 'history', 'basemap'],
    [task7Fixture],
  ),
  recipe(
    'project',
    'map-data',
    '投影转换',
    'Project CRS',
    [docsCrs, docsOperations],
    'Emap',
    ['crs', 'history', 'basemap'],
    [task7Fixture],
  ),
  recipe(
    'rename-layer',
    'map-data',
    '图层重命名',
    'Rename layer',
    [docsSourceLayer, docsOperations],
    'Emap',
    ['layer-ops', 'history'],
    [task6Fixture],
  ),
  recipe(
    'split-layer',
    'map-data',
    '图层拆分',
    'Split layer',
    [docsSourceLayer, docsOperations, docsAttributes],
    'Emap',
    ['expressions', 'layer-ops', 'history'],
    [task6Fixture],
  ),
  recipe(
    'merge-layers',
    'map-data',
    '合并图层',
    'Merge layers',
    [docsSourceLayer, docsOperations],
    'Emap',
    ['layer-ops', 'history'],
    [task6Fixture, task6MergeFixture],
  ),
  seed(
    'getting-started/point-style',
    'style-interaction',
    '点图层样式',
    'Point layer styling',
    [docsSourceLayer, docsStyling, docsFileUpload],
    'Emap.setPaintProperty',
    'fixtures/getting-started-points.geojson',
    'Three point features render as markers whose shape, color, radius, and fill style can be changed.',
  ),
  seed(
    'getting-started/lines',
    'style-interaction',
    '线图层样式',
    'Line layer styling',
    [docsSourceLayer, docsStyling],
    'LinePaint',
    'fixtures/getting-started-lines.geojson',
    'Two route features render with live color, width, and dash styling controls.',
  ),
  seed(
    'getting-started/polygon-fill',
    'style-interaction',
    '面填充',
    'Polygon fill',
    [docsStyling],
    'FillPaint',
    'fixtures/getting-started-polygon-fill.geojson',
    'The polygon layer renders with a translucent fill and visible outline.',
  ),
  recipe('attribute-styling', 'style-interaction', '属性驱动样式', 'Attribute-driven styling', [docsStyling, docsAttributes], 'ClassifyFeaturesOptions', ['styling', 'attributes', 'history'], ['fixtures/attribute-styling.geojson']),
  recipe('attribute-styling-line', 'style-interaction', '线属性驱动样式', 'Attribute-driven line styling', [docsStyling, docsAttributes], 'LinePaint', ['styling', 'attributes', 'line'], ['fixtures/attribute-styling-line.geojson']),
  recipe('attribute-styling-point', 'style-interaction', '点属性驱动样式', 'Attribute-driven point styling', [docsStyling, docsAttributes], 'CirclePaint', ['styling', 'attributes', 'point'], ['fixtures/attribute-styling-point.geojson']),
  recipe('interaction-handlers', 'style-interaction', '交互 Handler', 'Interaction handlers', [docsEvents, docsControls], 'Emap', ['handlers'], [task6Fixture]),
  recipe('measurement', 'style-interaction', '球面测量', 'Spherical measurement', [docsControls, docsCrs], 'MeasureControl', ['measurement', 'controls', 'geodesic'], [task6Fixture]),
  recipe('feature-attributes', 'style-interaction', '要素属性查询', 'Feature attributes', [docsAttributes, docsEvents], 'Emap', ['query', 'highlight', 'basemap'], [task6Fixture]),
  recipe('feature-selection', 'style-interaction', '要素选择', 'Feature selection', [docsSelection], 'Emap', ['selection', 'history'], [task6Fixture]),
  recipe('box-select', 'style-interaction', '拉框选择', 'Box select', [docsSelection, docsControls], 'Emap', ['selection', 'box-select', 'history'], [task6Fixture]),
  recipe('lasso-select', 'style-interaction', '拉框 / 套索选择切换', 'Box and lasso select', [docsSelection, docsControls], 'Emap', ['selection', 'box-select', 'lasso-select', 'history'], [task6Fixture]),
  recipe('create-layer', 'data-editing', '创建图层', 'Create a layer', [docsAttributes, docsEditing, docsCrs], 'Emap', ['drawing', 'attributes', 'history'], []),
  recipe('attribute-editing', 'data-editing', '属性编辑', 'Attribute editing', [docsAttributes, docsEditing, docsUndoRedo], 'Emap', ['attributes', 'history'], [task6Fixture]),
  recipe('undo-redo', 'data-editing', '撤销 / 重做', 'Undo and redo', [docsUndoRedo, docsEditing], 'Emap', ['editing', 'history'], [task6Fixture]),
  recipe('attribute-expressions', 'data-editing', '属性表达式批量更新', 'Attribute expressions', [docsAttributes, docsOperations], 'Emap', ['expressions', 'attributes', 'history'], [task6Fixture]),
  recipe('filter-features', 'data-editing', '要素过滤', 'Filter features', [docsAttributes, docsOperations], 'Emap', ['expressions', 'layer-ops', 'history'], [task6Fixture]),
  recipe('data-engineering', 'data-editing', '数据工程批次', 'Data engineering batch', [docsOperations, docsAttributes], 'Emap', ['expressions', 'layer-ops', 'history'], [task6Fixture]),
  recipe('merge-selected', 'data-editing', '合并选中要素', 'Merge selected features', [docsSelection, docsOperations], 'Emap', ['selection', 'layer-ops', 'history'], [task6Fixture]),
  recipe('split-features', 'data-editing', '拆分选中要素', 'Split selected features', [docsSelection, docsOperations, docsUndoRedo], 'Emap', ['selection', 'split', 'history'], [task7LineFixture, task7Fixture]),
  recipe('reshape-ring-part', 'data-editing', '整形、洞与部分编辑', 'Reshape, hole, and part editing', [docsEditing, docsSelection, docsUndoRedo], 'Emap', ['editing', 'reshape', 'ring', 'part', 'history'], [task7LineFixture, ringPartHoledFixture]),
  recipe('vertex-editing', 'data-editing', '顶点编辑', 'Vertex editing', [docsEditing, docsControls], 'Emap', ['editing', 'vertex', 'basemap'], [task6Fixture]),
  recipe('feature-translate', 'data-editing', '平移选中要素', 'Translate selected feature', [docsEditing, docsSelection], 'Emap', ['selection', 'transform', 'history'], [task6Fixture]),
  recipe('feature-rotate-scale', 'data-editing', '旋转 / 缩放选中要素', 'Rotate and scale selected feature', [docsEditing, docsSelection], 'Emap', ['selection', 'transform', 'history'], [task6Fixture]),
  recipe('draw-snap-clear', 'data-editing', '绘制吸附清理', 'Draw snap and clear', [docsEditing], 'Emap', ['drawing', 'snap', 'history'], [task6Fixture]),
  recipe('draw-snap-edge', 'data-editing', '绘制时吸附顶点 + 边', 'Draw snap to vertex and edge', [docsEditing, docsControls], 'Emap', ['drawing', 'snap', 'history'], [task6Fixture]),
  recipe('china-editing', 'data-editing', '中国行政区划编辑', 'China administrative editing', [docsEditing, docsControls], 'Emap', ['editing', 'basemap'], []),
  recipe('transaction', 'data-editing', 'Transaction + Validation', 'Transaction and validation', [docsEditing, docsErrors], 'Emap', ['transaction', 'validation', 'history'], [task6Fixture]),
  recipe('snapshot', 'data-editing', '多源快照保存 / 恢复', 'Snapshot save and restore', [docsEditing], 'Emap', ['snapshot'], [task6Fixture]),
  seed(
    'getting-started/points',
    'data-analysis',
    '几何转点',
    'Geometry to points',
    [docsSourceLayer, docsOperations, docsFileUpload],
    'PointsOptions',
    task7Fixture,
    'A polygon or line layer is converted into a point layer using the selected extraction mode.',
  ),
  seed(
    'getting-started/polygons',
    'data-analysis',
    '面边界',
    'Polygons',
    [docsStyling],
    'LinePaint',
    'fixtures/getting-started-polygons.geojson',
    'Two polygon boundaries render as linework while preserving topology.',
  ),
  recipe(
    'join',
    'data-analysis',
    '属性表连接',
    'Join table',
    [docsAttributes],
    'Emap',
    ['join', 'history'],
    [task6Fixture, task6CsvFixture],
  ),
  recipe(
    'web-worker',
    'data-analysis',
    'Web Worker 重命令',
    'Web Worker heavy operations',
    [docsWorker, docsPerformance],
    'Emap',
    ['worker', 'history'],
    [task7Fixture],
  ),
  recipe('explode', 'data-analysis', '拆分多部件', 'Explode multipart features', [docsOperations], 'Emap', ['spatial', 'history'], [task7Fixture]),
  recipe('buffer', 'data-analysis', '缓冲区', 'Buffer', [docsOperations], 'Emap', ['spatial', 'history'], [task7Fixture]),
  recipe('simplify', 'data-analysis', '几何简化', 'Simplify geometry', [docsOperations, docsPerformance], 'Emap', ['spatial', 'history'], [task7Fixture]),
  recipe('luma-vertex-editing', 'data-editing', 'luma 选择与顶点编辑', 'luma selection and vertex editing', [docsEditing, docsSelection, docsPerformance], 'TopologySource', ['luma-editor', 'history'], []),
  recipe('luma-raster', 'style-interaction', 'luma 动态栅格', 'luma dynamic raster', [docsPerformance], 'Emap', ['raster', 'luma-raster'], ['inline:local-file-selection']),
  recipe('luma-benchmark', 'style-interaction', 'luma WebGL2 性能对照', 'luma WebGL2 benchmark', [docsPerformance], 'TopologySource', ['luma-benchmark'], ['inline:local-file-selection']),
  recipe('point-lod', 'style-interaction', '密集点 LOD', 'Dense point LOD', [docsPerformance, docsStyling, docsSelection], 'Emap', ['point-lod'], ['inline:seeded-points']),
  recipe('simplify-control', 'data-analysis', '简化控件', 'Simplify control', [docsOperations, docsControls, docsPerformance], 'Emap', ['spatial', 'controls', 'history'], [task7Fixture]),
  recipe('dissolve', 'data-analysis', '融合', 'Dissolve', [docsOperations], 'Emap', ['spatial', 'history'], [task7Fixture]),
  recipe('innerlines', 'data-analysis', '抽取共享边', 'Innerlines', [docsOperations], 'Emap', ['spatial', 'history'], [task7Fixture]),
  recipe('union', 'data-analysis', '面并集', 'Union polygons', [docsOperations], 'Emap', ['spatial', 'overlay', 'history'], [task7Fixture, task7MaskFixture]),
  recipe('clip-erase', 'data-analysis', '裁剪 / 擦除', 'Clip and erase', [docsOperations], 'Emap', ['spatial', 'overlay', 'history'], [task7Fixture, task7MaskFixture]),
  recipe('divide', 'data-analysis', '按面切分线', 'Divide lines by polygons', [docsOperations], 'Emap', ['spatial', 'overlay', 'history'], [task7LineFixture, task7MaskFixture]),
  recipe('snap-layer', 'data-analysis', '批量吸附', 'Snap layer', [docsOperations], 'Emap', ['spatial', 'export', 'history'], [task7LineFixture]),
  recipe('mosaic', 'data-analysis', '平展重叠面', 'Mosaic', [docsOperations], 'Emap', ['spatial', 'history'], [task7Fixture]),
  recipe('check-geometry', 'data-analysis', '几何检查', 'Check geometry', [docsOperations, docsErrors], 'Emap', ['validation', 'history'], [task7Fixture]),
  recipe('rebuild-topology', 'data-analysis', '重建拓扑', 'Rebuild topology', [docsOperations, docsEditing], 'Emap', ['validation', 'editing', 'history'], [task7Fixture]),
  recipe('duckdb-query', 'data-analysis', 'DuckDB 受限 SELECT', 'DuckDB restricted SELECT', [docsDuckDb, docsStatusControl, docsErrorHandling], 'Emap', ['duckdb', 'query', 'basemap'], [task7Fixture], { id: 'duckdb', section: 'query' }),
  recipe('duckdb-geoparquet-query', 'data-analysis', 'DuckDB GeoParquet 查询', 'DuckDB GeoParquet query', [docsDuckDb, docsFormats, docsStatusControl], 'Emap', ['duckdb', 'geoparquet', 'basemap'], ['fixtures/example-geoparquet.parquet'], { id: 'duckdb', section: 'query' }),
  recipe('duckdb-buffer', 'data-analysis', 'DuckDB 缓冲区', 'DuckDB buffer', [docsDuckDb, docsErrorHandling], 'Emap', ['duckdb', 'basemap'], [task7Fixture], { id: 'duckdb', section: 'workflow' }),
  recipe('duckdb-overlay', 'data-analysis', 'DuckDB Overlay', 'DuckDB overlay', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'overlay', 'basemap'], [task7Fixture, task7MaskFixture], { id: 'duckdb', section: 'workflow' }),
  recipe('duckdb-spatial-aggregate-join', 'data-analysis', 'DuckDB 空间聚合连接', 'DuckDB spatial aggregate join', [docsDuckDb, docsOperations], 'spatialSummaryJoin', ['duckdb', 'spatial', 'join', 'aggregate', 'basemap'], [task7MaskFixture, duckDbSpatialAggregatePointsFixture], { id: 'duckdb', section: 'workflow' }),
  recipe('duckdb/geometry/centroid', 'data-analysis', 'DuckDB 几何中心', 'DuckDB centroid', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'basemap', 'centroid'], [task7Fixture], { id: 'duckdb', section: 'geometry' }),
  recipe('duckdb/geometry/envelope', 'data-analysis', 'DuckDB 外包矩形', 'DuckDB envelope', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'basemap', 'envelope'], [task7Fixture], { id: 'duckdb', section: 'geometry' }),
  recipe('duckdb/geometry/convex-hull', 'data-analysis', 'DuckDB 凸包', 'DuckDB convex hull', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'basemap', 'convex-hull'], [task7Fixture], { id: 'duckdb', section: 'geometry' }),
  recipe('duckdb/geometry/boundary', 'data-analysis', 'DuckDB 边界', 'DuckDB boundary', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'basemap', 'boundary'], [task7Fixture], { id: 'duckdb', section: 'geometry' }),
  recipe('duckdb/geometry/simplify', 'data-analysis', 'DuckDB 几何简化', 'DuckDB simplify', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'basemap', 'simplify'], [task7Fixture], { id: 'duckdb', section: 'geometry' }),
  recipe('duckdb/geometry/simplify-preserve-topology', 'data-analysis', 'DuckDB 保拓扑简化', 'DuckDB simplify preserve topology', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'basemap', 'simplify-preserve-topology'], [task7Fixture], { id: 'duckdb', section: 'geometry' }),
  recipe('duckdb/geometry/make-valid', 'data-analysis', 'DuckDB 修复无效几何', 'DuckDB make valid', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'basemap', 'make-valid'], [task7Fixture], { id: 'duckdb', section: 'geometry' }),
  recipe('duckdb/attribute/area', 'data-analysis', 'DuckDB 面积属性', 'DuckDB area attribute', [docsDuckDb, docsAttributes], 'Emap', ['duckdb', 'attribute', 'area'], [task7Fixture], { id: 'duckdb', section: 'attribute' }),
  recipe('duckdb/attribute/length', 'data-analysis', 'DuckDB 长度属性', 'DuckDB length attribute', [docsDuckDb, docsAttributes], 'Emap', ['duckdb', 'attribute', 'length'], [task7Fixture], { id: 'duckdb', section: 'attribute' }),
  recipe('duckdb/attribute/perimeter', 'data-analysis', 'DuckDB 周长属性', 'DuckDB perimeter attribute', [docsDuckDb, docsAttributes], 'Emap', ['duckdb', 'attribute', 'perimeter'], [task7Fixture], { id: 'duckdb', section: 'attribute' }),
  recipe('duckdb/attribute/geometry-type', 'data-analysis', 'DuckDB 几何类型属性', 'DuckDB geometry type attribute', [docsDuckDb, docsAttributes], 'Emap', ['duckdb', 'attribute', 'geometry-type'], [task7Fixture], { id: 'duckdb', section: 'attribute' }),
  recipe('duckdb/attribute/is-valid', 'data-analysis', 'DuckDB 有效性属性', 'DuckDB validity attribute', [docsDuckDb, docsAttributes], 'Emap', ['duckdb', 'attribute', 'is-valid'], [task7Fixture], { id: 'duckdb', section: 'attribute' }),
  recipe('duckdb/attribute/is-empty', 'data-analysis', 'DuckDB 空几何属性', 'DuckDB empty geometry attribute', [docsDuckDb, docsAttributes], 'Emap', ['duckdb', 'attribute', 'is-empty'], [task7Fixture], { id: 'duckdb', section: 'attribute' }),
  recipe('duckdb/attribute/is-simple', 'data-analysis', 'DuckDB 简单几何属性', 'DuckDB simple geometry attribute', [docsDuckDb, docsAttributes], 'Emap', ['duckdb', 'attribute', 'is-simple'], [task7Fixture], { id: 'duckdb', section: 'attribute' }),
  recipe('duckdb/attribute/x', 'data-analysis', 'DuckDB X 坐标属性', 'DuckDB X coordinate attribute', [docsDuckDb, docsAttributes], 'Emap', ['duckdb', 'attribute', 'x'], ['fixtures/getting-started-points.geojson'], { id: 'duckdb', section: 'attribute' }),
  recipe('duckdb/attribute/y', 'data-analysis', 'DuckDB Y 坐标属性', 'DuckDB Y coordinate attribute', [docsDuckDb, docsAttributes], 'Emap', ['duckdb', 'attribute', 'y'], ['fixtures/getting-started-points.geojson'], { id: 'duckdb', section: 'attribute' }),
  recipe('duckdb/attribute/centroid-x', 'data-analysis', 'DuckDB 中心 X 属性', 'DuckDB centroid X attribute', [docsDuckDb, docsAttributes], 'Emap', ['duckdb', 'attribute', 'centroid-x'], [task7Fixture], { id: 'duckdb', section: 'attribute' }),
  recipe('duckdb/attribute/centroid-y', 'data-analysis', 'DuckDB 中心 Y 属性', 'DuckDB centroid Y attribute', [docsDuckDb, docsAttributes], 'Emap', ['duckdb', 'attribute', 'centroid-y'], [task7Fixture], { id: 'duckdb', section: 'attribute' }),
  recipe('duckdb/relation/intersects', 'data-analysis', 'DuckDB 相交关系', 'DuckDB intersects relation', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'relation', 'intersects'], [task7Fixture], { id: 'duckdb', section: 'relation' }),
  recipe('duckdb/relation/contains', 'data-analysis', 'DuckDB 包含关系', 'DuckDB contains relation', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'relation', 'contains'], [task7Fixture], { id: 'duckdb', section: 'relation' }),
  recipe('duckdb/relation/within', 'data-analysis', 'DuckDB 被包含关系', 'DuckDB within relation', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'relation', 'within'], [task7Fixture], { id: 'duckdb', section: 'relation' }),
  recipe('duckdb/relation/touches', 'data-analysis', 'DuckDB 相接关系', 'DuckDB touches relation', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'relation', 'touches'], [task7Fixture], { id: 'duckdb', section: 'relation' }),
  recipe('duckdb/relation/disjoint', 'data-analysis', 'DuckDB 相离关系', 'DuckDB disjoint relation', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'relation', 'disjoint'], [task7Fixture], { id: 'duckdb', section: 'relation' }),
  recipe('duckdb/relation/overlaps', 'data-analysis', 'DuckDB 重叠关系', 'DuckDB overlaps relation', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'relation', 'overlaps'], [task7Fixture], { id: 'duckdb', section: 'relation' }),
  recipe('duckdb/relation/equals', 'data-analysis', 'DuckDB 相等关系', 'DuckDB equals relation', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'relation', 'equals'], [task7Fixture], { id: 'duckdb', section: 'relation' }),
  recipe('duckdb/relation/crosses', 'data-analysis', 'DuckDB 穿越关系', 'DuckDB crosses relation', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'relation', 'crosses'], [task7Fixture], { id: 'duckdb', section: 'relation' }),
  recipe('duckdb/relation/covers', 'data-analysis', 'DuckDB 覆盖关系', 'DuckDB covers relation', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'relation', 'covers'], [task7Fixture], { id: 'duckdb', section: 'relation' }),
  recipe('duckdb/relation/covered-by', 'data-analysis', 'DuckDB 被覆盖关系', 'DuckDB covered by relation', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'relation', 'covered-by'], [task7Fixture], { id: 'duckdb', section: 'relation' }),
  recipe('duckdb/relation/contains-properly', 'data-analysis', 'DuckDB 严格包含关系', 'DuckDB contains properly relation', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'relation', 'contains-properly'], [task7Fixture], { id: 'duckdb', section: 'relation' }),
  recipe('duckdb/relation/distance', 'data-analysis', 'DuckDB 距离属性', 'DuckDB distance attribute', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'relation', 'distance'], ['fixtures/duckdb-distance-target.geojson', 'fixtures/duckdb-distance-mask.geojson'], { id: 'duckdb', section: 'relation' }),
  recipe('duckdb/relation/distance-within', 'data-analysis', 'DuckDB 距离范围关系', 'DuckDB distance-within relation', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'relation', 'distance'], ['fixtures/duckdb-distance-target.geojson', 'fixtures/duckdb-distance-mask.geojson'], { id: 'duckdb', section: 'relation' }),
  recipe('duckdb/geometry/densify', 'data-analysis', 'DuckDB 顶点加密', 'DuckDB densify', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'basemap', 'densify'], [task7LineFixture], { id: 'duckdb', section: 'geometry' }),
  recipe('duckdb/geometry/multipart-to-singlepart', 'data-analysis', 'DuckDB 多部件转单部件', 'DuckDB multipart to singlepart', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'basemap'], [task7LineFixture], { id: 'duckdb', section: 'geometry' }),
  recipe('duckdb/geometry/extract-vertices', 'data-analysis', 'DuckDB 顶点提取', 'DuckDB extract vertices', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'basemap'], [task7Fixture], { id: 'duckdb', section: 'geometry' }),
  recipe('duckdb/transform/point-to-line', 'data-analysis', 'DuckDB 点转线', 'DuckDB point to line', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'basemap'], [duckDbSpatialAggregatePointsFixture], { id: 'duckdb', section: 'geometry' }),
  recipe('duckdb/transform/line-to-polygon', 'data-analysis', 'DuckDB 线转面', 'DuckDB line to polygon', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'basemap'], [task7LineFixture], { id: 'duckdb', section: 'geometry' }),
  recipe('duckdb/transform/polygon-to-line', 'data-analysis', 'DuckDB 面转线', 'DuckDB polygon to line', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'basemap'], [task7Fixture], { id: 'duckdb', section: 'geometry' }),
  recipe('duckdb/proximity/near', 'data-analysis', 'DuckDB 邻近距离', 'DuckDB near', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'proximity'], ['fixtures/duckdb-distance-target.geojson', 'fixtures/duckdb-distance-mask.geojson'], { id: 'duckdb', section: 'relation' }),
  recipe('duckdb/proximity/nearest', 'data-analysis', 'DuckDB 最近要素', 'DuckDB nearest', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'proximity'], ['fixtures/duckdb-distance-target.geojson', 'fixtures/duckdb-distance-mask.geojson'], { id: 'duckdb', section: 'relation' }),
  recipe('duckdb/selection/spatial-filter', 'data-analysis', 'DuckDB 空间过滤', 'DuckDB spatial filter', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'relation', 'filter'], [task7Fixture, 'fixtures/task-7-mask-east.geojson'], { id: 'duckdb', section: 'relation' }),
  recipe('duckdb/join/spatial-join', 'data-analysis', 'DuckDB 空间连接', 'DuckDB spatial join', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'join'], [task7Fixture, task7MaskFixture], { id: 'duckdb', section: 'workflow' }),
  recipe('duckdb/join/attribute-join', 'data-analysis', 'DuckDB 属性连接', 'DuckDB attribute join', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'join', 'attribute'], [task6Fixture, 'fixtures/duckdb-attribute-join-right.geojson'], { id: 'duckdb', section: 'workflow' }),
  recipe('duckdb/aggregate/dissolve', 'data-analysis', 'DuckDB 融合', 'DuckDB dissolve', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'aggregate'], [task7Fixture], { id: 'duckdb', section: 'geometry' }),
  recipe('duckdb/aggregate/collect', 'data-analysis', 'DuckDB 几何收集', 'DuckDB collect', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'spatial', 'aggregate'], [task7Fixture], { id: 'duckdb', section: 'geometry' }),
  recipe('duckdb/data-management/merge', 'data-analysis', 'DuckDB 图层合并', 'DuckDB merge', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'merge'], [task6Fixture, task6MergeFixture], { id: 'duckdb', section: 'workflow' }),
  recipe('duckdb/data-management/append', 'data-analysis', 'DuckDB 要素追加', 'DuckDB append', [docsDuckDb, docsOperations], 'Emap', ['duckdb', 'append'], [task6Fixture, task6MergeFixture], { id: 'duckdb', section: 'workflow' }),
  recipe('duckdb/data-management/reproject', 'data-analysis', 'DuckDB 投影转换', 'DuckDB reproject', [docsDuckDb, docsCrs], 'Emap', ['duckdb', 'crs'], [task7Fixture], { id: 'duckdb', section: 'workflow' }),
  recipe('duckdb-toolbox', 'data-analysis', 'DuckDB 工具箱', 'DuckDB toolbox', [docsDuckDb, docsOperations], 'duckDbToolbox', ['duckdb', 'toolbox'], [task7Fixture, task7MaskFixture], { id: 'duckdb', section: 'workflow' }),
];

export const exampleIds = examples.map(({ id }) => id);

function seed(
  id: ExampleId,
  category: string,
  zh: string,
  en: string,
  docs: readonly string[],
  api: string,
  fixture: string,
  success: string,
): ExampleDefinition {
  return {
    id,
    category,
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
  topic?: ExampleTopicPlacement,
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
    ...(topic === undefined ? {} : { topic }),
  };
}
