# 交互编辑增强：Reshape、顶点批量操作、挖洞与 Part 管理

日期：2026-08-26
状态：设计已批准
范围：交付 QGIS 对照差距分析中的优先级 2（reshape + 顶点批量操作）与优先级 3（挖洞 + part 交互管理，核心四个工具子集）。

## 背景与目标

QGIS 差距分析确认的两个高频缺口：

1. **修形效率**：无 reshape 工具，顶点编辑一次只能动一个拓扑节点。
2. **面结构管理**：数据模型支持 hole / multipart，但没有交互入口。

目标：按 QGIS 的操作逻辑补齐四个工具，同时完全落在 emap 既有架构上
（op 负责几何与历史，handler 负责交互草图，选择集为作用域）。

非目标（显式排除）：

- reshape 的洞边整形、线端点延伸、多次穿越的区间选择。
- QGIS Fill Ring（点击洞生成新要素）。
- QGIS Split Parts（已有批量 `explode` op 覆盖）。
- CAD 约束输入（优先级 1，另行立项）。

## 总体架构

### 复用 split 确立的模式

- **op 层**：`src/map/ops/` 下手写 op 函数，经 `runPreparedDatasetMutation`
  提交——撤销快照、选择保持（feature id 不变时）、渲染缓存失效、历史标签
  全部来自该管线。`MapshaperOps` 加薄门面方法。
- **handler 层**：点击放点、右键完成、Esc 取消、顶点/边吸附、overlay 预览；
  通过 `editmodechange` 在模式离开时自动清理。

### 共享草图基建（新）

`split-feature.ts` 的草图机制（顶点序列、overlay、吸附、按键、提交节流）
被 reshape / ring / part 三个新 handler 共同需要。抽取
`src/core/handlers/sketch-session.ts`：

- 输入：吸附配置（sources、vertex/edge 开关、阈值）、完成判定（最少点数）。
- 状态：顶点数组、光标坐标、吸附结果、overlay 发布。
- 输出：完成回调（坐标序列）、取消回调。
- `SplitFeatureHandler` 迁移到该控制器（机械重构，现有测试兜底）。

不抽取会导致四份 ~200 行重复；抽取是本次工作的针对性改进，不波及其他 handler。

### 模式机扩展

`EditMode` 加性扩展：`'reshape' | 'ring' | 'part'`。三个新 handler 各占一个
模式；`_syncEditModeDragPan` 的 blocksPan 集合加入三者。类型联合加宽为兼容变更。

## 工具 1：Reshape

### API

```ts
map.ops.reshapeSelected({ line: [number, number][] }): Promise<OpResult<ReshapeSelectedResult>>;
// ReshapeSelectedResult { reshapedCount: number }
```

`reshapeFeature` handler：`map.reshapeFeature.enable()`，点击绘制整形线，
右键完成提交，Esc 取消；吸附选中要素的顶点与边。

### 语义（QGIS 对齐）

**接触点** = 整形线端点落在目标几何上（容差内）∪ 与目标的横断交叉
（沿用 split 的 transverse 判定）；切线接触不计。

**线目标**：

- 目标在"沿目标走向的首个与末个接触点"处断开，中间段丢弃，整条整形线接入：
  `head + line + tail`。
- 接触点 < 2 → 该要素不整形。
- 闭环目标：与开线同一规则——接触点按"距存储接缝的走向距离"排序，替换
  最小与最大接触点之间的正向段（不绕接缝）。

**面目标**（v1 仅外环）：

- 外环上沿环最外侧两个接触点确定两条候选弧 A1 / A2。
- 构造两个候选环（A_i 被整形线替换），要求：简单环、绕向符号与原环一致、
  洞不被触及。
- 两者均合法时按 QGIS 规则裁决：采样整形线中段中点 m，
  m 在原面内 → 取 |面积| 更小者（向内削）；在外 → 取 |面积| 更大者（向外扩）。
- 结果过 `validatePolygon`；非法 → 该要素不整形并报错明细。

**统一**：没有任何选中要素被整形 → `Err.validation('line', 'did not reshape …')`；
部分要素未命中属正常（整形线只穿越了部分要素）。

### 实现要点

- 交叉/接触计算复用 `split-selected-polygon.ts` 的 `shapeSegments` /
  `segmentIntersection` 与线侧的横断判定思路；目标侧切割用
  `adapter.insertCutPoints` 后在弧序列上重组。
- 新弧经 `adapter.appendEmptyArc` / `appendVertex` 追加（与 draw/feature-create
  同款，保证顶点存储与 z 值一致）。
- 主事务与选择保持由 `runPreparedDatasetMutation` 提供；op 内部对 stale
  dataset 的防御同 splitSelected（`original !== callTimeDataset`）。

## 工具 2：顶点批量操作（扩展 `VertexEditHandler`）

QGIS vertex tool 逻辑移植到 emap 的拓扑节点模型：

- **框选**：无顶点/边悬停时按下拖动 → 橡皮筋矩形；松开选中矩形内全部拓扑
  节点。shift 累加、裸选替换、空点或 Esc 清空。该手势此前在 vertex 模式为
  空闲（dragPan 已挂起），无冲突。
- **选择集**：节点级（`_hoverVertexIds` 同款节点语义——共享同一拓扑节点的
  所有顶点索引）；渲染复用 edit vertex state overlay，必要时最小扩展以区分
  "选中"与"悬停"。
- **成组移动**：拖动任一已选节点 → 所有选中节点按同 delta 移动；每节点一个
  `VertexMoveCommand`，包入 `CompositeCommand`，一条历史记录。
- **成组删除**：Delete 键 → 逐节点走 `planTopologyNodeDeletion` 守卫；
  **任一节点不可删（弧端点等）则整体拒绝**并 fire `error` 事件，不做静默
  部分删除。
- 吸附沿用 handler 既有 snapToVertex/snapToEdge 选项。

## 工具 3：挖洞

### API

```ts
map.ops.addRing({ ring: [number, number][] }): Promise<OpResult<void>>;
map.ops.deleteRing({ point: [number, number] }): Promise<OpResult<void>>;
```

前置：当前选择 = 恰好 1 个面要素，否则 `Err.validation('selection', …)`。
`ringEdit` handler：addRing 用草图绘制；deleteRing 用点击。

### addRing 校验（全部满足才提交）

1. 草图未闭合时自动闭合；去重连续重复点。
2. 简单环、|面积| > 0。
3. 严格在外环内：全部顶点 `testPointInPolygon` 在内，且环边与外环无交叉。
4. 不与既有洞相交（含边界接触）。
5. 绕向与外环相反（带符号面积判定，必要时反转坐标），保证 GeoJSON/TopoJSON
   导出绕向正确。

### deleteRing

- 点击点命中某洞（点在洞环内）→ 移除该 part。
- 点不在任何洞内（含落在外环边界上）→ `Err.validation('ring', …)`；
  v1 不支持删外环（改用 `deleteSelected()`）。

## 工具 4：Part 管理

### API

```ts
map.ops.addPart({ coordinates: [number, number][] }): Promise<OpResult<void>>;
map.ops.deletePart({ point: [number, number] }): Promise<OpResult<void>>;
```

前置：当前选择 = 恰好 1 个要素；图层为面或线（点图层拒绝）。
`partEdit` handler：addPart 草图类型跟随图层（面→闭合环，线→开放线）；
deletePart 用点击。

### addPart 校验

1. 面：闭合简单环、|面积| > 0、外环绕向；线：≥2 个不同顶点。
2. 与既有 part 无交叉、无重叠。
3. 面新 part 允许完全落在洞内（OGC 合法岛）；不许跨越任何既有边界。
4. 面新 part 不许与既有外环内外重叠。

### deletePart

- 面：点被某 part 包含 → 移除该 part。线：距点最近的 part 在吸附阈值
  （复用 `snapThreshold`，默认 10px）内 → 移除。
- 仅剩一个 part 时拒绝，提示改用 `deleteSelected()`。

## 界面与文档

- `EditToolbarOptions` 增加可选按钮组（reshape / ring / part），默认不显示，
  传参才启用（与 drawSource 同模式），避免改动既有默认外观。
- 新增示例页 `packages/examples/examples/reshape-ring-part/`：一个页面演示
  四个工具，沿用 split-features 示例结构（clickSelect 负责选择）。
- 文档：`packages/docs/docs/guides/editing.md` + 英文 i18n 各补四节；
  CHANGELOG Unreleased/Added 记录四项。
- 包导出：新 handler、新 op 的 options/result 类型经 `src/index.ts` 导出。

## 测试计划

- **op 几何单测**：每 op 一个测试文件，仿 split-selected-line/polygon.test.ts
  ——构造 dataset、调用、导出坐标/面积断言；覆盖：典型整形（线/面内削/外扩）、
  接触点 <2、闭环目标、洞不受触及、非法环拒绝、addRing 五校验逐条、
  deleteRing 命中/未命中、addPart 岛/重叠/跨界、deletePart 末 part 拒绝。
- **顶点批量**：vertex-edit.test.ts 扩展——框选状态机、shift 累加、成组移动
  产生单条 CompositeCommand、成组删除原子拒绝、Esc/空点清空。
- **handler 单测**：mock host 驱动点击序列（仿 split-feature.test.ts）。
- **集成测试**：仿 split-selected.integration.test.ts，走主事务验证历史、
  选择保持、回滚。
- **示例测试**：`test/examples/reshape-ring-part.test.ts` 执行示例内联脚本。
- 草图抽取：`split-feature` 现有全部测试保持绿（迁移回归兜底）。
- 收尾：`tsc --noEmit` + 全量 vitest。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| reshape 面目标的双候选裁决在退化输入下不稳定 | 两候选都需简单 + 绕向一致，仍双合法时用面积规则；测试覆盖退化输入 |
| 草图抽取破坏 splitFeature 既有行为 | 迁移后跑 split-feature 全部测试；改动限机械搬迁 |
| 顶点成组移动与共享弧拓扑的交互（两选中节点同属一弧） | 逐节点 VertexMoveCommand 语义不变；CompositeCommand 保原子撤销 |
| mapshaper 绕向约定误判导致洞导出为外环 | 用带符号面积实测判定，测试锚定 GeoJSON 导出结构 |
| 新 op 与 stale dataset 竞态 | 沿用 splitSelected 的 call-time dataset 比对 |

## 交付切片

1. 共享草图基建抽取 + splitFeature 迁移（先行，阻塞三个 handler）。
2. op 几何核心：reshape（线/面）、addRing/deleteRing、addPart/deletePart
   （互相独立，可并行）。
3. 顶点批量操作（vertex-edit.ts 内扩展，独立于 2）。
4. 三个新 handler（依赖 1、2）。
5. EditToolbar / 示例 / 文档 / CHANGELOG / 导出（依赖 2、4）。
6. 全量验证收尾。

共享文件（`mapshaper-ops.ts` 门面、`edit-state-store.ts`、`src/index.ts`、
CHANGELOG）由集成方串行合入，避免并行冲突。
