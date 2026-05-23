# PR1 / Phase A — 低风险快赢 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 6 项独立的渲染优化对齐到 mapshaper 0.7.19，零架构变更。

**Architecture:** 直接修改 `canvas-painter.ts`、`viewport.ts`、`painter.ts`、`layer.ts`。无新模块。所有改动可逐项 revert。

**Tech Stack:** TypeScript, Canvas2D, Vitest, Rollup。Windows 用 `cmd /c npm`。

**Spec:** `docs/superpowers/specs/2026-05-23-emap-render-perf-parity-design.md` 第 5 节

---

## File Structure

| 文件 | 职责 | 改动类型 |
|------|------|---------|
| `src/renderer/canvas-painter.ts` | A1 批量、A4 styleIndex、A5 iterator clip、A6 fill rule/snap | 修改 |
| `src/geo/viewport.ts` | A2 MIN_PATH_LEN、A3 scale<1.1 短路 | 修改 |
| `src/renderer/painter.ts` | 透传 fillRule | 修改 |
| `src/map/layer.ts` | LayerSpecification 新增 fillRule 选项 | 修改 |
| `src/renderer/canvas-painter.test.ts` | 新增 styleIndex、iterator clip、fill rule 单元测试 | 修改 |
| `src/geo/viewport.test.ts` | 新增 MIN_PATH_LEN 与 scale<1.1 单元测试 | 修改 |

---

## Task 1: 建立性能与视觉基线

**Files:**
- Create: `docs/superpowers/baselines/2026-05-23-pr1-baseline.md`

- [ ] **Step 1: 启动 dev server**

Run: `cmd /c npm run dev`
Expected: server 起来后能打开 `test/examples/box-select.html`

- [ ] **Step 2: 记录基线截图与帧时**

打开浏览器 DevTools → Performance，对以下三个 example 各录制一次 5s 的 pan/zoom：
- `test/examples/box-select.html`
- `test/examples/lasso-select.html`
- 任一含较大数据集的 example

把截图与帧时数（FPS 平均/中位/p99）写入 `docs/superpowers/baselines/2026-05-23-pr1-baseline.md`。

- [ ] **Step 3: Commit 基线**

```bash
git add docs/superpowers/baselines/2026-05-23-pr1-baseline.md
git commit -m "perf(render): record PR1 baseline metrics and screenshots"
```

---

## Task 2: A1 — drawArcs/drawPaths 批量 25→100

**Files:**
- Modify: `src/renderer/canvas-painter.ts:30,62`
- Test: `src/renderer/canvas-painter.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/renderer/canvas-painter.test.ts` 加：

```ts
it('drawArcs flushes stroke() every 100 arcs (batch size = 100)', () => {
  const ctx = makeMockCtx();
  const arcs = makeMockArcs(250); // 250 fake arcs
  const painter = new CanvasPainter(makeMockCanvas(ctx));
  painter.drawArcs(arcs, { color: '#000', width: 1 });

  // 250 / 100 = 2 mid-batch flushes + 1 final = 3 stroke() calls
  expect(ctx.stroke).toHaveBeenCalledTimes(3);
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cmd /c npx vitest run src/renderer/canvas-painter.test.ts -t "batch size = 100" --reporter=dot`
Expected: FAIL — current batch is 25 → expect 11 stroke calls

- [ ] **Step 3: 改常量**

`src/renderer/canvas-painter.ts:30,62` 两处 `batchSize = 25` 改为 `batchSize = 100`，并更新注释：

```ts
const batchSize = 100; // Aligned with mapshaper 0.7.19 (gui-canvas.mjs:432)
```

- [ ] **Step 4: 验证测试通过**

Run: `cmd /c npx vitest run src/renderer/canvas-painter.test.ts -t "batch size = 100" --reporter=dot`
Expected: PASS

- [ ] **Step 5: 完整测试**

Run: `cmd /c npm run test:run`
Expected: 全绿（若现有测试硬编码了 batch=25 数字则更新它们）

- [ ] **Step 6: Commit**

```bash
git add src/renderer/canvas-painter.ts src/renderer/canvas-painter.test.ts
git commit -m "perf(render): bump arc/path batch size 25 to 100 (mapshaper parity)"
```

---

## Task 3: A2 — MIN_PATH_LEN 0.1 → 0.35

**Files:**
- Modify: `src/geo/viewport.ts:22`
- Test: `src/geo/viewport.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('getArcFilter uses MIN_PATH_LEN = 0.35 (mapshaper parity)', () => {
  const vp = new Viewport(800, 600);
  vp.setTransform(/* mx such that 1px = 1 world unit */);
  const arcs = {
    arcIsSmaller: vi.fn((_i, minLen) => minLen > 0.3),
    arcIntersectsBBox: () => true,
  };
  const filter = vp.getArcFilter(arcs);
  filter(0);
  // pixelSize * 0.35 should be passed when pixelSize = 1 → minLen = 0.35
  expect(arcs.arcIsSmaller).toHaveBeenCalledWith(0, 0.35);
});
```

- [ ] **Step 2: 验证失败**

Run: `cmd /c npx vitest run src/geo/viewport.test.ts -t "MIN_PATH_LEN" --reporter=dot`
Expected: FAIL

- [ ] **Step 3: 改常量**

`src/geo/viewport.ts:22`：

```ts
const MIN_PATH_LEN = 0.35; // Aligned with mapshaper 0.7.19 (gui-canvas.mjs:77)
```

- [ ] **Step 4: 验证通过**

Run: `cmd /c npx vitest run src/geo/viewport.test.ts -t "MIN_PATH_LEN" --reporter=dot`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/geo/viewport.ts src/geo/viewport.test.ts
git commit -m "perf(render): MIN_PATH_LEN 0.1 to 0.35 (mapshaper parity)"
```

---

## Task 4: A3 — scale<1.1 跳过 shape filter

**Files:**
- Modify: `src/geo/viewport.ts` — 在 `getArcFilter` 内加 scale 检查
- Test: `src/geo/viewport.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('returns null filter when ext.scale() < 1.1 (full-extent skip)', () => {
  const vp = new Viewport(800, 600);
  vp.setTransform(makeInitialTransform()); // mapScale = 1.0
  const filter = vp.getShapeFilter?.({});
  expect(filter).toBeNull();
});
```

> 注：若 emap 没有 `getShapeFilter()`（当前只 `getArcFilter`），则在 `getArcFilter` 中加 scale 检查；测试改为 fast-path 时 `arcIsSmaller` 不被调用。

- [ ] **Step 2: 验证失败**

Run: `cmd /c npx vitest run src/geo/viewport.test.ts -t "scale" --reporter=dot`
Expected: FAIL

- [ ] **Step 3: 实现 scale 短路**

`src/geo/viewport.ts` `getArcFilter` 函数起始处加：

```ts
const mapScale = this._initialMX > 0 ? Math.abs(this._transform.mx) / this._initialMX : 1;
if (mapScale < 1.1) {
  // Mapshaper gui-canvas.mjs:103 — skip per-arc bbox at full-extent zoom
  return (_i: number) => true;
}
```

- [ ] **Step 4: 验证通过**

Run: `cmd /c npx vitest run src/geo/viewport.test.ts --reporter=dot`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/geo/viewport.ts src/geo/viewport.test.ts
git commit -m "perf(render): skip arc bbox filter at scale less than 1.1 (mapshaper parity)"
```

---

## Task 5: A5 — protectIterForDrawing at scale>100

**Files:**
- Modify: `src/renderer/canvas-painter.ts` — 新增 `_protectIter` 私有方法
- Test: `src/renderer/canvas-painter.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('clips iterator to expanded bounds when scale > 100', () => {
  const ctx = makeMockCtx();
  const painter = new CanvasPainter(makeMockCanvas(ctx));
  painter.setTransform(makeTransformWithScale(150));
  // Far-off coords; should not be drawn past expanded bounds
  const iter = makeIterWithCoords([[1e7, 1e7], [0, 0]]);
  (painter as any).drawPathSnapping(iter, ctx);
  // Verify no moveTo/lineTo received coords > 1e6 (clipped)
  expect(ctx.moveTo.mock.calls.every(([x, y]) => Math.abs(x) < 1e6 && Math.abs(y) < 1e6)).toBe(true);
});
```

- [ ] **Step 2: 验证失败**

Run: `cmd /c npx vitest run src/renderer/canvas-painter.test.ts -t "clips iterator" --reporter=dot`
Expected: FAIL

- [ ] **Step 3: 实现 iterator clipping**

在 `canvas-painter.ts` 加：

```ts
private _shouldProtectIter(): boolean {
  if (this._transform._initialMX === undefined) return false;
  const scale = Math.abs(this._transform.mx) / (this._transform._initialMX || 1);
  return scale > 100;
}

private _clampCoord(v: number): number {
  // Mapshaper gui-canvas.mjs:628 — clamp to expanded bounds
  const MAX = 1_000_000;
  return v > MAX ? MAX : v < -MAX ? -MAX : v;
}
```

在 `drawPathSnapping` 内坐标计算后通过 `_clampCoord` 处理（仅 scale>100 时启用）：

```ts
let x = (iter.x * mx + bx) * 2 | 0;
let y = (iter.y * my + by) * 2 | 0;
if (protect) { x = this._clampCoord(x); y = this._clampCoord(y); }
```

- [ ] **Step 4: 验证通过**

Run: `cmd /c npx vitest run src/renderer/canvas-painter.test.ts --reporter=dot`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/canvas-painter.ts src/renderer/canvas-painter.test.ts
git commit -m "perf(render): clamp drawing coords at scale greater than 100 (protectIterForDrawing)"
```

---

## Task 6: A4 — styleIndex 按 style 预分组

**Files:**
- Modify: `src/renderer/canvas-painter.ts` — `drawPaths` 重构为分组
- Test: `src/renderer/canvas-painter.test.ts`

> 当前 `drawPaths` 签名一次只接受一个 style；分组语义在调用方有意义（`painter.ts` 接到多 layer 时分组）。本任务把分组逻辑封装到一个 helper，调用方一次传 `shapeStyles[]`，painter 内部分组。

- [ ] **Step 1: 写失败测试**

```ts
it('drawPathsBatch groups shapes by styleKey before stroke', () => {
  const ctx = makeMockCtx();
  const painter = new CanvasPainter(makeMockCanvas(ctx));
  const shapeStyles = [
    { shape: makeShape(), style: { color: '#f00', width: 1 } },
    { shape: makeShape(), style: { color: '#0f0', width: 1 } },
    { shape: makeShape(), style: { color: '#f00', width: 1 } },
  ];
  (painter as any).drawPathsBatch(shapeStyles, makeArcs());
  // 2 unique styles → 2 strokeStyle assignments + 2 final stroke() calls
  const colors = ctx.strokeStyle.mock?.calls.map((c: any) => c[0]) ?? [];
  expect(new Set(colors).size).toBe(2);
});
```

- [ ] **Step 2: 验证失败**

Run: `cmd /c npx vitest run src/renderer/canvas-painter.test.ts -t "styleKey" --reporter=dot`
Expected: FAIL

- [ ] **Step 3: 实现 styleIndex 分组**

在 `canvas-painter.ts` 加：

```ts
private _styleKey(s: StrokeStyle): string {
  return `${s.color || '#333'}|${s.width ?? 1}|${(s as any).lineCap || 'round'}|${(s as any).lineJoin || 'round'}|${(s as any).opacity ?? 1}`;
}

drawPathsBatch(items: Array<{ shape: any; style: StrokeStyle }>, arcs: ArcCollection): void {
  // Group by styleKey (mapshaper gui-canvas.mjs:241-281 styleIndex pattern)
  const groups = new Map<string, { style: StrokeStyle; shapes: any[] }>();
  for (const it of items) {
    if (it.style.width === 0) continue;
    const key = this._styleKey(it.style);
    let g = groups.get(key);
    if (!g) { g = { style: it.style, shapes: [] }; groups.set(key, g); }
    g.shapes.push(it.shape);
  }
  for (const g of groups.values()) {
    this.drawPaths(g.shapes, g.style, arcs);
  }
}
```

- [ ] **Step 4: 验证通过**

Run: `cmd /c npx vitest run src/renderer/canvas-painter.test.ts --reporter=dot`
Expected: PASS

- [ ] **Step 5: 在 painter.ts 用 drawPathsBatch（如适用）**

如果 `painter.ts` 当前多 layer 循环调 `drawPaths`，改为先收集后单次调 `drawPathsBatch`。这一步是性能收益的来源——同 layer 内已经是单 style，分组带来的提升要在多 layer 单次渲染中体现。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/canvas-painter.ts src/renderer/painter.ts src/renderer/canvas-painter.test.ts
git commit -m "perf(render): styleIndex grouping for multi-layer path batching"
```

---

## Task 7: A6 — fill rule nonzero 默认 + integer snap

**Files:**
- Modify: `src/renderer/canvas-painter.ts` — `drawPolygonFill` 改 fill 调用与 snap
- Modify: `src/map/layer.ts` — LayerSpecification 加 `fillRule?: 'nonzero' | 'evenodd'`
- Modify: `src/renderer/painter.ts` — 透传 fillRule
- Test: `src/renderer/canvas-painter.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('drawPolygonFill defaults to nonzero fill rule (no arg to ctx.fill)', () => {
  const ctx = makeMockCtx();
  const painter = new CanvasPainter(makeMockCanvas(ctx));
  painter.drawPolygonFill([makeShape()], makeArcs(), '#000');
  // Calls should be ctx.fill() — no string arg (= nonzero default)
  expect(ctx.fill).toHaveBeenCalledWith();
  expect(ctx.fill).not.toHaveBeenCalledWith('evenodd');
});

it('drawPolygonFill honors explicit evenodd fillRule option', () => {
  const ctx = makeMockCtx();
  const painter = new CanvasPainter(makeMockCanvas(ctx));
  painter.drawPolygonFill([makeShape()], makeArcs(), '#000', undefined, undefined, 'evenodd');
  expect(ctx.fill).toHaveBeenCalledWith('evenodd');
});

it('drawPolygonFill uses integer pixel snapping (roundToPix)', () => {
  const ctx = makeMockCtx();
  const painter = new CanvasPainter(makeMockCanvas(ctx));
  painter.setTransform(/* identity */);
  painter.drawPolygonFill([makeShapeWithCoord(10.7, 20.3)], makeArcs(), '#000');
  // moveTo should receive integer (10 or 11, not 10.5)
  const [x, y] = ctx.moveTo.mock.calls[0];
  expect(Number.isInteger(x)).toBe(true);
  expect(Number.isInteger(y)).toBe(true);
});
```

- [ ] **Step 2: 验证失败**

Run: `cmd /c npx vitest run src/renderer/canvas-painter.test.ts -t "nonzero|evenodd|integer pixel" --reporter=dot`
Expected: FAIL (3 测试)

- [ ] **Step 3: 实现签名变更**

`src/renderer/canvas-painter.ts` `drawPolygonFill` 增加 `fillRule` 参数：

```ts
drawPolygonFill(
  shapes: any[],
  arcs: /* same */,
  fillColor: string,
  filter?: (i: number) => boolean,
  opacity?: number,
  fillRule: 'nonzero' | 'evenodd' = 'nonzero',  // mapshaper default
): void {
  // ... existing setup ...
  
  // Mid-batch fill — use chosen fillRule
  if (counts > 0 && counts >= batchSize) {
    fillRule === 'evenodd' ? ctx.fill('evenodd') : ctx.fill();
    ctx.beginPath();
    counts = 0;
  }

  // Inside shape loop — replace half-pixel snap with integer snap:
  let x = Math.round(iter.x * mx + bx);
  let y = Math.round(iter.y * my + by);
  ctx.moveTo(x, y);
  while (iter.hasNext()) {
    xp = x; yp = y;
    x = Math.round(iter.x * mx + bx);
    y = Math.round(iter.y * my + by);
    if (x !== xp || y !== yp) ctx.lineTo(x, y);
  }

  // Final fill at end:
  fillRule === 'evenodd' ? ctx.fill('evenodd') : ctx.fill();
}
```

- [ ] **Step 4: 透传 fillRule**

`src/map/layer.ts` `LayerSpecification` 加：

```ts
fillRule?: 'nonzero' | 'evenodd';
```

`src/renderer/painter.ts` 中调 `drawPolygonFill` 处把 `layer.fillRule` 传下去。

- [ ] **Step 5: 验证通过**

Run: `cmd /c npx vitest run src/renderer/canvas-painter.test.ts --reporter=dot`
Expected: PASS

- [ ] **Step 6: 视觉验证**

启动 dev server，加载 `test/examples/box-select.html` 与 `lasso-select.html`，对比 PR1 baseline 截图。复杂多边形（带洞）是否仍正确填充。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/canvas-painter.ts src/map/layer.ts src/renderer/painter.ts src/renderer/canvas-painter.test.ts
git commit -m "perf(render): nonzero fill rule default + integer pixel snap for fills"
```

---

## Task 8: 整体回归 + 类型检查

- [ ] **Step 1: TypeCheck**

Run: `cmd /c npm run typecheck`
Expected: 0 errors

- [ ] **Step 2: 全量测试**

Run: `cmd /c npm run test:run`
Expected: 全绿

- [ ] **Step 3: Build**

Run: `cmd /c npm run build`
Expected: 无 build error

- [ ] **Step 4: 性能对比记录**

打开 baseline 中的 example，重新录帧时数。在 `docs/superpowers/baselines/2026-05-23-pr1-baseline.md` 加 "After PR1" 一节。

- [ ] **Step 5: Final commit**

```bash
git add docs/superpowers/baselines/2026-05-23-pr1-baseline.md
git commit -m "perf(render): PR1 phase A perf comparison data"
```

---

## 验收标准

- [x] 6 个常量/行为对齐 mapshaper 0.7.19（A1-A6）
- [x] 所有现有测试通过
- [x] 新增的 6 个测试通过（A1 批量、A2 MIN_PATH_LEN、A3 scale<1.1、A4 styleKey、A5 clamp、A6 fillRule）
- [x] typecheck 全绿
- [x] build 成功
- [x] 视觉对比无非预期回归（A6 复杂多边形除外，按设计应仍正确）
