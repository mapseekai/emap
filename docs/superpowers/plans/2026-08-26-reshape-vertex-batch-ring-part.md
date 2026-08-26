# Reshape、顶点批量操作、挖洞与 Part 管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 QGIS 操作逻辑补齐四个编辑工具——reshape（线/面整形）、顶点批量操作（框选/成组移动/成组删除）、挖洞（add/delete ring）、part 管理（add/delete part）——全部落在既有 op + handler 架构上。

**Architecture:** 几何与历史在 `src/map/ops/` 的 op 函数（`runPreparedDatasetMutation` 管线），交互在新的草图 handler（共享 `SketchSession` 基建，由 `split-feature.ts` 抽取）。纯几何助手从 split-selected-polygon/line 抽取为 `geometry-2d.ts` 供全部新 op 复用。

**Tech Stack:** TypeScript 5, Vitest 4, mapshaper 拓扑内核（仅经 `MapshaperAdapter`），既有 EditHistory / Transaction / edit overlay。

**Spec:** `docs/superpowers/specs/2026-08-26-reshape-vertex-batch-ring-part-design.md`

## Global Constraints

- 不新增运行时依赖；生产几何代码不做 GeoJSON 往返。
- `mapshaper` 直接导入只允许出现在 `src/adapter/mapshaper-adapter.ts`。
- 全部新 op 走 `runPreparedDatasetMutation`；stale dataset 防御沿用 splitSelected 的 `original !== callTimeDataset` 比对。
- 修改既有函数/类/方法前跑 GitNexus `impact`（upstream）；HIGH/CRITICAL 必须先警告。
- 所有 shell 命令加 `rtk` 前缀。
- 选择集约定：reshape 要求同源同层选择；ring/part 要求恰好 1 个选中要素。
- 每个 op 的 feature 数量不变（reshape/ring/part 都不增删要素）→ 提交后选择集原样保持。
- TDD：先写失败测试，再实现，再跑绿，再提交。
- 类型规则：禁止 `any`（测试可用 `as unknown as T` 并附一行理由）；静态字符串查找表用 `Record<K,V>`。

---

## File Structure

### New files

- `src/map/ops/geometry-2d.ts` — 纯 2D 几何助手（从 split 两个文件抽取并去重）。
- `src/core/handlers/sketch-session.ts` — 共享草图控制器。
- `src/core/handlers/sketch-session.test.ts`
- `src/map/ops/reshape-selected.ts` — reshape op 入口（选择/陈旧/图层守卫 + 主事务）。
- `src/map/ops/reshape-selected-line.ts` / `reshape-selected-polygon.ts` — 几何核心。
- `src/map/ops/reshape-selected.test.ts` / `reshape-selected-line.test.ts` / `reshape-selected-polygon.test.ts`
- `src/map/ops/rings.ts` — `addRing` / `deleteRing`。
- `src/map/ops/rings.test.ts`
- `src/map/ops/parts.ts` — `addPart` / `deletePart`。
- `src/map/ops/parts.test.ts`
- `src/core/handlers/reshape-feature.ts` / `reshape-feature.test.ts`
- `src/core/handlers/ring-edit.ts` / `ring-edit.test.ts`
- `src/core/handlers/part-edit.ts` / `part-edit.test.ts`
- `packages/examples/examples/reshape-ring-part/index.html`
- `test/examples/reshape-ring-part.test.ts`

### Modified files

- `src/map/ops/split-selected-polygon.ts` / `split-selected-line.ts` — 改为从 `geometry-2d.ts` 导入（机械替换，测试兜底）。
- `src/core/handlers/split-feature.ts` — 迁移到 `SketchSession`。
- `src/map/edit-state-store.ts` — `EditMode` 加 `'reshape' | 'ring' | 'part'`。
- `src/map/map.ts` — 注册三个 handler + getter；`_syncEditModeDragPan` blocksPan 加三模式。
- `src/map/mapshaper-ops.ts` — 门面方法 `reshapeSelected/addRing/deleteRing/addPart/deletePart`。
- `src/map/types.ts` — 新 options/result 类型。
- `src/core/handlers/edit-handler-host.ts` — ops Pick 扩展五方法。
- `src/core/handlers/vertex-edit.ts` — 顶点批量操作。
- `src/renderer/edit-overlay-renderer.ts` — 新模式渲染 draw state；EditVertexState 可选 band 矩形。
- `src/ui/edit-toolbar.ts` — `advancedTools` 可选按钮组。
- `src/index.ts` — 导出。
- `docs-meta/examples.ts` — 注册示例。
- `packages/docs/docs/guides/editing.md` + 英文 i18n — 文档。
- `CHANGELOG.md`。

---

### Task 1: geometry-2d 抽取 + EditMode 扩展

**Files:**
- Create: `src/map/ops/geometry-2d.ts`
- Modify: `src/map/ops/split-selected-polygon.ts`、`src/map/ops/split-selected-line.ts`
- Modify: `src/map/edit-state-store.ts:8`
- Modify: `src/map/map.ts`（`_syncEditModeDragPan`，约 757 行）
- Test: 既有 split 测试兜底（必须全绿）

**Interfaces:**
- Produces（后续 Task 3-6 全部消费）:

```ts
// src/map/ops/geometry-2d.ts
export type Coordinate = readonly [number, number];
export function coordinateKey(c: Coordinate): string;             // `${x},${y}`
export function unsignedArcId(id: number): number;                  // id < 0 ? -id - 1 : id
export function arcEndpoints(arcs, signedArcId): [Coordinate, Coordinate]; // 处理反向弧
export function cross(a: Coordinate, b: Coordinate, c: Coordinate): number;
export function segmentIntersection(a, b, c, d): Coordinate | null; // 容差 = 当前 EPSILON 策略
export function normalizeConsecutiveCoordinates(coords: readonly Coordinate[]): Coordinate[];
export function shapeSegments(shape: PathShape, arcs): Array<[Coordinate, Coordinate]>;
export function segmentsConflict(a, b, c, d): boolean;              // 相交/重叠/接触
export function validatePolygonArcReferences(shape: PathShape, arcs): void; // 抛 SplitGeometryValidationError
export function validatePolygon(shape: PathShape, arcs, adapter): void;     // 同上
export function shoelaceArea(ring: readonly Coordinate[]): number;          // 带符号面积（新增）
```

- [ ] **Step 1: 抽取。** 把上述函数从 `split-selected-polygon.ts` / `split-selected-line.ts` 原样搬入 `geometry-2d.ts`（`coordinateKey`、`arcEndpoints`、`normalizeConsecutiveCoordinates` 两边重复，保留 line 版的签名）；两个 split 文件改为 import。注意 EPSILON 常量：跟随被搬函数一起走，调用方差异用参数保留。新增 `shoelaceArea`（5 行）。
- [ ] **Step 2: EditMode。** `edit-state-store.ts`：`export type EditMode = 'none' | 'vertex' | 'draw' | 'split' | 'measure' | 'transform' | 'reshape' | 'ring' | 'part';`。`map.ts` `_syncEditModeDragPan`：`const blocksPan = mode === 'vertex' || mode === 'draw' || mode === 'split' || mode === 'reshape' || mode === 'ring' || mode === 'part';`
- [ ] **Step 3: 跑 `rtk vitest run src/map/ops/` 全绿**（抽取零行为变化），`rtk tsc --noEmit` 干净。
- [ ] **Step 4: Commit** `refactor: extract shared 2D geometry helpers from split ops`

### Task 2: SketchSession 抽取 + splitFeature 迁移

**Files:**
- Create: `src/core/handlers/sketch-session.ts`、`sketch-session.test.ts`
- Modify: `src/core/handlers/split-feature.ts`
- Test: `src/core/handlers/split-feature.test.ts`（一字不改，必须全绿）

**Interfaces:**
- Produces（Task 8-10 消费）:

```ts
export interface SketchSnapTarget { coord: [number, number]; kind: SnapKind }
export interface SketchSessionOptions {
  minVertices: number;                  // point=1, polyline=2, ring=3
  autoFinishAt?: number;                // 达到即完成（point 模式 = 1）
  closeRing?: boolean;                  // 完成时若未闭合自动追加首点
  drawColor?: string;                   // 默认 EMAP_THEME_COLORS.primary
  resolveSnap?: (px: number, py: number) => SketchSnapTarget | null;
  canPlace?: (snap: SketchSnapTarget | null) => boolean; // split point 模式要求 snap 非空
}
export class SketchSession {
  constructor(host: EditHandlerHost, opts: SketchSessionOptions, onFinish: (vertices: [number, number][]) => void);
  handlePointer(ev: NormalizedPointerEvent): HandlerResult; // click 放点 / contextmenu 完成或清空 / move 更新 overlay
  handleKeyDown(e: KeyboardEvent): void;                    // Esc 清空
  clear(): void;
  readonly vertexCount: number;
}
```

- [ ] **Step 1: 写 sketch-session.test.ts。** 用 mock host（`unproject: (x,y)=>[x,y]`、`setEditDrawState/clearEditDrawState/render` 用 `vi.fn()`）覆盖：逐点放置与 overlay 发布；右键在 minVertices 不足时清空、足够时回调坐标；`closeRing` 自动闭合；`autoFinishAt` 即时回调；Esc 清空并 render；`resolveSnap` 命中时放置吸附坐标；`canPlace` 返回 false 时点击无效。
- [ ] **Step 2: 跑测试确认失败**（文件不存在）。
- [ ] **Step 3: 实现 `sketch-session.ts`。** 状态与行为从 split-feature.ts 的 `_vertices/_cursorCoord/_snapCoord/_snapKind/_overlayPublished`、`_placeVertex/_refreshOverlay/_clearSketch/_onKeyDown` 机械提炼；右键 `preventDefault`；完成后自动 `clear()`。
- [ ] **Step 4: 迁移 `SplitFeatureHandler`。** 保留：`_resolveSelectionContext`、`_validateSelection`、`_selectionKey/_generation/_submissionGeneration`、`_submit`、`_findSnapTarget`。`handlePointer` 改为委托 session；`enable/disable/_quietDisable` 里的 keydown/move 订阅换成 session 的挂接（session 不自行订阅 window，handler 负责转发）。point 模式：`{ minVertices: 1, autoFinishAt: 1, canPlace: s => s !== null }`；polyline 模式：`{ minVertices: 2 }`。
- [ ] **Step 5: `rtk vitest run src/core/handlers/` 全绿。**
- [ ] **Step 6: Commit** `refactor: extract SketchSession from split-feature handler`

### Task 3: reshape 线目标几何核心 + op 入口

**Files:**
- Create: `src/map/ops/reshape-selected-line.ts`、`reshape-selected-line.test.ts`
- Create: `src/map/ops/reshape-selected.ts`、`reshape-selected.test.ts`
- Modify: `src/map/types.ts`（`ReshapeSelectedOptions/Result`）
- Modify: `src/map/mapshaper-ops.ts`（门面）
- Consumes: Task 1 的 `geometry-2d.ts`；`runPreparedDatasetMutation`（`OpContext`）

**Interfaces:**
- Produces:

```ts
// reshape-selected-line.ts
export interface Contact { point: [number, number]; targetDist: number; lineDist: number }
export function collectLineContacts(part: readonly number[], arcs, line: readonly Coordinate[], adapter): Contact[];
export function clipLineBetween(line: readonly Coordinate[], fromDist: number, toDist: number): Coordinate[];
export function reshapeSelectedPolylines(dataset, layerIndex: number, selectedIds: ReadonlySet<number>, line: readonly Coordinate[], adapter): Array<{ featureId: number; shape: PathShape }>;

// map/types.ts
export interface ReshapeSelectedOptions { line: [number, number][] }
export interface ReshapeSelectedResult { reshapedCount: number }
```

**算法（线 part）：**

1. `collectLineContacts`：沿 part 累计弧长（`targetDist`），沿 line 累计（`lineDist`）。横断交叉：逐对 segment 用 `segmentIntersection`，顶点命中要求 cross 变号（切线接触丢弃）；端点接触：`adapter.findClosestPointOnSeg` 将 line 首/尾点投到最近 segment，距离 ≤ `scale * Number.EPSILON * 64` 记为接触（scale = 坐标量级最大值，同 split 线侧容差策略）。按 point key 去重。
2. <2 接触 → 该 part 不变。否则取 `targetDist` 最小/最大两个接触 P_first / P_last。
3. `clipLineBetween(line, firstLineDist, lastLineDist)`：截出整形线在两个接触之间的子段（含两端接触点，去连续重复点）。子段 <2 点 → 该 part 不变。
4. `adapter.insertCutPoints(dataset, [P_first, P_last])`（feature 级收集后统一调一次）→ part 弧序列被重映射，两接触点成为弧端点。
5. 重组：`head = part[0..i]`（弧 i 以 P_first 收尾）、`tail = part[j..]`（弧 j 以 P_last 开头）；新弧 = `appendEmptyArc` + 逐点 `appendVertex`（ clipped 子段，首点=P_first、末点=P_last ）。`newPart = [...head, newArc, ...tail]`。
6. 闭环 part：接触按距接缝的走向距离排序后同开线处理；`newPart = [newArc, ...tail之后到接缝的弧, ...接缝到head的弧]`（即从 P_first 旋转重组，保持简单环）。
7. 结果周长为 0（退化）→ 拒绝该 part 并回滚本 feature 的改动。

**op 入口（reshape-selected.ts）** 复刻 splitSelected 的守卫序列：`selection 非空 → 同源同层（原始字符串比较，与 split 一致）→ line 至少 2 个有效点（normalizeConsecutiveCoordinates 后）→ source/layer 存在 → isPathLayer → 逐 id 校验形状存在`。`runPreparedDatasetMutation` 内：stale 检查 → `geometry_type === 'polyline'` 走 Task 3 核心，`polygon` 走 Task 4 核心 → 用返回的新 shape 替换 `workingLayer.shapes[featureId]`（splice 原位替换，属性不动）→ `reshapedCount === 0` 返回 `Err.validation('line', 'did not reshape any selected feature')` → 否则 `{ value: { reshapedCount }, selection: refs }`（选择原样）。

- [ ] **Step 1: 写 reshape-selected-line.test.ts。** 夹具仿 split-selected-line.test.ts 的 `importLines` + `exportLineCoordinates`。用例：
  - 开线 `(0,0)-(10,0)`，整形线 `[{5,1},{5,-1}]`（两端点都在目标外但中段横穿一次）→ 接触 <2 → 不变；
  - 开线 `(0,0)-(10,0)`，整形线 `[(3,0),(5,2),(7,0)]`（两端点在线上）→ 结果 `[(0,0),(3,0),(5,2),(7,0),(10,0)]`；
  - 整形线越界横穿两次 `[(3,-1),(3,1)]…[(7,1),(7,-1)]` 连成一条 `[(3,-1),(3,1),(7,1),(7,-1)]` → 裁出 `[(3,0),(3,1),(7,1),(7,0)]` 接入，结果 `[(0,0),(3,0),(3,1),(7,1),(7,0),(10,0)]`；
  - 闭环矩形线 + 整形线两端搭在两条对边上 → 替换正向段、不绕接缝；
  - multipart：只整被触及的 part；
  - 退化整形线（子段长度 0）→ 该要素不变。
- [ ] **Step 2: 确认失败。Step 3: 实现。Step 4: 跑绿。**
- [ ] **Step 5: reshape-selected.test.ts 的线部分**（选择守卫、跨层拒绝、stale、历史一条、选择保持、`reshapedCount`）。写测试 → 实现 op 入口（面分支先抛 `Err.validation('layer', …)` 占位错误，Task 4 填）→ 跑绿。
- [ ] **Step 6: Commit** `feat: add reshapeSelected op for polyline targets`

### Task 4: reshape 面目标几何核心

**Files:**
- Create: `src/map/ops/reshape-selected-polygon.ts`、`reshape-selected-polygon.test.ts`
- Modify: `src/map/ops/reshape-selected.ts`（接面分支）
- Consumes: Task 3 的 `collectLineContacts/clipLineBetween`；Task 1 的 `validatePolygon/shapeSegments/segmentsConflict/shoelaceArea`

**算法（面 feature，v1 仅外环）：**

1. 外环分类：`shoelaceArea` 符号——取 part 坐标（`arcs.getShapeIter` 展开）算带符号面积；首 part 符号记为外环符号，同号 = 外环，异号 = 洞。洞的归属：洞首顶点 `adapter.testPointInPolygon` 落在哪个外环内。
2. 对每个外环 part 跑 Task 3 的接触收集；<2 → 跳过。
3. 取沿环最外侧两接触，构造两个候选：
   - 候选 A：`[newArc(clip), ...绕接缝侧的保留弧]`（替换正向段）
   - 候选 B：替换另一段（newArc 反向接入）
   - 候选坐标用 `getShapeIter` 展开重组，经 `appendEmptyArc/appendVertex` 建弧。
4. 候选过滤：`validatePolygon([候选环], arcs, adapter)` 不抛；带符号面积符号与外环一致；原属洞全部仍在候选环内（洞首顶点 `testPointInPolygon` + 洞边与候选环无 `segmentsConflict`）。
5. 恰好一个合法 → 采用；两个合法 → 采样整形线中段中点 m：`testPointInPolygon(m, 原shape)` 为真取 |面积| 较小者，否则较大者；零合法 → 该 feature 不整形。
6. 洞 part 原样保留在新 shape 中（part 顺序：外环替换原位，洞跟随后面）。

- [ ] **Step 1: 写测试。** 夹具仿 split-selected-polygon.test.ts（`importPolygons` + `exportCanonicalGeometry` + `expectConserved` 风格）。用例：
  - 正方形 `(0,0)-(10,0)-(10,10)-(0,10)`，整形线 `[(3,-2),(5,3),(7,-2)]`（两端在外、中段探入?——实际写法：两端点搭在底边外侧穿越两次、中段在面内）→ 底边内削，面积变小，导出规范化几何锚定；
  - 整形线中段在面外（向外鼓）→ 面积变大；
  - 带洞面：整形成不与洞冲突 → 洞保留；整形会吞掉洞 → 该 feature 不整形；
  - 穿越 <2 次 → 不变；自相交整形线 → 不变；
  - multipart 面：只整被穿越的岛。
- [ ] **Step 2-4: 失败 → 实现 → 跑绿。** op 入口接通面分支。
- [ ] **Step 5: Commit** `feat: reshapeSelected polygon targets (exterior ring)`

### Task 5: rings op（addRing / deleteRing）

**Files:**
- Create: `src/map/ops/rings.ts`、`rings.test.ts`
- Modify: `src/map/types.ts`、`src/map/mapshaper-ops.ts`
- Consumes: `geometry-2d.ts`、`runPreparedDatasetMutation`

**Interfaces:**

```ts
// map/types.ts
export interface AddRingOptions { ring: [number, number][] }
export interface DeleteRingOptions { point: [number, number] }

// rings.ts
export async function addRing(ctx: OpContext, options: AddRingOptions): Promise<OpResult<void>>;
export async function deleteRing(ctx: OpContext, options: DeleteRingOptions): Promise<OpResult<void>>;
```

**addRing 校验序列**（任一失败返回对应 `Err.validation`，field 分别为 `ring`/`selection`）：
恰好 1 个选中面要素 → `normalizeConsecutiveCoordinates` + 自动闭合 → ≥4 点（含闭合点）→ 逐对 segment 无 `segmentsConflict` 自交 → `|shoelaceArea| > 0` → 全部顶点 `testPointInPolygon(整个 shape)` 为真（洞内/界外都会返回 false，一并排除）→ 环边与所有 part 边无 conflict → 绕向：与外环 `shoelaceArea` 异号，否则坐标反转 → `appendEmptyArc/appendVertex` 新弧、shape 追加 part。提交 `{ value: undefined, selection: refs }`。

**deleteRing**：恰好 1 个选中面要素 → 洞 part = 绕向与外环异号的 part；逐洞 `testPointInPolygon(point, [洞part])` 命中 → splice 该 part → `adapter.cleanArcReferences(dataset)` → 提交。无命中 → `Err.validation('ring', 'no ring contains the point')`。只剩外环（无洞）→ 同 error。

- [ ] **Step 1: 写 rings.test.ts。** 用例：正方形面加正中洞 → 导出 GeoJSON `coordinates` 含两个环且洞绕向相反；未闭合输入自动闭合；自交/面积 0/顶点出界/跨界/盖住既有洞 逐条拒绝；deleteRing 命中删除（导出回到单环）、点界外拒绝、无洞拒绝；非单要素选择拒绝；历史一条、选择保持。
- [ ] **Step 2-4: 失败 → 实现 → 跑绿。Step 5: Commit** `feat: addRing and deleteRing ops`

### Task 6: parts op（addPart / deletePart）

**Files:**
- Create: `src/map/ops/parts.ts`、`parts.test.ts`
- Modify: `src/map/types.ts`、`src/map/mapshaper-ops.ts`

**Interfaces:**

```ts
export interface AddPartOptions { coordinates: [number, number][] }
export interface DeletePartOptions { point: [number, number]; tolerance?: number } // 线图层用，数据单位
```

**addPart**：恰好 1 个选中要素，图层 `polyline | polygon`（点层 `Err.validation('layer', …)`）。
- 线：去重后 ≥2 点 → 新弧 + 新 part。
- 面：自动闭合 → 简单 + 非零面积 → 与既有全部 part 边无 conflict → 任一顶点点在 `testPointInPolygon(整个shape)` 内 → 拒绝（重叠）；既有任一外环顶点落在**新环内** → 拒绝（嵌套外环）；绕向与外环同号（洞内存岛天然满足，因为岛绕向同外环）→ 新弧 + 新 part。

**deletePart**：恰好 1 个选中要素，`shape.length < 2` → `Err.validation('part', 'feature has a single part; use deleteSelected')`。
- 面：`testPointInPolygon(point, [part])` 命中的 part → splice（外环岛或洞都可删）。
- 线：逐 part 求点到各 segment 最小距离（`findClosestPointOnSeg`），最近 part 距离 ≤ `tolerance ?? 0` → splice；否则 `Err.validation('part', 'no part near the point')`。
- 之后 `cleanArcReferences`。

- [ ] **Step 1: 写 parts.test.ts。** 用例：面加离岛 part（导出两个环同绕向）；洞内加岛合法；与既有面重叠/跨界/嵌套包围逐条拒绝；线加 part；deletePart 面删岛/删洞、线近点命中、末 part 拒绝、远点拒绝；历史与选择。
- [ ] **Step 2-4: 失败 → 实现 → 跑绿。Step 5: Commit** `feat: addPart and deletePart ops`

### Task 7: 顶点批量操作（vertex-edit.ts 扩展）

**Files:**
- Modify: `src/core/handlers/vertex-edit.ts`、`src/renderer/edit-overlay-renderer.ts`、`src/map/types.ts`（`EditVertexState` 加 `band?`）
- Test: `src/core/handlers/vertex-edit.test.ts`（扩展）
- Consumes: 既有 `VertexMoveCommand`、`planTopologyNodeDeletion`、`CompositeCommand`

**Interfaces:**
- `EditVertexState` 增加 `band?: { x0: number; y0: number; x1: number; y1: number } | null`（渲染虚线矩形）。
- `VertexEditHandler` 新状态：

```ts
private _selectedNodes: Array<{ source: string; layer: string; vertexIds: number[]; coords: [number, number] }> = [];
private _bandStart: { x: number; y: number } | null = null;
```

**行为：**
- `handlePointer` `down`：无 hover（`_hoveredFeature === null`）→ 记录 `_bandStart`，返回 `'exclusive'`（接管手势）；有 hover 且该节点在 `_selectedNodes` 内 → 进入成组拖动；否则维持现状。
- `move`（band 进行中）→ 更新 band 矩形进 edit vertex state，render。
- `up`（band 结束）→ 命中：对每个可编辑图层 feature 的每个弧端点/顶点（`getVertexData` 遍历，投影到屏幕坐标）落在矩形内 → 按节点（coords key）去重收入 `_selectedNodes`；按下时带 shift → 并集，否则替换。band 矩形 < 3px 视为空点 → 清空选择。返回非 exclusive。
- 成组拖动：`_dragFromCoords` 起算 delta；`move` 时对每个选中节点的 `vertexIds` 调 `arcs.transformPoints` 过滤移动（与单点拖动同一通路）；`up` 时每节点生成 `VertexMoveCommand`，合并为一个 `CompositeCommand` push（label `Move N vertices`）。
- `keydown` Delete/Backspace 且选择非空 → 逐节点 `planTopologyNodeDeletion`；任一返回不可删 → `this._map.fire('error', { error: new Error('vertexEdit: selection contains non-deletable nodes') })` 并整体放弃；全部可删 → 执行 + `CompositeCommand` push（label `Delete N vertices`）。
- Esc / 空白单击 / `disable()` / `_onSelectionChange` 同等时机清空 `_selectedNodes`；overlay 渲染选中节点用 selection 色区别于悬停。

- [ ] **Step 1: 写测试**（mock host + 合成 arcs，仿现有 vertex-edit.test.ts 夹具）：框选选中两个节点 → overlay band 状态正确；shift 累加；拖动一个选中节点 → 两个节点坐标同 delta 移动且历史一条 CompositeCommand；Delete → 单条历史；含弧端点的选择 Delete → error 事件且数据不变；Esc 清空。
- [ ] **Step 2-4: 失败 → 实现 → 跑绿（含既有 vertex-edit 测试）。**
- [ ] **Step 5: Commit** `feat: batch vertex selection, move, and delete in vertexEdit`

### Task 8: reshapeFeature handler

**Files:**
- Create: `src/core/handlers/reshape-feature.ts`、`reshape-feature.test.ts`
- Modify: `src/core/handlers/edit-handler-host.ts`（ops Pick 加 `reshapeSelected`）
- Consumes: Task 2 `SketchSession`、Task 3/4 op、Task 1 EditMode

**结构** 复刻 split-feature.ts 的骨架但瘦身：`enable()` 校验选择上下文（同源同层、isPathLayer；复用 split 的 `_resolveSelectionContext` 思路，可提炼共用函数到 `selection-context.ts`——若提炼，split-feature 一并迁移）→ `setEditMode('reshape')` → SketchSession `{ minVertices: 2, resolveSnap }`（snap 目标 = 选中要素弧的顶点/边，逻辑同 split 的 `_findSnapTarget`）→ onFinish 调 `ops.reshapeSelected({ line: vertices })` → `!result.ok` 发 error 事件。`editmodechange !== 'reshape'` 自动 `_quietDisable`。提交节流沿用 `_submissionGeneration` 模式。

- [ ] **Step 1: 写 reshape-feature.test.ts**（mock host 仿 split-feature.test.ts）：启用时无效选择抛错；点击两点 + 右键触发 op 调用且参数为放置坐标；Esc 不提交；op 失败发 error 事件；模式切换自动 disable。
- [ ] **Step 2-4: 失败 → 实现 → 跑绿。Step 5: Commit** `feat: reshapeFeature interaction handler`

### Task 9: ringEdit handler

**Files:**
- Create: `src/core/handlers/ring-edit.ts`、`ring-edit.test.ts`
- Modify: `src/core/handlers/edit-handler-host.ts`（ops Pick 加 `addRing/deleteRing`）

**接口：**

```ts
export interface RingEditOptions { mode?: 'add' | 'delete'; snapThreshold?: number }
// map.ringEdit —— enable() 要求恰好 1 个选中面要素，否则 throw（同 split 的 enable 抛错模式）
```

- `mode: 'add'`：SketchSession `{ minVertices: 3, closeRing: true, resolveSnap }` → onFinish 调 `ops.addRing({ ring })`。
- `mode: 'delete'`：click 直接 `ops.deleteRing({ point: unproject(x, y) })`；不建草图。
- `setOptions({ mode })` 切换时清草图。

- [ ] **Step 1: 写测试**：add 模式三点 + 右键提交（坐标自动闭合）；delete 模式点击提交 unproject 坐标；非单面选择 enable 抛错；op 失败 error 事件。
- [ ] **Step 2-4: 失败 → 实现 → 跑绿。Step 5: Commit** `feat: ringEdit interaction handler`

### Task 10: partEdit handler

同 Task 9 结构，`PartEditOptions { mode?: 'add' | 'delete'; snapThreshold?: number }`：

- `enable()` 要求恰好 1 个选中要素且图层为 polyline/polygon。
- add：面图层 session `{ minVertices: 3, closeRing: true }`；线图层 `{ minVertices: 2 }` → `ops.addPart({ coordinates })`。
- delete：click → 阈值换算 `unproject(x±threshold)` 得数据单位容差 → `ops.deletePart({ point, tolerance })`。
- 测试同构。Commit `feat: partEdit interaction handler`

### Task 11: Emap 接线与导出

**Files:**
- Modify: `src/map/map.ts`（三个 handler 字段、注册、getter：`reshapeFeature/ringEdit/partEdit`）、`src/map/mapshaper-ops.ts` 门面确认、`src/index.ts` 导出（handlers + 全部新类型）、`src/renderer/edit-overlay-renderer.ts`（新模式渲染 draw state + band 矩形）、`src/map/handler-registry.test.ts`（注册/默认禁用/模式互斥断言，仿 split 用例）
- [ ] **Step 1: 写接线测试**（handler-registry：三个 handler 存在、默认禁用、enable 后 `getEditMode()` 为对应模式、互斥切换）。
- [ ] **Step 2-4: 失败 → 实现 → 跑绿。**
- [ ] **Step 5: Commit** `feat: wire reshape/ring/part handlers into Emap and public exports`

### Task 12: EditToolbar + 示例页

**Files:**
- Modify: `src/ui/edit-toolbar.ts`（`EditToolbarOptions` 加 `advancedTools?: boolean`；为 true 追加五个按钮：整形、挖洞、删洞、加部分、删部分，toggle 对应 handler/mode，激活态跟 `editmodechange`）
- Create: `packages/examples/examples/reshape-ring-part/index.html`（结构仿 split-features：clickSelect 负责选择 + 五个工具按钮 + 状态行 + fixture 自动加载）
- Create: `test/examples/reshape-ring-part.test.ts`（执行内联脚本：按钮切换调用了对应 handler、错误进状态行）
- Modify: `docs-meta/examples.ts`（注册；保留该文件中既有的无关用户改动）
- [ ] **Step 1: 写示例测试 → Step 2: 失败 → Step 3: 实现 → Step 4: 跑绿。**
- [ ] **Step 5: Commit** `feat: edit toolbar advanced tools and reshape-ring-part example`

### Task 13: 文档与 CHANGELOG

- Modify: `packages/docs/docs/guides/editing.md` + `packages/docs/i18n/en/docusaurus-plugin-content-docs/current/guides/editing.md`：四个工具各一节（API 示例 + 交互说明 + 校验规则摘要）。
- Modify: `CHANGELOG.md` Unreleased/Added 四条。
- [ ] **Step 1: 写文档与 CHANGELOG。Step 2: Commit** `docs: reshape, batch vertex, ring/part editing`

### Task 14: 全量验证

- [ ] `rtk tsc --noEmit` 干净
- [ ] `rtk vitest run` 全绿
- [ ] GitNexus `detect_changes({scope: 'all'})` 复核影响面符合预期
- [ ] 新增源码文件 prettier 风格与周边一致（不整文件重排既有 dirty 文件）

## Self-Review 记录

- Spec 覆盖：reshape（Task 3/4/8）、顶点批量（Task 7）、ring（Task 5/9）、part（Task 6/10）、基建（Task 1/2）、接线/界面/文档（Task 11/12/13）✔
- 类型一致性：`Contact`、`SketchSessionOptions`、各 Options/Result 在 Produces/Consumes 间一致 ✔
- 显式偏离 spec 的一处：reshape 接入的是整形线"两接触点之间的裁剪子段"而非整条线——保证结果连续（端点搭在目标上的典型画法下两者等价），已在 Task 3 算法第 3 步固定。
