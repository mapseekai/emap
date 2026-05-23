# PR2 / Phase B — 点云快路径 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在纯点要素且 `size ≤ 6` 时绕过 canvas 原语，直接写 `Uint32Array` 像素。10×–100× 提速大点云。

**Architecture:** 在 `canvas-painter.ts` 新增 `drawSquareDotsFaster()` + `getPixelColorFunction()` 两个内部辅助。`painter.ts` 中点渲染路径加分流，满足条件走快路径，否则保留现有 fallback。

**Tech Stack:** TypeScript, Canvas2D `getImageData`/`putImageData`, Uint32Array, Vitest。

**Spec:** `docs/superpowers/specs/2026-05-23-emap-render-perf-parity-design.md` 第 6 节

**前置：** PR1 已 land。

---

## File Structure

| 文件 | 职责 | 改动类型 |
|------|------|---------|
| `src/renderer/canvas-painter.ts` | 新增 `drawSquareDotsFaster()`、`getPixelColorFunction()`、`canUseFastDotPath()` | 修改 |
| `src/renderer/painter.ts` | `drawPoints` 路径分流 | 修改 |
| `src/renderer/canvas-painter.test.ts` | 新增快路径与颜色 cache 单测 | 修改 |
| `test/examples/dots-stress.html` | 10k/100k 点压力测试 example | 新建 |

---

## Task 1: B1 — getPixelColorFunction 颜色 memoization

**Files:**
- Modify: `src/renderer/canvas-painter.ts`
- Test: `src/renderer/canvas-painter.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { getPixelColorFunction } from './canvas-painter';

it('getPixelColorFunction caches rgba string to uint32 conversion', () => {
  const fn = getPixelColorFunction();
  const a = fn('rgba(255, 0, 0, 1)');
  const b = fn('rgba(255, 0, 0, 1)');
  expect(a).toBe(b);
  expect(typeof a).toBe('number');
});

it('getPixelColorFunction converts rgba to little-endian uint32', () => {
  const fn = getPixelColorFunction();
  const v = fn('rgba(0, 0, 0, 1)'); // black opaque
  // Little-endian: alpha is MSB, red is LSB
  expect((v >>> 24) & 0xff).toBe(255); // alpha
  expect(v & 0xff).toBe(0); // red
});
```

- [ ] **Step 2: 验证失败**

Run: `cmd /c npx vitest run src/renderer/canvas-painter.test.ts -t "getPixelColorFunction" --reporter=dot`
Expected: FAIL — function not exported

- [ ] **Step 3: 实现 getPixelColorFunction**

在 `src/renderer/canvas-painter.ts` 加 module-level export（对齐 mapshaper `gui-canvas.mjs:115-130`）：

```ts
export function getPixelColorFunction(): (rgba: string) => number {
  const cache = new Map<string, number>();
  // 1×1 canvas to parse arbitrary CSS color strings via the browser
  const cnv = document.createElement('canvas');
  cnv.width = 1; cnv.height = 1;
  const cx = cnv.getContext('2d')!;
  return (rgba: string): number => {
    const cached = cache.get(rgba);
    if (cached !== undefined) return cached;
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = rgba;
    cx.fillRect(0, 0, 1, 1);
    const px = new Uint32Array(cx.getImageData(0, 0, 1, 1).data.buffer);
    const v = px[0];
    cache.set(rgba, v);
    return v;
  };
}
```

- [ ] **Step 4: 验证通过**

Run: `cmd /c npx vitest run src/renderer/canvas-painter.test.ts -t "getPixelColorFunction" --reporter=dot`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/canvas-painter.ts src/renderer/canvas-painter.test.ts
git commit -m "perf(render): add getPixelColorFunction with rgba to uint32 memoization"
```

---

## Task 2: B2 — drawSquareDotsFaster 直接写像素

**Files:**
- Modify: `src/renderer/canvas-painter.ts`
- Test: `src/renderer/canvas-painter.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('drawSquareDotsFaster writes pixels directly via putImageData (single call)', () => {
  const canvas = makeRealCanvas(100, 100);
  const ctx = canvas.getContext('2d')!;
  const putSpy = vi.spyOn(ctx, 'putImageData');
  const painter = new CanvasPainter(canvas);
  const points: Array<[number, number]> = [[10, 10], [20, 20], [30, 30]];
  (painter as any).drawSquareDotsFaster(points, 'rgba(0,0,0,1)', 2, ctx);
  expect(putSpy).toHaveBeenCalledTimes(1);
  // Read back: pixel at (10, 10) should be opaque black
  const pixel = ctx.getImageData(10, 10, 1, 1).data;
  expect(pixel[3]).toBe(255); // alpha
});

it('drawSquareDotsFaster clips dots crossing canvas boundary', () => {
  const canvas = makeRealCanvas(100, 100);
  const ctx = canvas.getContext('2d')!;
  const painter = new CanvasPainter(canvas);
  // Dot near right edge — half should be cut
  (painter as any).drawSquareDotsFaster([[99, 50]], 'rgba(0,0,0,1)', 4, ctx);
  // No throws; outside-canvas write should be skipped
  const outside = ctx.getImageData(0, 0, 1, 1).data;
  expect(outside[3]).toBe(0); // alpha at (0,0) untouched
});
```

- [ ] **Step 2: 验证失败**

Run: `cmd /c npx vitest run src/renderer/canvas-painter.test.ts -t "drawSquareDotsFaster" --reporter=dot`
Expected: FAIL

- [ ] **Step 3: 实现 drawSquareDotsFaster**

在 `canvas-painter.ts` `CanvasPainter` 内（对齐 mapshaper `gui-canvas.mjs:334-372`）：

```ts
private static _pixelColorFn = getPixelColorFunction();

private drawSquareDotsFaster(
  points: Array<[number, number]>,
  color: string,
  size: number,
  ctx: CanvasRenderingContext2D,
): void {
  const canvas = ctx.canvas;
  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0 || points.length === 0) return;
  const imageData = ctx.getImageData(0, 0, w, h);
  const pixels = new Uint32Array(imageData.data.buffer);
  const colorInt = CanvasPainter._pixelColorFn(color);
  const half = Math.floor(size / 2);
  
  for (const [px, py] of points) {
    const cx = Math.round(px);
    const cy = Math.round(py);
    const x0 = Math.max(0, cx - half);
    const y0 = Math.max(0, cy - half);
    const x1 = Math.min(w - 1, cx + half);
    const y1 = Math.min(h - 1, cy + half);
    for (let y = y0; y <= y1; y++) {
      const rowOffset = y * w;
      for (let x = x0; x <= x1; x++) {
        pixels[rowOffset + x] = colorInt;
      }
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
}
```

- [ ] **Step 4: 验证通过**

Run: `cmd /c npx vitest run src/renderer/canvas-painter.test.ts -t "drawSquareDotsFaster" --reporter=dot`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/canvas-painter.ts src/renderer/canvas-painter.test.ts
git commit -m "perf(render): drawSquareDotsFaster direct Uint32Array pixel writes"
```

---

## Task 3: B3 — drawPoints 路径分流

**Files:**
- Modify: `src/renderer/canvas-painter.ts` — `drawPoints` 加 `canUseFastDotPath` 判断
- Test: `src/renderer/canvas-painter.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('drawPoints uses fast path when size <= 6, single color, no stroke, no opacity', () => {
  const canvas = makeRealCanvas(100, 100);
  const ctx = canvas.getContext('2d')!;
  const putSpy = vi.spyOn(ctx, 'putImageData');
  const painter = new CanvasPainter(canvas);
  painter.drawPoints([makePointShape([10, 10]), makePointShape([20, 20])], {
    radius: 3, color: 'rgba(0,0,0,1)', fill: true,
  } as any);
  expect(putSpy).toHaveBeenCalled();
});

it('drawPoints uses slow path when size > 6', () => {
  const canvas = makeRealCanvas(100, 100);
  const ctx = canvas.getContext('2d')!;
  const arcSpy = vi.spyOn(ctx, 'arc');
  const painter = new CanvasPainter(canvas);
  painter.drawPoints([makePointShape([10, 10])], {
    radius: 10, color: 'rgba(0,0,0,1)', fill: true,
  } as any);
  expect(arcSpy).toHaveBeenCalled();
});

it('drawPoints uses slow path when stroke is configured', () => {
  const canvas = makeRealCanvas(100, 100);
  const ctx = canvas.getContext('2d')!;
  const arcSpy = vi.spyOn(ctx, 'arc');
  const painter = new CanvasPainter(canvas);
  painter.drawPoints([makePointShape([10, 10])], {
    radius: 3, color: 'rgba(0,0,0,1)', fill: true, strokeColor: '#fff', strokeWidth: 1,
  } as any);
  expect(arcSpy).toHaveBeenCalled();
});
```

- [ ] **Step 2: 验证失败**

Run: `cmd /c npx vitest run src/renderer/canvas-painter.test.ts -t "drawPoints.*fast|slow path" --reporter=dot`
Expected: FAIL

- [ ] **Step 3: 实现分流**

在 `canvas-painter.ts` 的 `drawPoints` 顶部加判断：

```ts
drawPoints(shapes: any[], style: PointStyle): void {
  // mapshaper gui-canvas.mjs:306 — fast path when size <= 6, no stroke, no opacity
  if (this._canUseFastDotPath(style)) {
    this._drawPointsFast(shapes, style);
    return;
  }
  // ... existing slow path ...
}

private _canUseFastDotPath(style: PointStyle): boolean {
  const radius = Number((style as any)?.radius) || 4;
  const size = Math.round(radius * 2);
  if (size > 6) return false;
  if ((style as any)?.strokeColor || (style as any)?.strokeWidth) return false;
  const op = (style as any)?.opacity;
  if (op !== undefined && op !== 1) return false;
  if (style?.fill === false) return false;
  return true;
}

private _drawPointsFast(shapes: any[], style: PointStyle): void {
  const ctx = this._ctx;
  const pr = this._pixelRatio;
  const mx = this._transform.mx * pr;
  const my = this._transform.my * pr;
  const bx = this._transform.bx * pr;
  const by = this._transform.by * pr;
  const radius = (Number((style as any)?.radius) || 4) * pr;
  const size = Math.max(1, Math.round(radius * 2));
  const color = (style as any)?.color || '#333';

  const points: Array<[number, number]> = [];
  shapes.forEach(shape => {
    if (!shape) return;
    shape.forEach((part: number[][]) => {
      part.forEach((pt: number[]) => {
        const px = pt[0] * mx + bx;
        const py = pt[1] * my + by;
        points.push([px, py]);
      });
    });
  });

  this.drawSquareDotsFaster(points, color, size, ctx);
}
```

- [ ] **Step 4: 验证通过**

Run: `cmd /c npx vitest run src/renderer/canvas-painter.test.ts --reporter=dot`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/canvas-painter.ts src/renderer/canvas-painter.test.ts
git commit -m "perf(render): drawPoints fast-path dispatch (size leq 6, no stroke, opaque)"
```

---

## Task 4: 压力测试 example

**Files:**
- Create: `test/examples/dots-stress.html`

- [ ] **Step 1: 写 example**

复制现有最简单的 example HTML，改为 spawn 10k/100k 随机点 GeoJSON 加载到 emap。提供按钮切换点数与 size。

- [ ] **Step 2: 手动验证**

Run: `cmd /c npm run dev`
打开 `test/examples/dots-stress.html`，肉眼对比 size=4（fast path）和 size=10（slow path）的帧时数。预期 fast path 比 slow path 快 10× 以上。

- [ ] **Step 3: Commit**

```bash
git add test/examples/dots-stress.html
git commit -m "test(examples): add dot cloud stress test for fast path"
```

---

## Task 5: 整体回归

- [ ] **Step 1: TypeCheck**

Run: `cmd /c npm run typecheck`
Expected: 0 errors

- [ ] **Step 2: 全量测试**

Run: `cmd /c npm run test:run`
Expected: 全绿

- [ ] **Step 3: Build**

Run: `cmd /c npm run build`
Expected: 成功

---

## 验收标准

- [x] `getPixelColorFunction` 工作正确（cache + uint32 转换）
- [x] `drawSquareDotsFaster` 一次 `putImageData`，边界裁剪正确
- [x] `drawPoints` 在 size>6 / stroke / opacity!=1 时退回 slow path
- [x] `dots-stress.html` 在 fast path 下显著快于 slow path
- [x] typecheck / 全量测试 / build 通过
