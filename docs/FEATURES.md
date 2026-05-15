# emap 功能总览

`emap` 是一个**纯浏览器、框架无关的 TypeScript 地图渲染与编辑引擎**，核心数据结构基于 [Mapshaper](https://github.com/mbloch/mapshaper) 的拓扑模型，渲染走 HTML5 Canvas 2D。无服务端依赖，全部 `fetch()` 客户端加载。

> 本文档罗列当前实现的所有能力，按"使用场景"分组。每节末尾给出对应 `test/examples/*.html` 的 playground 路径，可直接打开试用。

---

## 1. 数据加载与导出

### 支持的输入格式

| 格式 | 后缀 | 加载入口 |
|---|---|---|
| GeoJSON | `.geojson` / `.json` | `TopologySource.setData({content})` |
| TopoJSON | `.topojson` / `.json` | 同上 |
| Shapefile（含 `.shp/.dbf/.shx/.prj`） | `.zip` | 同上（zip 内自动解析） |
| mapshaper 快照（msx） | `.msx` | `loadSnapshot()` |

加载流程内置：
- 资源限制（防 zip 炸弹：单文件 / 总解压上限）
- CRS 自动推断（GeoJSON 默认 WGS84，Shapefile 读取 `.prj`）
- 拓扑构建（共享弧自动生成）
- LOD 简化（>50w 点惰性构建 display arcs）

### 支持的导出格式

- GeoJSON / TopoJSON（单文件 Blob）
- Shapefile（多文件 zip Blob）
- msx（mapshaper 快照，含简化阈值与压缩）

**例子**：`test/examples/geojson-viewer.html`、`test/examples/export-roundtrip.html`、`test/examples/snapshot.html`

---

## 2. 30+ 数据操作（`emap.ops.*`）

所有 op 都返回 `Promise<OpResult>`，自动推入 `EditHistory`，可 Ctrl+Z 撤销，可被 Transaction 包裹，可走 Worker。

### 几何变换 / 缓冲

| Op | 作用 | 主要参数 | playground |
|---|---|---|---|
| `bufferLayer` | 点/线/面 缓冲区 | radius, capStyle, vertices, arcQuality, type, planar, v2, tolerance, sliceLength, backtrack | `buffer.html` |
| `affineLayer` | 仿射变换（平移/旋转/缩放/剪切） | matrix | `feature-rotate-scale.html` |
| `projectLayer` | 投影变换 | crs (EPSG/WKT/Proj.4/mproj alias) | `project.html` |
| `simplifyLayer` | 多边形/线简化 | percentage, interval, method (dp/visvalingam/weighted) | `simplify.html` |
| `cleanLayer` | 修复几何（拓扑错误、自相交） | snapInterval, removeEmpty | — |
| `snapLayer` | 顶点对齐 | snapInterval | `snap.html` |
| `rebuildTopology` | 重建拓扑（共享弧重算） | snapInterval | `rebuild-topology.html` |

### 集合操作

| Op | 作用 | playground |
|---|---|---|
| `clipLayer` | 用 mask 图层或 bbox 裁剪 | `clip-erase.html` |
| `eraseLayer` | 用 mask 图层或 bbox 擦除 | 同上 |
| `unionLayer` | 求并 | `union.html` |
| `dissolveLayer` | 按字段融合 | `dissolve.html` |
| `mosaicLayer` | 镶嵌（不重叠多边形覆盖） | `mosaic.html` |
| `divideLayer` | 用 divider 图层切分 | `divide.html` |
| `intersectionPointsLayer` | 自/互相交点 | — |
| `mergeLayersOp` | 多图层合并为单图层 | `merge-layers.html` |
| `splitLayerOp` | 按字段拆分图层 | `split-layer.html` |

### 几何提取与转换

| Op | 作用 | playground |
|---|---|---|
| `polygonsLayer` | 线 → 多边形 | `polygons.html` |
| `linesLayer` | 面/点 → 线 | `lines.html` |
| `pointsLayer` | 面/线 → 点（中心 / 顶点 / inner / intersection） | `points.html` |
| `innerlinesLayer` | 提取共享边界 | `innerlines.html` |
| `explodeLayer` | MultiPart → 多个 single-part | `explode.html` |

### 过滤

| Op | 过滤依据 | playground |
|---|---|---|
| `filterFeatures` | JS 表达式（需 expression policy = trusted） | `filter-features.html` |
| `filterGeom` | 几何类型 | — |
| `filterIslands` | 多边形岛大小 | — |
| `filterSlivers` | 锐角碎片 | — |
| `filterFieldsOp` | 数据表字段白名单/黑名单 | — |
| `uniqueFeaturesOp` | 按字段去重 | — |

### 属性 / 数据表

| Op | 作用 | playground |
|---|---|---|
| `applyExpression` | 批量 JS 表达式更新属性 | `attribute-expressions.html` |
| `joinTable` | CSV/JSON 表关联（按 key） | `join.html` |
| `renameFieldsOp` | 字段重命名 | — |
| `sortFeaturesOp` | 按字段排序 | — |
| `dataFill` | 沿邻接关系填充缺失值 | `data-engineering.html` |
| `setProperty` / `addProperty` / `removeProperty` / `renameProperty` | 单条 feature 属性编辑（命令式） | `attribute-editing.html` |
| `addField` / `removeField` / `renameFieldLayer` | 整列字段操作 | — |

### 校验

| Op | 作用 | playground |
|---|---|---|
| `checkGeometry` | 拓扑/几何检查报告 | `check-geometry.html` |

### 图层管理

| Op | 作用 | playground |
|---|---|---|
| `renameLayer` | 改图层名 | `rename-layer.html` |
| `dropLayer` | 删除图层 | — |

---

## 3. 安全与表达式策略

为防止远程图层配置或不受信数据触发 JS 求值，所有"接受表达式串的 op"默认禁用：

```ts
new Emap({ container, expressionPolicy: 'disabled' })  // 默认
```

涉及 op：`applyExpression`、`filterFeatures`、`sortFeatures`、`splitLayer`、以及任何 `where=` / `calc=` / 字符串 `radius` 等表达式参数。

app 显式信任时切换：
```ts
emap.setExpressionPolicy('trusted')
```

详见 `SECURITY.md`。

---

## 4. 编辑模型

### Memento 命令 + 撤销栈（`EditHistory`）

| 命令类 | 用途 |
|---|---|
| `VertexMoveCommand` / `VertexInsertCommand` / `VertexDeleteCommand` | 顶点级编辑 |
| `FeatureCreateCommand` / `FeatureDeleteCommand` / `BulkFeatureDeleteCommand` | feature 级新增/删除 |
| `FeatureTranslateCommand` / `FeatureAffineCommand` | feature 平移 / 旋转 / 缩放 |
| `SetPropertyCommand` / `AddPropertyCommand` / `RemovePropertyCommand` / `RenamePropertyCommand` | 属性编辑 |
| `AddFieldCommand` / `RemoveFieldCommand` / `RenameFieldCommand` | 字段操作 |
| `DatasetReplaceCommand` | 所有 op（clip / dissolve / buffer…）自动生成 |
| `CompositeCommand` | Transaction 自动合并子命令 |

**特性**：
- 撤销 / 重做 / coalesce（连续同类操作可合并为一步）
- dataset-replace 后旧命令标 `stale`（不可直接 undo，UI 渲染分隔条）
- `bindHistoryShortcuts()` 一键绑定 Ctrl+Z / Ctrl+Y

### 会话式连续编辑（`edit-sessions`）

| Session | 作用 |
|---|---|
| `FeatureTranslateSession` | 拖动平移，`commit()` 推一次撤销项；`cancel()` 还原 |
| `FeatureAffineSession` | 矩阵累积旋转/缩放，commit/cancel 模式 |

### Transaction（原子多步编辑）

```ts
const tx = emap.beginTransaction();
await emap.ops.clipLayer({...});      // 子命令被捕获
await emap.ops.bufferLayer({...});    // 同上
tx.commit('Trim + buffer');            // 折叠成单条 CompositeCommand
// 或 tx.rollback();                    // 整体回滚到 transaction 前
```

每个 source 在 transaction 首次被触碰时拍快照；rollback 恢复 dataset 与选择状态。

### Validators（后置校验钩子）

```ts
emap.validators.register(topologyValidator({ checkIntersections: true }), 'after-commit');
```

每次 historychange 后并行执行所有已注册 validator；失败时 fire `validationfailed` 事件，**引擎不自动 undo**，由 app 决定。

**例子**：`feature-translate.html`、`feature-rotate-scale.html`、`vertex-editing.html`、`transaction.html`、`undo-redo.html`、`china-editing.html`、`merge-selected.html`

---

## 5. 选择与查询

### 选择模型（`Selection`）

- 单选 / 多选 / 切换 / 差集（diff）
- `pack()` / `unpack()` 快照
- 选区变化触发 `selectionchange` 事件
- 多数 dataset-replace op 自动按 effect 决定是否清选择

### 命中测试（`FeatureQuery`）

- Flatbush 空间索引
- `pickAt(x, y)`：屏幕坐标点击查询
- `query(bbox)`：矩形范围查询
- 按 layer 自动建索引，dataset 变更后惰性重建

### 只读访问器（`FeatureAccessor`）

```ts
emap.features.get({ source, layer, id })      // → Feature | null（properties 冻结）
emap.features.iter(source, layer)              // → IterableIterator<Feature>
emap.features.count(source, layer)             // → number
```

任何失败查询返回 `null`，不抛异常。

### 高亮（`HighlightManager`）

- hover 高亮 / 选中高亮 / 自定义临时高亮
- 独立于选择，可叠加

**例子**：`feature-selection.html`、`box-select.html`、`lasso-select.html`、`feature-attributes.html`

---

## 6. 视图与坐标系

### Viewport

- 平移 / 缩放 / setExtent / fitBounds
- 缩放动画（tween）
- 屏幕 ↔ 地理坐标互转

### 投影 / CRS

- 解析 EPSG 代码（`EPSG:4326` / `EPSG:3857` / …）
- 解析 WKT、Proj.4 字符串
- mproj 内置投影 + alias
- `applyCRS` 切换地图投影并触发 `crschange`

### AffineTransform

通用 `(x*mx + bx, y*my + by)` 仿射，用于所有坐标管线。

---

## 7. 交互

| 模块 | 默认行为 | 可关闭 |
|---|---|---|
| `DragPanHandler` | 鼠标拖动平移 | `interactive: false` |
| `interactions.wheelZoom` | 滚轮缩放（鼠标点为锚） | 同上 |

### UI 控件（`Control` 接口）

| Control | 作用 | playground |
|---|---|---|
| `NavigationControl` | 缩放按钮 + 复位 + 上下一步导航历史 | 任意 |
| `HistoryControl` | undo/redo 按钮 + 栈深显示 | `undo-redo.html` |
| `BasemapControl` | 底图切换（maplibre-gl tiles） | `china-editing.html` |
| `StatusControl` | 鼠标坐标 / CRS 显示 | — |
| `VertexEditControl` | 顶点编辑工具栏 | `vertex-editing.html` |
| `BoxSelectControl` | 框选 | `box-select.html` |
| `LassoSelectControl` | 套索选 | `lasso-select.html` |
| `DrawFeatureControl` | 绘制点/线/面 | `draw-snap-edge.html` |
| `SimplifyControl` | 点开弹窗，滑块控制简化百分比 + 方法 + flag，Apply 应用一次 | `simplify-control.html` |
| `EditToolbar` | 综合编辑工具栏 | — |

自定义 control 实现 `onAdd(map): HTMLElement` + `onRemove()` 即可。

---

## 8. 渲染

### 渲染管线

`CanvasPainter` 走 HTML5 Canvas 2D，批量分组 25 shapes / `stroke()` 调用，针对大拓扑数据集优化（winding-rule 填充 vs 直线 stroke 的成本差是关键考量）。

### LOD（Level of Detail）

- 大数据集（>500k 点）自动构建 `DisplayArcs`
- 按 pixelSize 取简化版弧
- 编辑后惰性重建

### 图层样式（`LayerSpecification`）

- `type: 'circle' | 'line' | 'fill'`
- paint：颜色、宽度、不透明度、虚线、点半径
- 支持 hover / selected 状态的样式覆盖
- 默认按 geometry_type 自动建图层（point→circle、其他→line）

### 边绘制覆盖层（`drawDrawingOverlay`）

绘制时的临时图形、捕捉指示（顶点 / 中点 / 边线），由 `EditOverlayRenderer` 统一管线。

**例子**：`polygon-fill.html`、`web-worker.html`（off-thread 渲染加速）

---

## 9. Worker 加速

```ts
new Emap({
  container,
  useWorker: 'auto',     // false / true / 'auto'
  workerThreshold: 50000, // 'auto' 模式下的顶点数阈值
  workerUrl: 'emap-worker.js',
  workerPoolSize: 1,      // 可设 navigator.hardwareConcurrency - 1
})
```

每条 dataset-replace op 按命令族决策是否分派：
- **expensive**（buffer / clean / dissolve / simplify / project / mosaic / union / divide …）→ 阈值打 0.5×
- **cheap**（filter / rename / sort / join …）→ 阈值打 1×
- 选择级 op（translate / rotate / vertex 移动）→ 永远主线程

worker 间走 Transferable 传递 ArcBuffer，无 deep clone 成本。

**例子**：`web-worker.html`

---

## 10. 事件系统（`EventDispatcher`）

`emap.on(event, listener)` 接入下列事件：

| 事件 | 触发时机 |
|---|---|
| `data` | source 加载或被 op 替换 |
| `historychange` | undo 栈结构变化 |
| `selectionchange` | 选区变化 |
| `validationfailed` | validator 报错 |
| `crschange` | 地图投影切换 |
| `workerjobstart` / `workerjobend` | worker 调度 |
| `error` | op 内部异常 |
| `move` / `zoom` / `rotate` | 视图变化 |

---

## 11. 测试与开发

- **Vitest 单元测试**：~970 用例、43 测试文件
- **40+ HTML playground**：`test/examples/`，无需启服务，直接浏览器打开
- **fixtures**：`test/fixtures/points.geojson`、`lines.geojson`、`tiny.geojson`、`topology-shared.geojson`
- **测试桩**：`src/map/ops/_test-helpers.ts` 共享 OpContext 桩

构建：
```bash
npm run dev-build   # 单次开发构建（含 sourcemap）
npm run dev         # 监听构建
npm run build       # 生产（minify + d.ts）
npm test            # vitest
```

---

## 12. 公共 API 导出

`import { ... } from 'emap'` 提供：

- 编排：`Emap`
- 来源：`TopologySource`
- 编辑：`EditHistory`、`Transaction`、所有 `*Command` 类
- 验证：`ValidatorRegistry`、`topologyValidator`
- 选择 / 查询：`Selection`、`FeatureQuery`、`FeatureAccessor`、`HighlightManager`
- 几何：`Bounds`、`AffineTransform`、`Viewport`、`Projection`、`DEFAULT_CRS`、`normalizeCrsString`、`inferFromPrj`
- 渲染：`CanvasPainter`、`EditOverlayRenderer`
- 控件：`NavigationControl`、`HistoryControl`、`BasemapControl`、`StatusControl`、`VertexEditControl`、`BoxSelectControl`、`LassoSelectControl`、`DrawFeatureControl`、`EditToolbar`
- Worker：`MapshaperWorkerPool`
- Adapter：`DefaultMapshaperAdapter`、`getDefaultMapshaperAdapter`、`setDefaultMapshaperAdapter`
- 工具：`quoteCliArg`、`isValidLayerName`、`isValidFieldName`、`Err` / `OK` / `okValue`
- 全部 op option 类型：`BufferOptions`、`ClipEraseOptions`、`DissolveOptions` 等 30 余个
- 全部底层类型：`MapshaperLayer`、`MapshaperDataset`、`ArcCollection`、`Feature`、`OpResult`、`OpError` 等

源：`src/index.ts`（无 `export *`，全部显式 named export）。

---

## 13. 已知限制 / 范围外

- **浏览器专属**：无 Node.js 运行时 API（除测试与构建工具）
- **无服务端**：所有数据通过 `fetch()` 客户端加载
- **mapshaper 内部仅经 `MapshaperAdapter` 桥接**：版本升级只动一个文件
- **表达式默认禁用**：调用 `applyExpression` 等需显式 `expressionPolicy='trusted'`
- **Web Worker 单文件**：worker bundle 独立（`emap-worker.js`），需与主 bundle 同源部署

---

## 14. 相关文档

| 文件 | 内容 |
|---|---|
| `README.md` | 项目简介 + Quick Start |
| `CLAUDE.md` | AI 助手专用代码导航 + 架构关键模式 |
| `AGENTS.md` | OpenSpec 工作流入口 |
| `SECURITY.md` | 表达式安全策略 + 漏洞汇报渠道 |
| `docs/backlog.md` | 已延后的工作 + 触发条件 |
| `docs/superpowers/specs/` | 历史设计稿 |
| `docs/superpowers/plans/` | 历史实施计划 |
| `openspec/` | OpenSpec 提案与 capability spec |

---

*最后更新：2026-05-14，对应 commit `08eae51`。新增/修改功能时请同步更新本文档。*
