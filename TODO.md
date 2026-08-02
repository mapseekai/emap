# TODO — 统一地图 CRS 设计审查

> 记录日期：2026-07-31  
> 设计不变量：所有进入地图的数据必须在可观察/可处理前转换到地图当前 CRS；后续渲染、编辑、Mapshaper 和 DuckDB 处理均以该归一化后的 live dataset 为唯一数据源。地图 CRS 变化必须同步重投影全部已注册数据源。

## CRS 设计阻断项

- [x] **P0：关闭 `map.ops.projectLayer()` 对地图 CRS 不变量的绕过**
  - 当前可将单个已注册 source，甚至单个 target layer，投影到任意 CRS；地图 CRS 和其他 source 不变。
  - target-scoped 投影还会保留原 dataset 级 CRS 元数据，造成同一 dataset 内混合坐标系。
  - 位置：[`src/map/ops/project.ts`](src/map/ops/project.ts)、[`src/map/mapshaper-ops.ts`](src/map/mapshaper-ops.ts)、[`src/map/map.test.ts`](src/map/map.test.ts)。
  - 验收：受管 source 的整源投影统一走 `map.reproject()`；地图内拒绝 target-scoped CRS 投影。若保留单 dataset 投影能力，应作为 detached dataset API。
  - 测试：覆盖整源和 target layer 均不能脱离地图 CRS。

- [x] **P0：让 `setArrowTable()` 经过地图拥有的 CRS 归一化提交路径**
  - 当前直接执行 `source.setDataset(fromArrowTable(...))`，可把不同 CRS 的 Arrow 数据写入已注册 source。
  - 新增 mutable guard 只验证写权限，没有验证 owning map 或目标 CRS。
  - 位置：[`src/arrow/index.ts`](src/arrow/index.ts)、[`src/arrow/index.test.ts`](src/arrow/index.test.ts)。
  - 验收：提供 map-aware 异步 replacement API，或在受管 source 上拒绝该调用；提交前必须执行 normalizer 和最终 owner/CRS assertion。
  - 测试：EPSG:3857 地图中的 source 写入 EPSG:4326 Arrow table 后，live dataset 必须已是 EPSG:3857，或调用被明确拒绝。

- [x] **P1：封闭预加载自定义 source 缺少 `getCRS()` 的注册漏洞**
  - `TopologySource.getCRS` 当前是可选方法，`isMutableTopologySource()` 又不要求它存在；预加载 custom mutable source 会跳过 CRS 采用/投影逻辑后直接注册。
  - 位置：[`src/source/source.ts`](src/source/source.ts)、[`src/map/map.ts`](src/map/map.ts)。
  - 验收：注册时直接从 dataset 解析 CRS，或把 `getCRS()` 变为 mutable source 的必需契约；任何预加载 dataset 都不得跳过归一化。
  - 测试：custom mutable source 有 dataset、无 `getCRS()`、且 CRS 与地图不同时必须投影或拒绝。

- [x] **P1：记录独立地图必须使用独立 `TopologySource` 的产品约定**
  - `_datasetNormalizer` 和 `_managedCrs` 都是单槽回调，但同一 source 实例可用两个 ID 注册到同一地图，也可注册到两张地图。
  - 后一次注册会覆盖前一个 owner；移除其中一个注册又会清除仍在使用的回调。跨地图注册还可能静默改变第一张地图使用的数据。
  - 位置：[`src/source/topology-source.ts`](src/source/topology-source.ts)、[`src/map/map.ts`](src/map/map.ts)。
  - 产品结论：当前仅支持单 Canvas；多地图及新标签页使用独立数据和独立 source 实例。
  - 验收：仅在引擎 API JSDoc 记录实例隔离规则；不得加入 runtime owner WeakMap、claim、跨地图排斥或其他行为变更。
  - 测试：确认公开引擎文档包含约定，且运行时代码不存在 owner claim/跨地图排斥路径。

- [x] **P1：把首个 source 的 CRS 采用纳入最终 dataset commit**
  - 延迟加载的第一个 source 会先修改 map CRS、设置 `_crsEstablished` 并触发 `crschange`，之后 source 才执行 stale/assert/commit。
  - 加载被取代、source 被移除或监听器抛错时，会留下没有成功数据源支撑的 phantom CRS。
  - 位置：[`src/map/map.ts`](src/map/map.ts)、[`src/source/topology-source.ts`](src/source/topology-source.ts)。
  - 验收：normalizer 只准备 `{dataset, intendedMapCrs}`；source dataset、map CRS 和 `_crsEstablished` 在同一最终提交阶段更新，失败时不留下部分状态；事件在成功提交后发布。
  - 测试：首载提交前被 supersede、remove、map CRS 改变，以及 `crschange` listener 抛错。

- [x] **P1：让 dataset replacement 和 map reprojection 对事件监听器异常保持原子性**
  - 普通 op 先 `setDataset()` 再写 history；`data`/map listener 抛错时 dataset 已变但没有 undo 记录。
  - `ReprojectMapCommand` 先替换全部 dataset 并触发 `crschange`/`move`，`map.reproject()` 随后才把 command 压入 history。
  - `EventDispatcher.fire()` 当前传播第一个 listener 异常。
  - 位置：[`src/map/ops/_runner.ts`](src/map/ops/_runner.ts)、[`src/edit/commands/reproject-map.ts`](src/edit/commands/reproject-map.ts)、[`src/map/map.ts`](src/map/map.ts)、[`src/core/events.ts`](src/core/events.ts)。
  - 验收：提交状态和 history 先完整落定，再发布通知；监听器异常不能留下无 history 的部分提交。明确采用异常隔离或可靠 rollback 策略。
  - 测试：source `data`、map `data`、`crschange`、`move`、`historychange` listener 分别抛错后的 dataset/CRS/history 一致性。

- [x] **P1：统一保留所有 DuckDB dataset 输出的主 CRS 元数据**
  - geometry、attribute、relation、overlay 输出目前只复制 `info.crs_string`。
  - 主数据若只有 `info.prj`、`info.wkt1` 或 `info.crs`，输出坐标仍在主 CRS 中，但元数据会丢失；再次加入地图时可能被当作 EPSG:4326 并二次投影。
  - 位置：[`src/duckdb/duckdb-geometry-op.ts`](src/duckdb/duckdb-geometry-op.ts)、[`src/duckdb/duckdb-attribute-op.ts`](src/duckdb/duckdb-attribute-op.ts)、[`src/duckdb/duckdb-relation-op.ts`](src/duckdb/duckdb-relation-op.ts)、[`src/duckdb/duckdb-overlay-op.ts`](src/duckdb/duckdb-overlay-op.ts)、[`src/geo/crs-resolver.ts`](src/geo/crs-resolver.ts)。
  - 验收：所有 DuckDB dataset 输出通过同一 helper 解析并写入规范化主 CRS；不得只检查 `crs_string`。
  - 测试：分别覆盖仅有 `prj`、`wkt1`、legacy `crs` 和规范 `crs_string` 的输入。

- [x] **P1：`map.remove()` 必须释放 source 的 CRS 管理 hook**
  - `removeSource()` 会清理 normalizer/managed CRS，但完整 `map.remove()` 只移除 data listener 并清空 source map。
  - 外部继续持有 source 时，后续 `setData()` 仍会调用已销毁地图，`source.reproject()` 仍认为自己受管。
  - 位置：[`src/map/map.ts`](src/map/map.ts)。
  - 验收：销毁时对每个仍注册 source 清除 owner、normalizer 和 managed CRS，再清空 registry。
  - 测试：`map.remove()` 后 retained source 能独立 `setData()` 和 `reproject()`。

## 需要先确定的 CRS 产品约定

- [x] **决定未知 CRS 数据的处理策略**
  - GeoJSON/TopoJSON/JSON/KML 缺少元数据时按 EPSG:4326 有规范依据。
  - Shapefile 缺少 `.prj` 时当前不写 CRS 元数据，但 `resolveDatasetCRS()` 仍统一回退到 EPSG:4326，可能把任意投影坐标当经纬度。
  - 可选方案：非 WGS84 规范格式缺失 CRS 时拒绝；要求调用者提供 `sourceCrs`；或明确接受全局 EPSG:4326 fallback。
  - 位置：[`src/source/topology-source.ts`](src/source/topology-source.ts)、[`src/geo/crs-resolver.ts`](src/geo/crs-resolver.ts)。
  - 验收：文档、导入 API、地图注册、Arrow/DuckDB 和测试 fixture 使用同一约定。

- [x] **修复 DuckDB overlay 集成 fixture/行为约定**
  - 当前 `pnpm run test:duckdb` 的 overlay suite 有 2/4 失败：无 CRS 的 mask 被默认当作 EPSG:4326，对齐到 EPSG:26910 后不再与主数据相交。
  - 位置：[`src/duckdb/duckdb-overlay.integration.test.ts`](src/duckdb/duckdb-overlay.integration.test.ts)。
  - 完成：mask fixture 显式携带真实 CRS；overlay SQL 将结果几何序列化为标准 WKB；完整 `test:duckdb` 通过。

## 数据所有权与 API 边界

- [ ] **修复“深只读”类型边界仍可修改 live dataset 的问题**
  - `Feature.geometry` 是 live mutable shape 引用，调用方可直接 `pop/push`，绕过 history、editVersion 和缓存失效。
  - `Readonly<Record<string, unknown>>` 只读到第一层；属性值经 `Array.isArray()` 缩窄后仍可修改嵌套数组。
  - 当前 `.test-d.ts` 只覆盖顶层数组/字段修改，没有覆盖嵌套值和 `Feature.geometry`。
  - 位置：[`src/map/feature-accessor.ts`](src/map/feature-accessor.ts)、[`src/types/mapshaper-types.ts`](src/types/mapshaper-types.ts)、[`src/source/topology-source-readonly.test-d.ts`](src/source/topology-source-readonly.test-d.ts)。
  - 验收：公开类型使用真正递归只读结构，或返回安全副本；补充编译期回归测试。

- [x] **明确公开 `DatasetReplaceCommand` 的信任边界**
  - 该 command 接收任意 `before/after` dataset 并直接调用 internal `setDataset()`；包入口又公开导出它。
  - 如果统一 CRS 是无条件不变量，需要 map owner/CRS 校验；如果它是可信低层 escape hatch，需要在 API 文档中明确责任。
  - 位置：[`src/edit/commands/dataset-replace.ts`](src/edit/commands/dataset-replace.ts)、[`src/index.ts`](src/index.ts)。

## 非 CRS 的已确认问题

- [x] **明确 worker pool 的单地图所有权**
  - 每个 `Emap` 独占自己的 pool；启用 worker 时，调用方提供的 pool 也由该地图接管并在 `remove()` 时销毁，不支持跨地图共享。
  - `useWorker: false` 时忽略 `workerPool`，不会接管或销毁调用方资源。
  - 位置：[`src/map/types.ts`](src/map/types.ts)、[`src/map/map.ts`](src/map/map.ts)。
  - 验收：关闭地图会取消并销毁其 pool；禁用 worker 的地图不会影响传入 pool；文档不再承诺跨地图共享。

- [x] **修复 `LayerRegistry.resolve()` 的全局匹配优先级**
  - 文档声称先全局匹配 canonical ID，再 name，再 id；实现却逐 layer 依次尝试三种匹配，较早 layer 的低优先级 alias 可抢先命中。
  - 位置：[`src/map/layer-registry.ts`](src/map/layer-registry.ts)。
  - 验收：分三轮全局搜索；增加 canonical/name/id 冲突测试。

- [x] **消除 source/layer/feature 复合字符串键碰撞**
  - renderer/cache 使用 `source:layer`，feature event 使用 `source|layer|id`；ID 包含分隔符时可能碰撞，cache prefix 清理也会误删/漏删。
  - 位置：[`src/map/layer-renderer.ts`](src/map/layer-renderer.ts)、[`src/map/map.ts`](src/map/map.ts)、[`src/core/feature-event-dispatcher.ts`](src/core/feature-event-dispatcher.ts)。
  - 验收：改用嵌套 Map、结构化 tuple 或 JSON 编码；覆盖含 `:`、`|` 的合法 ID。

- [x] **调整 Canvas 点批处理的 flush/cull 顺序**
  - 达到 100 个可见点后，flush 检查发生在当前点屏幕裁剪之前；后续大量屏外点会反复触发空 `fill/stroke`，且 count 不前进。
  - 位置：[`src/renderer/canvas-painter.ts`](src/renderer/canvas-painter.ts)、[`src/renderer/canvas-painter.batch.test.ts`](src/renderer/canvas-painter.batch.test.ts)。
  - 验收：仅在确认当前点可绘制后进行批次判断/计数；增加“100 个可见点 + 大量屏外点”回归测试。

## 测试覆盖清单

- [x] managed `setArrowTable` 的跨 CRS 写入。
- [x] `projectLayer` 的整源和 target-scoped 地图 CRS 不变量。
- [x] custom mutable source 缺少 `getCRS()`。
- [x] 独立地图使用独立 source 的引擎 JSDoc 约定，无 runtime owner 排斥逻辑。
- [x] 首次加载在最终 commit 前被 supersede/remove/listener throw。
- [x] 普通 op/reproject 事件异常后的 dataset、CRS 和 history 一致性。
- [x] `map.remove()` 后 retained source 的独立生命周期。
- [x] DuckDB 输出继承 `prj`/`wkt1`/legacy `crs`。
- [x] 未知 CRS Shapefile 和 DuckDB mask 的最终约定。
- [ ] 深只读嵌套属性和 `Feature.geometry` 编译期约束。
- [x] LayerRegistry 冲突优先级、复合键特殊字符、Canvas 屏外点批处理。

## 已确认完成，无需重复开项

- [x] 已注册 source 存在时，`map.setCRS()` 拒绝 display-only CRS 修改。
- [x] 受管 `TopologySource.reproject()` 拒绝投影到 owning map 之外的 CRS。
- [x] 普通 `setData()` 在 dataset 可观察前执行地图 CRS 归一化，失败保留旧 dataset。
- [x] 已加载 source 的 `addSource()` 在注册前投影到地图 CRS。
- [x] `loadSnapshot()` 创建的 source 重新经过 `addSource()` 归一化。
- [x] 普通 Mapshaper ops 从当前 live dataset 的隔离副本处理，并检查 source/dataset/editVersion 竞态。
- [x] `map.reproject()` 正常路径会准备全部 source，并支持 undo/redo 和 preparation race 检查。
- [x] DuckDB relation/overlay 的 secondary dataset 会先在隔离副本上对齐到 primary CRS。

## 当前验证基线

- [x] `npm run typecheck`：通过。
- [x] `npm run test:run`：115 个测试文件通过、6 个跳过；1856 个测试通过、24 个跳过。
- [x] `npm run format:check`：通过。
- [x] `git diff --check`：通过。
- [x] `npm run test:duckdb`：6 个 DuckDB-Wasm suite、24 个测试全部通过。

## 跟踪与提交整理

- [ ] Multica 连接可用后，在 `emap` 项目搜索上述问题并为没有重复项的条目建 issue，再把 issue 链接回填到本文件。
- [ ] 将当前大工作区拆分为可审查提交：核心 CRS/owner/atomicity、DuckDB、只读/API 边界、非 CRS 修复、测试、生成文档与示例。
