# PR3 / Phase C — fast-nav 架构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 RenderRequest 软参数 + RenderScheduler + fast-nav CSS transform，对齐 mapshaper 0.7.19 慢机型 pan/zoom 体验与 hover 解耦。

**Architecture:** 新建 `render-scheduler.ts` 持有帧测量、settle 状态、snapshot；扩展 `edit-overlay-renderer.ts` → `overlay-renderer.ts` 接管 hover/selection；`Emap.render(req?)` 改为可选 RenderRequest；`HandlerManager` 在 pan/zoom/hover 时携带 action。

**Tech Stack:** TypeScript, Canvas2D, CSS transform, performance.now(), Vitest。

**Spec:** `docs/superpowers/specs/2026-05-23-emap-render-perf-parity-design.md` 第 7 节

**前置：** PR1 + PR2 已 land。

---

## File Structure

| 文件 | 职责 | 改动类型 |
|------|------|---------|
| `src/map/types.ts` | 新增 `RenderAction`, `RenderRequest`, `AffineDelta` 类型 | 修改 |
| `src/renderer/render-scheduler.ts` | RenderScheduler，决策表、帧测量、settle、snapshot | 新建 |
| `src/renderer/overlay-renderer.ts` | rename from `edit-overlay-renderer.ts`；接管 hover/selection | 重命名 + 修改 |
| `src/renderer/edit-overlay-renderer.ts` | 保留为 re-export alias，向后兼容 | 修改 |
| `src/map/map.ts` | `Emap.render(req?)` 接 RenderScheduler；持有 OverlayRenderer | 修改 |
| `src/map/highlight-manager.ts` | 提交目标从 main painter 改为 overlay | 修改 |
| `src/core/handler-manager.ts` | pan/zoom 派发 `action: 'nav'`；hover 派发 `'hover'`；`interactionend` 事件 | 修改 |
| `src/renderer/render-scheduler.test.ts` | 决策表与帧测量单测 | 新建 |

---

## Task 1: RenderRequest 类型与默认行为

**Files:**
- Modify: `src/map/types.ts`
- Modify: `src/map/map.ts`

- [ ] **Step 1: 写失败测试**

`src/map/map.test.ts`：

```ts
it('Emap.render() with no args defaults to action=redraw', () => {
  const map = makeMap();
  const spy = vi.spyOn((map as any)._scheduler ?? map, 'schedule' as any);
  map.render();
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ action: 'redraw' }));
});

it('Emap.render({action: hover}) propagates action', () => {
  const map = makeMap();
  const spy = vi.spyOn((map as any)._scheduler, 'schedule' as any);
  map.render({ action: 'hover' });
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ action: 'hover' }));
});
```

- [ ] **Step 2: 验证失败**

Run: `cmd /c npx vitest run src/map/map.test.ts -t "default.*redraw|propagates action" --reporter=dot`
Expected: FAIL

- [ ] **Step 3: 定义类型**

`src/map/types.ts` 加：

```ts
export type RenderAction = 'redraw' | 'nav' | 'hover';

export interface AffineDelta {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
}

export interface RenderRequest {
  action?: RenderAction;
  navDelta?: AffineDelta;
}
```

- [ ] **Step 4: Emap.render 接受 RenderRequest**

`src/map/map.ts` `Emap.render` 方法签名改为：

```ts
render(req?: RenderRequest): void {
  const action: RenderAction = req?.action ?? 'redraw';
  this._scheduler.schedule({ ...req, action });
}
```

> 此刻 `_scheduler` 尚未实现 → 临时让 schedule fallback 到原 `_renderImpl()`。Task 2 引入真正 RenderScheduler。

- [ ] **Step 5: 验证通过**

Run: `cmd /c npx vitest run src/map/map.test.ts --reporter=dot`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/map/types.ts src/map/map.ts src/map/map.test.ts
git commit -m "feat(render): introduce RenderRequest soft parameter (backward compatible)"
```

---

## Task 2: RenderScheduler 骨架与决策表

**Files:**
- Create: `src/renderer/render-scheduler.ts`
- Create: `src/renderer/render-scheduler.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { RenderScheduler, SLOW_FRAME_MS } from './render-scheduler';

describe('RenderScheduler decision table', () => {
  it('action=redraw always triggers full redraw', () => {
    const fullRedraw = vi.fn();
    const overlayOnly = vi.fn();
    const fastNav = vi.fn();
    const s = new RenderScheduler({ fullRedraw, overlayOnly, fastNav });
    s.schedule({ action: 'redraw' });
    expect(fullRedraw).toHaveBeenCalledTimes(1);
    expect(overlayOnly).not.toHaveBeenCalled();
  });

  it('action=hover triggers overlay-only', () => {
    const fullRedraw = vi.fn();
    const overlayOnly = vi.fn();
    const s = new RenderScheduler({ fullRedraw, overlayOnly, fastNav: vi.fn() });
    s.schedule({ action: 'hover' });
    expect(overlayOnly).toHaveBeenCalledTimes(1);
    expect(fullRedraw).not.toHaveBeenCalled();
  });

  it('action=nav triggers full redraw when last frame <= 100ms', () => {
    const fullRedraw = vi.fn();
    const fastNav = vi.fn();
    const s = new RenderScheduler({ fullRedraw, overlayOnly: vi.fn(), fastNav });
    (s as any)._lastFrameMs = 50;
    s.schedule({ action: 'nav', navDelta: { tx: 0, ty: 0, sx: 1, sy: 1 } });
    expect(fullRedraw).toHaveBeenCalledTimes(1);
    expect(fastNav).not.toHaveBeenCalled();
  });

  it('action=nav triggers fastNav when last frame > 100ms and snapshot exists', () => {
    const fastNav = vi.fn();
    const fullRedraw = vi.fn();
    const s = new RenderScheduler({ fullRedraw, overlayOnly: vi.fn(), fastNav });
    (s as any)._lastFrameMs = 150;
    (s as any)._snapshot = { canvasWidth: 800, canvasHeight: 600, pixRatio: 1 };
    s.schedule({ action: 'nav', navDelta: { tx: 10, ty: 0, sx: 1, sy: 1 } });
    expect(fastNav).toHaveBeenCalled();
    expect(fullRedraw).not.toHaveBeenCalled();
  });

  it('SLOW_FRAME_MS equals 100', () => {
    expect(SLOW_FRAME_MS).toBe(100);
  });
});
```

- [ ] **Step 2: 验证失败**

Run: `cmd /c npx vitest run src/renderer/render-scheduler.test.ts --reporter=dot`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 RenderScheduler**

`src/renderer/render-scheduler.ts`：

```ts
import { RenderRequest, RenderAction, AffineDelta } from '../map/types';

export const SLOW_FRAME_MS = 100;
export const FAST_SETTLE_FALLBACK_MS = 2000;

export interface Snapshot {
  canvasWidth: number;
  canvasHeight: number;
  pixRatio: number;
  // viewport bounds at snapshot time, used for transform math
  vBounds?: { xmin: number; ymin: number; xmax: number; ymax: number };
}

export interface RenderCallbacks {
  fullRedraw: () => void;
  overlayOnly: () => void;
  fastNav: (delta: AffineDelta) => void;
}

export class RenderScheduler {
  private _lastFrameMs = 0;
  private _snapshot: Snapshot | null = null;
  private _fastActive = false;
  private _settleRequested = false;
  private _settleTimer: number | null = null;
  
  constructor(private _cb: RenderCallbacks) {}
  
  schedule(req: RenderRequest): void {
    const action: RenderAction = req.action ?? 'redraw';
    if (action === 'hover') {
      this._cb.overlayOnly();
      return;
    }
    if (action === 'nav' && this._shouldUseFastNav() && req.navDelta) {
      this._fastActive = true;
      this._cb.fastNav(req.navDelta);
      this._scheduleSettleFallback();
      return;
    }
    // redraw or non-fast nav
    this._measuredFullRedraw();
  }
  
  // Called externally after a full redraw completes; updates frame measurement
  recordFrame(ms: number, snapshot: Snapshot): void {
    this._lastFrameMs = ms;
    this._snapshot = snapshot;
  }
  
  // Called externally when interaction ends (pointerup, wheel idle 200ms)
  notifyInteractionEnd(): void {
    if (this._fastActive) {
      this._settleNow();
    } else {
      this._settleRequested = true;
    }
  }
  
  private _measuredFullRedraw(): void {
    this._fastActive = false;
    this._settleRequested = false;
    this._cancelSettleFallback();
    this._cb.fullRedraw();
  }
  
  private _settleNow(): void {
    this._cancelSettleFallback();
    this._measuredFullRedraw();
  }
  
  private _shouldUseFastNav(): boolean {
    if (!this._snapshot) return false;
    if (this._lastFrameMs <= SLOW_FRAME_MS) return false;
    return true;
  }
  
  private _scheduleSettleFallback(): void {
    this._cancelSettleFallback();
    this._settleTimer = window.setTimeout(() => {
      if (this._fastActive) this._settleNow();
    }, FAST_SETTLE_FALLBACK_MS);
  }
  
  private _cancelSettleFallback(): void {
    if (this._settleTimer !== null) {
      clearTimeout(this._settleTimer);
      this._settleTimer = null;
    }
  }
}
```

- [ ] **Step 4: 验证通过**

Run: `cmd /c npx vitest run src/renderer/render-scheduler.test.ts --reporter=dot`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/render-scheduler.ts src/renderer/render-scheduler.test.ts
git commit -m "feat(render): RenderScheduler with decision table and settle latch"
```

---

## Task 3: Overlay Renderer 重构

**Files:**
- Rename: `src/renderer/edit-overlay-renderer.ts` → `src/renderer/overlay-renderer.ts`
- Modify: `src/renderer/edit-overlay-renderer.ts` (re-export alias)
- Modify: `src/map/highlight-manager.ts` — 提交目标改 overlay

- [ ] **Step 1: 写失败测试**

`src/renderer/overlay-renderer.test.ts`：

```ts
import { OverlayRenderer } from './overlay-renderer';

it('OverlayRenderer exports same shape as legacy EditOverlayRenderer', () => {
  const canvas = makeRealCanvas(100, 100);
  const r = new OverlayRenderer(canvas);
  expect(typeof r.clear).toBe('function');
  expect(typeof r.drawHighlight).toBe('function');
});
```

- [ ] **Step 2: 验证失败**

Run: `cmd /c npx vitest run src/renderer/overlay-renderer.test.ts --reporter=dot`
Expected: FAIL

- [ ] **Step 3: 重命名并扩展**

```bash
git mv src/renderer/edit-overlay-renderer.ts src/renderer/overlay-renderer.ts
```

把类名改为 `OverlayRenderer`，新增 `drawHighlight(geom: any, style: HighlightStyle)` 方法接管 hover/selection 渲染。

- [ ] **Step 4: 加 alias**

新建 `src/renderer/edit-overlay-renderer.ts`：

```ts
// Backward-compatible re-export. Prefer OverlayRenderer in new code.
export { OverlayRenderer as EditOverlayRenderer } from './overlay-renderer';
```

- [ ] **Step 5: HighlightManager 改提交目标**

`src/map/highlight-manager.ts` 中现有 `this._painter.drawX(...)` 改为 `this._overlay.drawHighlight(...)`。

- [ ] **Step 6: 验证通过**

Run: `cmd /c npm run test:run`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(render): rename EditOverlayRenderer to OverlayRenderer; route highlights through overlay"
```

---

## Task 4: Emap 接入 RenderScheduler + 帧测量

**Files:**
- Modify: `src/map/map.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('Emap measures frame time and records snapshot after full redraw', () => {
  const map = makeMapWithRealCanvas();
  map.render();
  expect((map as any)._scheduler._lastFrameMs).toBeGreaterThan(0);
  expect((map as any)._scheduler._snapshot).not.toBeNull();
});
```

- [ ] **Step 2: 验证失败**

Expected: FAIL

- [ ] **Step 3: 实现帧测量**

`src/map/map.ts` Emap 构造时持有 RenderScheduler，callback 接 `_renderImpl`：

```ts
private _scheduler = new RenderScheduler({
  fullRedraw: () => this._measuredFullRedraw(),
  overlayOnly: () => this._overlay.render(),
  fastNav: (delta) => this._applyFastTransform(delta),
});

private _measuredFullRedraw(): void {
  this._clearFastTransform();
  const t0 = performance.now();
  this._renderImpl();
  this._flushCanvas();
  const ms = performance.now() - t0;
  this._scheduler.recordFrame(ms, this._captureSnapshot());
}

private _flushCanvas(): void {
  try { this._ctx.getImageData(0, 0, 1, 1); } catch {}
}

private _captureSnapshot(): Snapshot {
  return {
    canvasWidth: this._canvas.width,
    canvasHeight: this._canvas.height,
    pixRatio: this._pixelRatio,
    vBounds: this._viewport.getViewBounds() ?? undefined,
  };
}

private _applyFastTransform(delta: AffineDelta): void {
  const node = this._canvas;
  node.style.transformOrigin = 'top left';
  node.style.transform = `translate(${delta.tx}px,${delta.ty}px) scale(${delta.sx},${delta.sy})`;
}

private _clearFastTransform(): void {
  const node = this._canvas;
  node.style.transform = '';
  node.style.transformOrigin = '';
}
```

- [ ] **Step 4: 验证通过**

Run: `cmd /c npx vitest run src/map/map.test.ts --reporter=dot`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/map/map.ts src/map/map.test.ts
git commit -m "feat(render): Emap frame measurement and fast-transform plumbing"
```

---

## Task 5: HandlerManager — 派发 action + interactionend

**Files:**
- Modify: `src/core/handler-manager.ts`
- Modify: `src/core/handlers/drag-pan-handler.ts`
- Modify: `src/core/handlers/scroll-zoom-handler.ts`

- [ ] **Step 1: 写失败测试**

`src/core/handler-manager.test.ts`：

```ts
it('drag-pan handler triggers render with action=nav and navDelta', () => {
  const map = makeMap();
  const renderSpy = vi.spyOn(map, 'render');
  const hm = (map as any)._handlerManager;
  // Simulate pointerdown + pointermove
  hm.handlePointerEvent({ type: 'pointerdown', x: 100, y: 100, /* ... */ });
  hm.handlePointerEvent({ type: 'pointermove', x: 110, y: 100, /* ... */ });
  expect(renderSpy).toHaveBeenCalledWith(expect.objectContaining({
    action: 'nav',
    navDelta: expect.objectContaining({ tx: 10, ty: 0 }),
  }));
});

it('hover dispatch triggers render with action=hover', () => {
  const map = makeMap();
  const renderSpy = vi.spyOn(map, 'render');
  const hm = (map as any)._handlerManager;
  hm.handlePointerEvent({ type: 'pointermove', x: 50, y: 50 });
  expect(renderSpy).toHaveBeenCalledWith({ action: 'hover' });
});

it('pointerup after drag fires interactionend on the map', () => {
  const map = makeMap();
  const endSpy = vi.fn();
  map.on('interactionend', endSpy);
  const hm = (map as any)._handlerManager;
  hm.handlePointerEvent({ type: 'pointerdown', x: 100, y: 100 });
  hm.handlePointerEvent({ type: 'pointermove', x: 110, y: 100 });
  hm.handlePointerEvent({ type: 'pointerup', x: 110, y: 100 });
  expect(endSpy).toHaveBeenCalled();
});
```

- [ ] **Step 2: 验证失败**

Expected: FAIL

- [ ] **Step 3: 改 handler**

`drag-pan-handler.ts` 中 `onMove` 调 `this._map.render(...)` 处加 `{ action: 'nav', navDelta }`。
`scroll-zoom-handler.ts` 同样。
`handler-manager.ts` hover dispatch 处 `{ action: 'hover' }`。
`pointerup` / wheel 静止时 `this._map.fire('interactionend')`。

`map.ts` 监听 `'interactionend'` → `this._scheduler.notifyInteractionEnd()`。

- [ ] **Step 4: 验证通过**

Run: `cmd /c npm run test:run`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(render): handlers dispatch action=nav/hover and fire interactionend"
```

---

## Task 6: 视觉/正确性验证

- [ ] **Step 1: 启动 dev**

Run: `cmd /c npm run dev`

- [ ] **Step 2: 手工测试 checklist**

打开大数据 example，在浏览器中按以下顺序验证：

- [ ] pan/zoom 流畅，慢机型上能看到 CSS transform 模糊一帧后再清晰
- [ ] 释放鼠标后 settle 触发真渲染
- [ ] hover 时未触发底图重绘（DevTools Performance 显示 hover 期间无大量 paint）
- [ ] 编辑 vertex / 选择 box-select 仍然正常
- [ ] 极端缩放（scale>100）仍能渲染（PR1 的 clamp 兜底）

- [ ] **Step 3: 录帧时数对比**

把 PR1 baseline 中的 example 在 PR3 land 后重测，记入 `docs/superpowers/baselines/2026-05-23-pr3-comparison.md`。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/baselines/2026-05-23-pr3-comparison.md
git commit -m "perf(render): PR3 fast-nav performance comparison data"
```

---

## Task 7: 整体回归

- [ ] **Step 1: TypeCheck**

Run: `cmd /c npm run typecheck`
Expected: 0 errors

- [ ] **Step 2: 全量测试**

Run: `cmd /c npm run test:run`
Expected: 全绿

- [ ] **Step 3: Build**

Run: `cmd /c npm run build`
Expected: 成功

- [ ] **Step 4: GitNexus reindex**

Run: `npx gitnexus analyze --embeddings`

---

## 验收标准

- [x] RenderRequest 类型完整，`render()` 无参向后兼容
- [x] RenderScheduler 4 类决策测试通过（redraw/hover/nav-fast/nav-slow）
- [x] OverlayRenderer 接管 hover/selection；edit-overlay-renderer.ts alias 保留
- [x] Emap 接入 RenderScheduler，有帧测量与 flushCanvas
- [x] HandlerManager 在 pan/zoom/hover 时派发正确 action
- [x] `interactionend` 事件触发 settle
- [x] fast-nav 在慢机型实际触发 CSS transform
- [x] hover 期间无底图重绘（Performance trace 验证）
- [x] typecheck / 全量测试 / build 通过
