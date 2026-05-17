# emap DX Phase 2a — Pointer Arbitration Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote `HandlerManager` from a passive registry to the single-DOM-listener pointer arbiter the design spec §3 describes, and re-implement `DragPanHandler` to pan via `handlePointer` instead of owning its own DOM listeners — with **zero behavior change** to pan.

**Architecture:** `HandlerManager.attach(element)` installs ONE set of pointer listeners (`pointerdown`/`pointermove`/`pointerup`/`click`), normalizes each to `NormalizedPointerEvent`, and dispatches to enabled handlers in a fixed priority order. A handler returning `'exclusive'` captures subsequent move/up until it returns non-exclusive (gesture end); `'consumed'` stops that event; `'passthrough'` continues. `DragPanHandler` becomes a pure `handlePointer` implementation (no wrapped DOM primitive). `scrollZoom` is intentionally **out of scope** — wheel never conflicts with pointer gestures, so it stays as the Phase-1 `MouseWheel`-wrapping handler, untouched.

**Tech Stack:** TypeScript 5 (strict), Vitest 1.x (jsdom), Rollup.

**Scope boundary (explicit):** Phase 2a is no-pan-behavior-change groundwork. It does NOT add selection handlers (P2b), rewrite controls (P2c), touch `scrollZoom`/`MouseWheel`, or change CSS. The fragile shift-vs-pan special case is *not removed* here — `DragPanHandler` keeps honoring `skipShiftDrag` so behavior stays identical until P2b's selection handlers exist to own shift+drag.

## Design Decisions (challenge these in review)

1. **Pointer Events API** (`pointerdown/move/up`) not `mouse*`. jsdom supports `PointerEvent`; it unifies mouse/touch and is the modern standard. Drag move/up listen on `window` (mirrors the current `DragPanHandler` primitive, which used `window` for move/up so a drag continues outside the element).
2. **Fixed priority array** `['lassoSelect','boxSelect','clickSelect','dragPan']` — only registered+enabled handlers participate. In 2a only `dragPan` is arbitrated, so the effective order is trivial; the array is the seam P2b extends.
3. **Exclusive lock**: at most one handler holds the gesture. On `pointerdown`, the first handler returning `'exclusive'` becomes the active gesture owner; all `pointermove`/`pointerup` go ONLY to it until it returns a non-`'exclusive'` result (gesture end), then the lock releases.
4. **`scrollZoom` excluded from arbitration** (rationale above). It keeps its own wheel listener via the unchanged Phase-1 `ScrollZoomHandler`.
5. **`click` synthesis**: the browser fires a native `click` after a non-dragging down/up. We dispatch the native `click` as `kind:'click'`. `dragPan` ignores `click` (returns `'passthrough'`); it exists for P2b's `clickSelect`.
6. **No new public API.** `map.dragPan` stays a `Handler<DragPanOptions>`. `HandlerManager.attach/detach` are internal (called by `Emap`).

---

## File Structure

- Modify `src/core/handler-manager.ts` — add `attach(element)/detach()`, the normalizer, the priority-ordered dispatch loop + exclusive lock. New responsibility: DOM ownership + arbitration.
- Modify `src/core/handler-manager.test.ts` — add arbitration tests.
- Rewrite `src/core/handlers/drag-pan.ts` — `handlePointer` implements pan; drop the wrapped `PanGestureSource`. Keep the same public surface (`Handler<DragPanOptions>`, emits `pan`/`panstart`/`panend`).
- Modify `src/core/handlers/drag-pan.test.ts` — drive via `handlePointer` instead of DOM events.
- Modify `src/map/map.ts` — call `this._handlers.attach(this._canvasContainer)` after registering handlers; `detach()` in teardown. `dragPan` no longer self-listens.
- `src/core/drag-pan-handler.ts` (the old primitive) — becomes unused by `DragPanHandler`; leave it in place (still has its own tests) but it is now dead from the handler path. A cleanup task removes it.

---

### Task 1: HandlerManager owns pointer listeners + normalizer

**Files:**
- Modify: `src/core/handler-manager.ts`
- Test: `src/core/handler-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/core/handler-manager.test.ts`:

```ts
// @vitest-environment jsdom
import { vi } from 'vitest';

describe('HandlerManager pointer arbitration', () => {
  function recordingHandler(name: string, result: 'passthrough' | 'consumed' | 'exclusive') {
    const calls: any[] = [];
    return {
      h: {
        name,
        enable() {}, disable() {}, isEnabled: () => true,
        setOptions() {}, getOptions: () => ({}),
        handlePointer: (ev: any) => { calls.push(ev); return result; },
      },
      calls,
    };
  }

  it('attach() normalizes pointerdown to a NormalizedPointerEvent and dispatches it', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ left: 10, top: 20, width: 0, height: 0, right: 0, bottom: 0, x: 10, y: 20, toJSON() {} });
    const m = new HandlerManager();
    const { h, calls } = recordingHandler('dragPan', 'passthrough');
    m.register(h);
    m.attach(el);

    el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 40, clientY: 50, shiftKey: true, button: 0 }));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      kind: 'down',
      point: { x: 30, y: 30 },                 // client - rect offset
      modifiers: { shift: true, ctrl: false, alt: false, meta: false },
      button: 0,
    });
    m.detach();
  });

  it('detach() removes listeners (no dispatch after detach)', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} });
    const m = new HandlerManager();
    const { h, calls } = recordingHandler('dragPan', 'passthrough');
    m.register(h);
    m.attach(el);
    m.detach();
    el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1, clientY: 1 }));
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/handler-manager.test.ts -t "pointer arbitration"`
Expected: FAIL — `m.attach is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/core/handler-manager.ts`, add imports + new members. Replace the file's class body to add (keep existing `register`/`get`/`applyInteractive` unchanged):

```ts
import { type Handler, isHandler, type NormalizedPointerEvent } from './handler';

// Highest → lowest. Only registered+enabled handlers participate. The
// selection handlers (P2b) slot in ahead of dragPan.
const PRIORITY = ['lassoSelect', 'boxSelect', 'clickSelect', 'dragPan'] as const;
```

Add these fields + methods to the class:

```ts
  private _element: HTMLElement | null = null;
  private _exclusive: Handler | null = null;
  private _onDown = (e: PointerEvent) => this._dispatch(this._norm(e, 'down'));
  private _onMove = (e: PointerEvent) => this._dispatch(this._norm(e, 'move'));
  private _onUp = (e: PointerEvent) => this._dispatch(this._norm(e, 'up'));
  private _onClick = (e: MouseEvent) => this._dispatch(this._norm(e, 'click'));

  attach(element: HTMLElement): void {
    this.detach();
    this._element = element;
    element.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    element.addEventListener('click', this._onClick);
  }

  detach(): void {
    if (!this._element) return;
    this._element.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    this._element.removeEventListener('click', this._onClick);
    this._element = null;
    this._exclusive = null;
  }

  private _norm(e: PointerEvent | MouseEvent, kind: NormalizedPointerEvent['kind']): NormalizedPointerEvent {
    const r = (this._element as HTMLElement).getBoundingClientRect();
    return {
      kind,
      point: { x: e.clientX - r.left, y: e.clientY - r.top },
      modifiers: { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey },
      button: 'button' in e ? e.button : 0,
      originalEvent: e,
    };
  }

  private _orderedEnabled(): Handler[] {
    const out: Handler[] = [];
    for (const name of PRIORITY) {
      const h = this._handlers.get(name);
      if (h && h.isEnabled()) out.push(h);
    }
    return out;
  }

  private _dispatch(ev: NormalizedPointerEvent): void {
    // Active exclusive gesture: only its owner sees move/up until it ends.
    if (this._exclusive && (ev.kind === 'move' || ev.kind === 'up')) {
      const r = this._exclusive.handlePointer(ev);
      if (r !== 'exclusive') this._exclusive = null;
      return;
    }
    for (const h of this._orderedEnabled()) {
      const r = h.handlePointer(ev);
      if (r === 'exclusive') { this._exclusive = h; return; }
      if (r === 'consumed') return;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/handler-manager.test.ts`
Expected: PASS (existing 4 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/core/handler-manager.ts src/core/handler-manager.test.ts
git commit -m "feat(core): HandlerManager pointer arbitration (attach/normalize/dispatch) (DX P2a)"
```

---

### Task 2: DragPanHandler implements pan via handlePointer

**Files:**
- Modify: `src/core/handlers/drag-pan.ts` (full rewrite of the class body)
- Modify: `src/core/handlers/drag-pan.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `src/core/handlers/drag-pan.test.ts` with:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { DragPanHandler } from './drag-pan';
import type { NormalizedPointerEvent } from '../handler';

function ev(kind: NormalizedPointerEvent['kind'], x: number, y: number, shift = false): NormalizedPointerEvent {
  return {
    kind, point: { x, y },
    modifiers: { shift, ctrl: false, alt: false, meta: false },
    button: 0, originalEvent: new MouseEvent(kind === 'down' ? 'pointerdown' : 'pointermove'),
  };
}

describe('DragPanHandler (arbitrated)', () => {
  it('name + enabled-by-default + handlePointer passthrough when disabled', () => {
    const h = new DragPanHandler();
    expect(h.name).toBe('dragPan');
    expect(h.isEnabled()).toBe(true);
    h.disable();
    expect(h.handlePointer(ev('down', 0, 0))).toBe('passthrough');
  });

  it('down (no shift) → exclusive + panstart; move → pan {dx,dy}; up → panend + releases', () => {
    const h = new DragPanHandler();
    const start = vi.fn(); const pan = vi.fn(); const end = vi.fn();
    h.on('panstart', start); h.on('pan', pan); h.on('panend', end);

    expect(h.handlePointer(ev('down', 10, 10))).toBe('exclusive');
    expect(start).toHaveBeenCalledTimes(1);

    expect(h.handlePointer(ev('move', 25, 18))).toBe('exclusive');
    expect(pan).toHaveBeenCalledWith(expect.objectContaining({ dx: 15, dy: 8 }));

    expect(h.handlePointer(ev('up', 25, 18))).toBe('passthrough');
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('skipShiftDrag (default true): shift+down is passthrough, no gesture', () => {
    const h = new DragPanHandler();
    const start = vi.fn(); h.on('panstart', start);
    expect(h.handlePointer(ev('down', 0, 0, true))).toBe('passthrough');
    expect(start).not.toHaveBeenCalled();
  });

  it('setOptions({skipShiftDrag:false}) lets shift+drag pan', () => {
    const h = new DragPanHandler();
    h.setOptions({ skipShiftDrag: false });
    expect(h.handlePointer(ev('down', 0, 0, true))).toBe('exclusive');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/handlers/drag-pan.test.ts`
Expected: FAIL — `new DragPanHandler()` signature/behavior mismatch (currently requires an element + wraps a primitive).

- [ ] **Step 3: Write minimal implementation**

Replace the entire contents of `src/core/handlers/drag-pan.ts` with:

```ts
import { EventDispatcher } from '../events';
import type { Handler, HandlerResult, NormalizedPointerEvent } from '../handler';

export interface DragPanOptions {
  /** Reserve shift+drag for higher-level handlers (P2b selection). Default true. */
  skipShiftDrag: boolean;
}

const DEFAULTS: DragPanOptions = { skipShiftDrag: true };

/**
 * Named `dragPan` handler. Phase 2a: pan logic lives in `handlePointer`,
 * driven by HandlerManager's single pointer-listener arbiter — the handler
 * owns no DOM listeners. Emits `panstart` / `pan {dx,dy}` / `panend` exactly
 * as before so Emap's viewport wiring is unchanged.
 */
export class DragPanHandler extends EventDispatcher implements Handler<DragPanOptions> {
  readonly name = 'dragPan';
  private _opts: DragPanOptions;
  private _enabled = true;
  private _dragging = false;
  private _last: { x: number; y: number } = { x: 0, y: 0 };

  constructor(opts?: Partial<DragPanOptions>) {
    super();
    this._opts = { ...DEFAULTS, ...opts };
  }

  enable(): void { this._enabled = true; }
  disable(): void {
    this._enabled = false;
    if (this._dragging) { this._dragging = false; this.fire('panend'); }
  }
  isEnabled(): boolean { return this._enabled; }
  setOptions(opts: Partial<DragPanOptions>): void { this._opts = { ...this._opts, ...opts }; }
  getOptions(): Readonly<DragPanOptions> { return this._opts; }

  handlePointer(ev: NormalizedPointerEvent): HandlerResult {
    if (!this._enabled) return 'passthrough';
    if (ev.kind === 'down') {
      if (ev.button !== 0) return 'passthrough';
      if (this._opts.skipShiftDrag && ev.modifiers.shift) return 'passthrough';
      this._dragging = true;
      this._last = { x: ev.point.x, y: ev.point.y };
      this.fire('panstart');
      return 'exclusive';
    }
    if (ev.kind === 'move' && this._dragging) {
      const dx = ev.point.x - this._last.x;
      const dy = ev.point.y - this._last.y;
      this._last = { x: ev.point.x, y: ev.point.y };
      this.fire('pan', { dx, dy });
      return 'exclusive';
    }
    if (ev.kind === 'up' && this._dragging) {
      this._dragging = false;
      this.fire('panend');
      return 'passthrough';
    }
    return 'passthrough';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/handlers/drag-pan.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/handlers/drag-pan.ts src/core/handlers/drag-pan.test.ts
git commit -m "feat(core): DragPanHandler pans via handlePointer, no own DOM listeners (DX P2a)"
```

---

### Task 3: Wire arbiter into Emap; remove dragPan self-listening

**Files:**
- Modify: `src/map/map.ts`
- Test: `src/map/handler-registry.test.ts` (add an arbitration end-to-end case)

- [ ] **Step 1: Write the failing test**

Append a test to `src/map/handler-registry.test.ts` inside its existing top `describe` (reuse its existing `container()` + canvas-2d `beforeAll` mock — do NOT duplicate them):

```ts
  it('dragging the canvas pans the viewport through the arbiter', () => {
    const el = container();
    const map = new Emap({ container: el });
    const canvas = map.getCanvasContainer();
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
    const before = map.getCenter();
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, button: 0 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 160, clientY: 100, button: 0 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 160, clientY: 100, button: 0 }));
    const after = map.getCenter();
    expect(after[0]).not.toBe(before[0]); // longitude changed → pan happened
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/map/handler-registry.test.ts -t "arbiter"`
Expected: FAIL — pan does not happen (dragPan no longer self-listens; arbiter not attached yet).

- [ ] **Step 3: Write minimal implementation**

In `src/map/map.ts`:

(a) The `DragPanHandler` is constructed with the canvas element today. Change its construction to the new no-element signature. Find the line constructing `this._dragPan` (around the `new ScrollZoomHandler(...)` line) and change:
```ts
    this._dragPan = new DragPanHandler();
```
(`ScrollZoomHandler` construction is unchanged — it still takes the element.)

(b) After both `this._handlers.register(...)` calls, attach the arbiter:
```ts
    this._handlers.attach(this._canvasContainer);
```

(c) In teardown (where `this._scrollZoom?.destroy()` / `this._dragPan?.destroy()` are called) add, before them:
```ts
    this._handlers.detach();
```
`DragPanHandler` no longer has a `destroy()` (it owns nothing). Remove the `this._dragPan?.destroy();` line. Keep `this._scrollZoom?.destroy();`.

(d) The existing `this._dragPan.on('pan'|'panstart'|'panend', ...)` wiring is unchanged — the new handler emits the same events.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/map/handler-registry.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 5: GATE — full suite, zero behavior change**

Run: `npx tsc --noEmit 2>&1 | grep -v node_modules/mapshaper | grep "error TS"` (empty) AND `npx vitest run`.
Expected: all green. **`src/map/map.test.ts` pan/zoom/interactive/edit-mode tests must still pass.** If any pan test fails, STOP — the arbitration changed pan behavior; report BLOCKED with the failing test.

- [ ] **Step 6: Commit**

```bash
git add src/map/map.ts src/map/handler-registry.test.ts
git commit -m "feat(map): attach pointer arbiter; dragPan no longer self-listens (DX P2a)"
```

---

### Task 4: Remove the now-dead pan primitive

**Files:**
- Delete: `src/core/drag-pan-handler.ts`, `src/core/drag-pan-handler.test.ts`
- Modify: `src/index.ts` (only if it still references the old primitive path — it should not after P1; verify)

- [ ] **Step 1: Verify the primitive is dead**

Run: `grep -rn "drag-pan-handler'" src --include="*.ts" | grep -v "drag-pan-handler.test.ts"`
Expected: NO matches (nothing imports the old primitive anymore — `DragPanHandler` the handler is `handlers/drag-pan`). If there ARE matches, STOP and report — Task 2/3 left a dangling consumer.

- [ ] **Step 2: Delete the files**

```bash
git rm src/core/drag-pan-handler.ts src/core/drag-pan-handler.test.ts
```

- [ ] **Step 3: GATE**

Run: `npx tsc --noEmit 2>&1 | grep -v node_modules/mapshaper | grep "error TS"` (empty) AND `npx vitest run` (all green, count = prior − the deleted primitive's tests) AND `npm run build` (exit 0).

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(core): remove dead pan DOM primitive, superseded by arbiter (DX P2a)"
```

---

### Task 5: CHANGELOG

**Files:** Modify `CHANGELOG.md` (`[Unreleased]`).

- [ ] **Step 1: Add to the existing `### Added` (or a `### Changed`) under `[Unreleased]`**

```markdown
- DX Phase 2a (toward 0.3.0): `HandlerManager` is now the single
  pointer-event arbiter (`attach`/`detach`, normalized `NormalizedPointerEvent`,
  priority-ordered dispatch with exclusive-gesture locking). `dragPan` pans
  via `handlePointer` and owns no DOM listeners; the old internal pan
  primitive (`src/core/drag-pan-handler.ts`) is removed. No pan behavior
  change; this is the seam P2b's selection handlers slot into.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG for DX Phase 2a pointer arbitration"
```

---

## Self-Review

**1. Spec coverage (design spec §3 "Core Architecture"):** `HandlerManager` single-DOM arbiter + `NormalizedPointerEvent` normalization + priority order + exclusive lock → Tasks 1, 3. `handlePointer` actually used (no longer passthrough no-op) for `dragPan` → Task 2. Replaces the `drag-pan-handler.ts:61` shift special-case mechanism with arbiter-routed `skipShiftDrag` (special case fully retired in P2b when selection handlers own shift) → Task 2 keeps `skipShiftDrag`, documented in scope boundary. `scrollZoom` exclusion is a documented deliberate scoping decision (§Design Decisions #4). Spec §4 (selection handlers), §5 (feature events), §6 (CSS) are explicitly out of 2a — separate plans, stated in header. No 2a requirement unmapped.

**2. Placeholder scan:** No TBD/TODO. Task 3(d) "wiring unchanged" is a verified no-op instruction (events identical), not a placeholder — the engineer leaves existing lines as-is, exact location cited. All code steps contain complete code.

**3. Type consistency:** `NormalizedPointerEvent` shape used in Tasks 1–3 matches `src/core/handler.ts` (`kind/point/modifiers/button/originalEvent`). `Handler<DragPanOptions>` contract (Task 2) matches the interface from P1. `attach/detach/_dispatch/_norm/_orderedEnabled` named consistently across Task 1 & 3. `DragPanHandler` constructor changes from `(element, opts?)` → `(opts?)` consistently in Task 2 (definition) and Task 3 (call site). Emitted events `pan{dx,dy}`/`panstart`/`panend` unchanged → Emap wiring (Task 3d) stays valid. The removed `destroy()` (Task 3c) is consistent with Task 2's class having no `destroy()`.

Plan is internally consistent and scoped to one shippable, no-pan-behavior-change unit.
