# 示例模块重组设计

日期：2026-08-11

## 背景

示例目录的界面结构、搜索、卡片、双语切换和响应式布局已经调整完成。当前仍使用“快速开始、数据、图层、交互、编辑、空间分析、验证、坐标系、平台、DuckDB”十个平级分类，分类过碎，不能清楚表达地图引擎的主要能力模块。

本设计只重新组织现有示例的模块归属和展示顺序。它取代 `2026-08-10-example-catalog-redesign-design.md` 中的分类模型，但不改变该文档已经确定并实现的目录界面、搜索、可访问性和响应式设计。

## 目标

- 将现有 54 个示例归入四个一级模块：地图与数据、样式与交互、数据编辑、数据分析。
- 每个示例只有一个主模块，不重复展示。
- 模块内部以数组顺序体现“单一能力到组合场景”的渐进关系，不显示初级、中级或高级标签。
- 继续由现有目录界面从示例元数据生成分类导航和卡片。
- 保持所有示例 ID、路由、内容、标题、描述、API、标签、夹具和功能不变。

## 非目标

- 不修改目录 DOM、CSS、搜索、卡片、双语切换或响应式行为。
- 不新增二级分类、筛选维度或显式 `order` 字段。
- 不新增、删除或修改示例页面。
- 不在本次工作中补齐缺失示例。
- 不修改现有示例的标题和描述，包括 `getting-started/polygons` 的现有展示文案。

## 分类原则

分类以示例的主要学习目标为准，不以源码目录或底层 API 所属包为准。

### 地图与数据

说明数据如何进入、组织、转换坐标并离开地图，包括格式加载、数据连接、图层组织、导出、坐标系和耗时任务的执行方式。

### 样式与交互

说明数据如何呈现，以及用户如何查询和选择。选择只改变交互状态，不直接修改数据。

### 数据编辑

说明如何直接修改现有属性、要素和几何，并管理撤销重做、事务和快照等编辑状态。

### 数据分析

说明如何从现有数据计算派生几何、拓扑或查询结果，包括 DuckDB 空间计算。

边界决策如下：

- `merge-layers` 是图层组织，归入地图与数据。
- `merge-selected` 修改选中要素，归入数据编辑。
- `feature-attributes` 的主要目标是点击查询，归入样式与交互。
- `getting-started/points` 和 `getting-started/polygons` 执行几何转换，归入数据分析。
- `simplify-control` 虽然包含控件，核心能力仍是几何简化，归入数据分析。
- `project` 说明数据坐标表示的转换，归入地图与数据。

## 模块与示例顺序

内部分类键依次为 `map-data`、`style-interaction`、`data-editing`、`data-analysis`。目录按照示例数组中分类首次出现的顺序生成模块导航，因此示例定义必须按以下四个连续区段排列。

### 地图与数据（12）

1. `getting-started/geojson-viewer` — GeoJSON 查看器
2. `getting-started/shapefile-viewer` — Shapefile 查看器
3. `geoparquet-viewer` — GeoParquet / GeoArrow 查看器
4. `join` — 属性表连接
5. `rename-layer` — 图层重命名
6. `split-layer` — 图层拆分
7. `merge-layers` — 合并图层
8. `export-geoparquet` — 导出 GeoParquet / GeoArrow
9. `export-roundtrip` — 导出往返
10. `crs-switch` — 坐标系切换
11. `project` — 投影转换
12. `web-worker` — Web Worker 重命令

顺序先覆盖常见格式加载，再进入数据连接和图层组织，随后展示导出与坐标系，最后展示耗时任务的执行方式。

### 样式与交互（8）

1. `getting-started/point-style` — 点图层样式
2. `getting-started/lines` — 线图层样式
3. `getting-started/polygon-fill` — 面填充
4. `interaction-handlers` — 交互 Handler
5. `feature-attributes` — 要素属性查询
6. `feature-selection` — 要素选择
7. `box-select` — 拉框选择
8. `lasso-select` — 拉框 / 套索选择切换

顺序先覆盖点、线、面三种基本绘制，再从通用 Handler 进入查询、单选和区域选择。

### 数据编辑（14）

1. `attribute-editing` — 属性编辑
2. `undo-redo` — 撤销 / 重做
3. `attribute-expressions` — 属性表达式批量更新
4. `filter-features` — 要素过滤
5. `data-engineering` — 数据工程批次
6. `merge-selected` — 合并选中要素
7. `vertex-editing` — 顶点编辑
8. `feature-translate` — 平移选中要素
9. `feature-rotate-scale` — 旋转 / 缩放选中要素
10. `draw-snap-clear` — 绘制吸附清理
11. `draw-snap-edge` — 绘制时吸附顶点和边
12. `china-editing` — 中国行政区划编辑
13. `transaction` — Transaction + Validation
14. `snapshot` — 多源快照保存 / 恢复

顺序从属性修改和历史管理开始，再进入批量数据修改、几何编辑和吸附绘制，最后展示完整编辑事务与状态持久化。

### 数据分析（20）

1. `getting-started/points` — 几何转点
2. `getting-started/polygons` — Polygons；页面实际调用 `map.ops.polygonsLayer()`
3. `explode` — 拆分多部件
4. `buffer` — 缓冲区
5. `simplify` — 几何简化
6. `simplify-control` — 简化控件
7. `dissolve` — 融合
8. `innerlines` — 抽取共享边
9. `union` — 面并集
10. `clip-erase` — 裁剪 / 擦除
11. `divide` — 按面切分线
12. `snap-layer` — 批量吸附
13. `mosaic` — 平展重叠面
14. `check-geometry` — 几何检查
15. `rebuild-topology` — 重建拓扑
16. `duckdb-query` — DuckDB 受限 SELECT
17. `duckdb-geoparquet-query` — DuckDB GeoParquet 查询
18. `duckdb-buffer` — DuckDB 缓冲区
19. `duckdb-overlay` — DuckDB Overlay
20. `duckdb-spatial-ops` — DuckDB 空间函数

顺序先展示单图层几何转换和常用空间运算，再进入拓扑与质量处理，最后集中展示 DuckDB 查询和空间计算。

## 元数据设计

采用现有数组顺序作为唯一展示顺序，不增加另一份 ID 清单或显式排序字段。

`docs-meta/examples.ts` 中的示例定义改为一个按上述顺序排列的数组。现有 `seed()` 和 `recipe()` 构造函数继续复用；`seed()` 增加分类参数，避免继续把入门示例固定写入 `getting-started`。原有 `getting-started` 标签可以保留用于搜索，它不再作为导航分类。

`packages/examples/src/catalog.ts` 只把旧十类的中英文标签映射替换为：

| 分类键 | 中文 | English |
| --- | --- | --- |
| `map-data` | 地图与数据 | Map & Data |
| `style-interaction` | 样式与交互 | Styling & Interaction |
| `data-editing` | 数据编辑 | Data Editing |
| `data-analysis` | 数据分析 | Data Analysis |

目录的分类收集、筛选、搜索、卡片渲染和状态更新逻辑保持不变。

## 数据流

1. `docs-meta/examples.ts` 按最终顺序导出 54 个示例。
2. 目录渲染器按数组中分类首次出现的顺序收集四个模块及数量。
3. 用户选择模块时，现有筛选逻辑按 `example.category` 过滤。
4. 当前模块内的卡片沿用原数组顺序，因此不需要额外排序。
5. 搜索继续读取标题、描述、ID、标签和 API，不受模块重组影响。

## 验证

更新 `test/docs/example-catalog.test.ts`，验证：

- 54 个 ID 的整体顺序与本设计完全一致。
- 分类键只包含四个允许值，顺序固定。
- 四个模块的数量依次为 12、8、14、20，总数为 54。
- 目录渲染“全部”加四个模块，共五个分类按钮和四个分类区段。
- 模块筛选结果数量及标题正确。
- 搜索与模块筛选组合仍然工作。
- 切换语言时仍保留已选模块和查询字符串。
- 现有公开路由、夹具关联、双语内容和示例页面检查继续通过。

本次没有新的运行时错误路径。未知分类仍沿用目录现有的标签回退行为，不增加额外错误处理。

## 成功标准

- 目录只显示四个模块，顺序为地图与数据、样式与交互、数据编辑、数据分析。
- 每个现有示例恰好出现一次。
- 模块数量为 12、8、14、20，合计 54。
- 模块内顺序与本设计一致。
- 目录界面结构和所有示例内容保持不变。
- 相关测试、类型检查和示例构建通过。

