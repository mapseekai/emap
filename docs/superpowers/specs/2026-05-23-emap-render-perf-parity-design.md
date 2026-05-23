# emap 渲染性能对标 mapshaper — 设计文档

- **日期**：2026-05-23
- **状态**：Design — 待评审
- **作者**：Alan + Claude
- **范围**：`src/renderer/`、`src/source/display-arcs.ts`、`src/geo/viewport.ts`、`src/map/map.ts`、`src/core/handler-manager.ts`

## 1. 目标

让 emap 在三类场景下达到 mapshaper 最新 GUI 渲染的同级帧时间：

1. 大数据集（10 万+ 要素）pan/zoom 流畅交互
2. 任意规模数据集 hover 高亮的响应延迟
3. 大规模点云（10 万+ 点）渲染

对比来源：`/Users/zhang/code/emap-reference/mapshaper/src/gui/` 最新版与 emap 当前实现的逐项差异审计（14 项缺失，3 个阶段）。

## 2. 非目标

- 不调整 op 层、`MapshaperAdapter`、`EditHistory`、`Transaction`、`OpResult` 等数据/编辑层
- 不引入 OffscreenCanvas / Worker 渲染（后续工作）
- 不做多 LOD 自适应降级（后续工作）
- 不修复非渲染性能问题
- 不引入 raster 图层 fast-nav（emap 暂无 raster）

## 3. 顶层架构原则

1. **零回归**：所有现有 API 与默认视觉行为保持。新行为通过新选项 opt-in，或在等效默认值下保持视觉一致。
2. **可独立验证**：3 个 PR 各自有清晰的 perf 基准/视觉对照，可单独 ship/revert。
3. **逐层隔离**：每个 PR 限定文件集合，互不阻塞。
4. **测量先行**：每个 PR 落地前先固定基线（截图、帧耗时）。

## 4. 交付物分阶段

3 个独立 PR，按 Phase A → B → C 顺序：

| PR | 阶段 | 工作量 | 视觉影响 | 风险 |
|----|------|-------|---------|------|
| PR1 | Phase A — 低风险快赢 | ~1.5h | 仅 fill rule 改 nonzero 默认（可选项覆盖） | 低 |
| PR2 | Phase B — 点云快路径 | ~2h | 无 | 低 |
| PR3 | Phase C — fast-nav 架构 | ~1.5 天 | 无（默认行为不变） | 中（架构重构） |

---

## 5. PR1 / Phase A — 低风险快赢

**目标**：6 项独立的渲染优化，无架构变更。

**改动文件**

- `src/renderer/canvas-painter.ts`（主要）
- `src/geo/viewport.ts`（MIN_PATH_LEN 常量）
- `src/map/layer.ts`（LayerSpecification 新增可选 `fillRule`）
- `src/renderer/painter.ts`（透传 `fillRule`）

**6 项改动**

| ID | 子项 | 位置 | 改法 | 视觉影响 |
|----|------|------|------|---------|
| A1 | drawArcs 批量 25→100 | `canvas-painter.ts:30,62` | 常量改 100；同步注释 | 无 |
| A2 | MIN_PATH_LEN 0.1→0.35 | `viewport.ts:212-214` | 常量改 0.35（mapshaper `gui-canvas.mjs:77` 等值） | 极小弧塌缩，整体不可见 |
| A3 | scale<1.1 跳过 shape filter | painter 调用 shape filter 前加 `if (ext.scale() < 1.1) return null` | 新增 | 全图视图省 bbox 计算 |
| A4 | styleIndex 按 style 预分组 | `drawPaths`、`drawPolygonFill` 按 styleKey 分组（fillStyle+strokeStyle+lineWidth+lineCap+lineJoin+opacity 拼接）逐组开 `beginPath` | 重构 ~30 行 | 无（同色组内逻辑等价） |
| A5 | iterator clipping at scale>100 | 新增 `protectIterForDrawing(iter, expandedBounds)`，仅在 `ext.scale()>100` 时调用 | 新增辅助函数 | 修复极端缩放下 canvas 坐标溢出（**实为修 bug**） |
| A6 | fill rule + fill snap | `drawPolygonFill` 改用 `ctx.fill()`（nonzero 默认，对齐 `gui-canvas.mjs:688`）；路径吸附改用 `roundToPix`（整数，对齐 `gui-canvas.mjs` 中 fill 路径的 roundToPix）；`LayerSpecification.fillRule?: 'nonzero'\|'evenodd'`，默认 nonzero | LayerSpecification 新选项 | **视觉变更**：复杂多边形（洞、自交、multipart 重叠）的填充判定变化。例子页面对比 |

> **mapshaper 0.7.19 实际行为说明**：mapshaper 始终使用默认 nonzero（无 fillRule 选项），没有提供切换。emap 的 A6 改动是"对齐默认 + 保留 evenodd 作为 opt-in"，是**emap 自己的扩展**而非 0.7 新功能。可选择降级为仅改默认（不引入选项）。

**测试计划**

- 单元：现有 `canvas-painter.test.ts` 全绿；新增 styleIndex 单元（输入 mixed styles → 分组数 = 唯一 style 数）；A5 在 scale>100 时确实裁剪 iterator
- 视觉：`test/examples/box-select.html`、`lasso-select.html`、世界地图大数据 example 截图对比（pan/zoom、全图视图、放大到 scale>100）。**先 commit 基线截图，再做改动。**
- Perf 基线：临时 FPS overlay 记录 pan/zoom 平均帧耗时（前后对比）

**A6 视觉风险缓解**：PR1 第一个 commit 为"基线截图"专用 commit，之后改动作为后续 commit 对照。

---

## 6. PR2 / Phase B — 点云快路径

**目标**：纯点要素且 dot 直径 ≤ 6px 时绕开 canvas 原语，直接写 ImageData。**对线/面零影响**。

**改动文件**

- `src/renderer/canvas-painter.ts` — 新增 `drawSquareDotsFaster()`、`getPixelColorFunction()`
- `src/renderer/painter.ts` — 在 `drawPoints` 路径分流：满足条件走快路径，否则保留现有 `ctx.arc/ctx.fillRect` 路径

**3 项改动**

| ID | 子项 | 实现 | 触发条件 |
|----|------|------|---------|
| B1 | `getPixelColorFunction(rgbaStr)` | 内部 cache `Map<string, uint32>`，把 css 颜色字符串映射为 little-endian RGBA uint32 | 仅 B2 调用时使用 |
| B2 | `drawSquareDotsFaster(points, color, size, ctx)` | 一次 `getImageData(0,0,w,h)` 抓位图 → `new Uint32Array(imageData.data.buffer)` → 双重循环写像素（带 size 扩展和 canvas 边界裁剪）→ `putImageData` 回画布 | size ≤ 6（对齐 `gui-canvas.mjs:306` 的 `if (size <= 6)`），**点数无下限** |
| B3 | `painter.drawPoints` 路径分流 | `if (canUseFastPath(layer, points)) drawSquareDotsFaster(...) else fallback()` | 单一 fillStyle、无 stroke、无 opacity、size 整数、size ≤ 6 |

**关键约束**（来自 mapshaper `gui-canvas.mjs:334-372`）

- 单色批量：fast path 一次只画**一种颜色**。若数据驱动颜色，按颜色 group 后多次调用。
- **点数无下限**：mapshaper 在 size ≤ 6 时无条件启用 fast path，emap 对齐此行为
- size > 6 退回普通路径（性能交叉点）。
- 有 stroke / opacity < 1 退回普通路径。
- DPI/retina：操作 device pixel 空间，按 `canvas.width/height` 计算，绕过 `ctx.scale(dpr)`。

**测试计划**

- 单元：10k 点 → `putImageData` 调用 1 次；颜色 cache 第二次命中 100%；分流条件每个分支单测
- 视觉：新增 `test/examples/dots-stress.html`（10k/100k 点），fast path 与 fallback 像素 diff ≤ 1px round-off
- Perf 基线：10 万点帧时间，目标 fast path < 10ms vs fallback > 200ms

**PR 边界**：本 PR 不引入任何线/面行为改动，不修改 LayerSpecification 现有字段，仅新增内部辅助。出问题可单独 revert。

---

## 7. PR3 / Phase C — fast-nav 架构

**目标**：pan/zoom 慢帧时用 CSS transform 复用上一帧位图，交互结束再真正重绘；hover 跳过底图重绘；引入帧测量与 settle 防抖。

### 7.1 — RenderRequest 软参数

`src/map/types.ts` 新增：

```ts
export type RenderAction = 'redraw' | 'nav' | 'hover';

export interface RenderRequest {
  action?: RenderAction;       // 默认 'redraw'（对齐 mapshaper gui-map.mjs:485 default）
  navDelta?: AffineDelta;      // 'nav' 时携带 pan/zoom 增量，用于 CSS transform
}

export interface AffineDelta { tx: number; ty: number; sx: number; sy: number; }
```

`Emap.render(req?: RenderRequest)`，默认参数等同现有行为。**完全向后兼容**。

对标 mapshaper `gui-map.mjs:196,201,485`：内部默认 action 为空字符串 `''`，被规范化为 `'redraw'`；显式传 `'hover'` 或 `'nav'`。3 类对应：`'redraw'`（全量重绘）/ `'nav'`（pan/zoom）/ `'hover'`。编辑、setView、resize、数据变化等均走 `'redraw'`。

**调用方迁移**

| 调用方 | action |
|--------|--------|
| `DragPanHandler`、`ScrollZoomHandler` | `nav` + `navDelta` |
| `HandlerManager` 的 hover 派发 | `hover` |
| 编辑命令 apply/undo、Transaction commit/rollback、`setView`、数据变化、resize、初始 render | 不传或 `redraw`（默认） |

### 7.2 — Overlay 复用

`src/renderer/edit-overlay-renderer.ts` → 改名 `src/renderer/overlay-renderer.ts`。保留旧导出名做 alias，避免破坏 example。

新增能力：hover/selection highlight 提交槽位。`HighlightManager` 提交目标由 main painter 切换为 OverlayRenderer。

### 7.3 — RenderScheduler 新模块

`src/renderer/render-scheduler.ts`，由 `Emap` 持有：

```ts
export class RenderScheduler {
  constructor(private _map: Emap, private _overlay: OverlayRenderer) {}
  schedule(req: RenderRequest): void;
  private _lastFullFrameMs = 0;
  private _fastNavActive = false;
  private _pendingSettle: number | null = null;
  private _snapshot: ViewportSnapshot | null = null;
}
```

**决策表**

| action | _lastFrameMs ≤ 100ms | _lastFrameMs > 100ms |
|--------|----------------------|----------------------|
| `redraw`（默认）| 立即全量重绘 | 立即全量重绘 |
| `hover` | 仅 overlay 重绘 | 仅 overlay 重绘 |
| `nav`  | 立即全量重绘 | **fast-nav**：CSS transform 主 canvas + settle 防抖 |

### 7.4 — fast-nav 私有方法

- `_captureSnapshot()` — 记录最后一次完整渲染的 viewport bounds（在 main render 完成后调用）
- `_applyFastTransform(navDelta)` — `mainCanvas.style.transform = 'translate(..) scale(..)'`，`transformOrigin = 'top left'`
- `_clearFastTransform()` — 清除 transform，准备真渲染
- `_markRedrawPending()` — 标记"有未提交的快路径帧"
- `_settleNow()` / `_cancelSettle()` — 真渲染并清状态
- 触发 settle 的事件：`HandlerManager` `interactionend` 事件、200ms 退路径定时器、`visibilitychange`、dpr 改变

### 7.5 — flushCanvas + 帧测量

```ts
private _flushCanvas() {
  try { this._ctx.getImageData(0, 0, 1, 1); } catch {}
}
private _measureFullFrame(fn: () => void) {
  const t0 = performance.now();
  fn();
  this._flushCanvas();             // 强制 GPU commit（对齐 gui-layer-renderer.mjs:182-184）
  this._lastFrameMs = performance.now() - t0;  // 直接覆盖，无平滑
}
const SLOW_FRAME_MS = 100;          // 对齐 gui-layer-renderer.mjs:31
const FAST_SETTLE_FALLBACK_MS = 2000; // 对齐 gui-layer-renderer.mjs:36
```

`shouldUseFastNav()` 判定（对齐 `gui-layer-renderer.mjs:209-215`）：`_snapshot` 存在 + `_lastFrameMs > SLOW_FRAME_MS` + canvas 尺寸未变 + pixRatio 未变。

**与 mapshaper 0.7.19 完全对齐：直接用单帧测量值，不做 EMA 平滑、不做暖机跳过**。冷启动首次 nav 若帧>100ms，下一次 nav 直接进入 fast-nav——这是 mapshaper 的设计，emap 对齐之。

> 如果实测发现冷启动误判明显，再单独加 EMA 作为 emap 扩展（不在本次范围）。

### 7.6 — HandlerManager 协作

`src/core/handler-manager.ts`：

- pan/zoom handler 在 `pointerdown`/`wheel` 后，每次帧请求带 `action: 'nav'` + `navDelta`
- 释放（`pointerup` / `wheel` 静止 200ms）触发 `map.fire('interactionend')`
- `RenderScheduler` 监听 `interactionend` 调用 `_settleNow()`

### 7.7 — Hover 解耦

`hover/selection highlight` 不再画在主 canvas 上，全部迁移到 `OverlayRenderer`。`HighlightManager` 提交目标改为 overlay。

### 7.8 — 视觉/正确性风险及缓解

| 风险 | 缓解 |
|------|------|
| CSS transform 期间 highlight/edit 错位 | 这两类一律走 overlay，永不被 transform |
| 慢机型误判 / SLOW_FRAME_MS 不准 | 对齐 mapshaper 行为，单帧测量直接判定；如实测有问题再加 EMA |
| 隐藏 tab 切回 settle 不触发 | `FAST_SETTLE_FALLBACK_MS = 2000` 兜底定时器（对齐 mapshaper:36）+ `visibilitychange` 监听 |
| 旧调用未传 action 退化为 'main' | 这是设计意图（向后兼容） |
| dpr 改变时 transform 数学失效 | dpr 变化触发立即 settle + 重新 snapshot |

### 7.9 — 测试计划

- 单元：`RenderScheduler` 决策表逐格测试（mock 帧耗时与 action）
- 单元：`_applyFastTransform` 在给定 navDelta 下输出正确的 translate/scale
- 视觉：pan/zoom 大数据 example 录屏对比 before/after
- 正确性：pan + 同时悬停 → highlight 不漂移；快速 pan 释放后 settle 触发；hover-only 不重画底图（spy `_measureFullFrame` 调用次数）
- 性能：10 万 feature pan，目标 60fps（vs 当前 ~15fps）

### 7.10 — `_settleRequested` 竞态 latch（对齐 mapshaper）

mapshaper `gui-layer-renderer.mjs:45-57, 85, 259-261` 处理 `'map_interaction_end'` 事件在 in-flight `'nav'` 帧之前到达的情况：

- 在 fast-nav 帧排队期间收到 `interactionend`：设置 `_settleRequested = true`
- 当前 fast-nav 帧 callback 中检查此 flag → 若 true，立即追加全量真渲染而非等待 fallback 定时器
- 防止"用户停手了但 fast-nav 模糊画面还停留 2s"

emap 的 `RenderScheduler` 复刻同一 latch。

### 7.11 — 与 mapshaper 行为差异的明示

| 项 | mapshaper 0.7.19 | emap | 说明 |
|----|-----------------|------|------|
| action 默认 | `''` 规范化 `'redraw'` | `'redraw'` 显式 | 行为等价 |
| 帧测量平滑 | 无（raw 单帧） | 无（对齐） | 实测后再决定 |
| Raster fast-nav | `layersHaveRasters()` 跳过 raster preview，settle 时刷 | **不适用** | emap 暂无 raster 图层 |
| SVG symbol reposition | `_svg.reposition()` 即便 fast-nav 也更新 | **不适用** | emap 不渲染 SVG 符号到独立层 |

### 7.12 — 不在本次范围

- 多 LOD 自适应降级
- Worker 离屏 canvas
- raster 图层（emap 暂未支持）
- SVG symbol 独立图层（emap 暂未支持）
- EMA 帧测量平滑（实测后再评估）

---

## 8. 跨阶段共享决策

- 文件命名一律 kebab-case，导出符号 PascalCase（沿用现有约定）
- 性能基线测量：临时 FPS overlay 仅在开发模式启用，不进生产 bundle
- 视觉对比：使用 `test/examples/` 下 example 截图，PR 描述附 before/after

## 9. 预期收益

| 场景 | 提速 | 来源 |
|------|------|------|
| pan/zoom (100k+ features) | **3–5×** | PR3 fast-nav |
| hover 高亮（任意规模） | **2–3×** | PR3 skipMainLayerRedraw |
| 点云（10 万+ 点） | **10–50×** | PR2 drawSquareDotsFaster |
| 多色矢量图层 | **1.5–2×** | PR1 styleIndex + batch=100 |

## 10. 后续规划（不在本次）

- 多 LOD 自适应（slow frame → 降级）
- OffscreenCanvas + Worker 离屏渲染
- 跨图层 styleIndex 合并
- 行业级数据集 perf 基准套件
