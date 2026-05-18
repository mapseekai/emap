# emap DX Phase 8 — Delegated `mousemove` Event Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose a delegated `map.on('mousemove', cb)` event fed by the arbiter pointer-sink, and make `StatusControl` a thin consumer (removing the last raw pointer listener outside the arbiter).

**Architecture:** A new `PointerEventDispatcher` (mirrors the P3 `FeatureEventDispatcher`, move-only) registered on `Emap`. `Emap._syncFeatureSink` is renamed `_syncPointerSink` and installs ONE combined sink that fans out to both `_featureEvents.dispatch(ev)` and `_pointerEvents.dispatch(ev)` when either has listeners (cleared when neither). `HandlerManager` is untouched. `StatusControl` subscribes `map.on('mousemove', …)` instead of its own canvas `mousemove` listener.

**Tech Stack:** TypeScript 5 (strict), Vitest 1.x (jsdom), Rollup.

**Execution order:** T1 → T2 → T3.

**Design of record:** `docs/superpowers/specs/2026-05-18-emap-dx-phase8-mousemove-event-design.md` (§17).

---

## Design Decisions (challenge these in review)

1. **Emap-layer sink fan-out** (user-approved), not an arbiter multi-sink list. `HandlerManager.setPointerSink` stays single-slot; `Emap` owns the fan-out. Minimal seam; P1 core untouched.
2. **Move-only scope** (user-approved YAGNI). `PointerEventDispatcher` handles ONLY `'mousemove'`; ignores `click`/`down`/`up`/`wheel`/`dblclick`/`contextmenu`. `click` is already P3 `feature:click`.
3. **`mapCoord` via `host.unproject(point.x, point.y)`** — byte-identical math to today's `StatusControl`. Payload `{ point:{x,y}, mapCoord:[number,number], originalEvent }`.
4. **Accepted behavior change:** the readout freezes during an exclusive pan/drag (sink gated by `!_exclusive`), consistent with P3 `feature:hover`. Documented; no mitigation.
5. **`feature:*` byte-identical:** same `_featureEvents.dispatch(ev)` call, invoked from the renamed combined sink. Zero default cost (sink only installed when ≥1 feature OR pointer listener).

---

## File Structure

- Create `src/core/pointer-event-dispatcher.ts` — `PointerEventDispatcher` + `PointerMoveEvent` + `PointerEventMapHost`.
- Create `src/core/pointer-event-dispatcher.test.ts`.
- Modify `src/map/map.ts` — `_pointerEvents` field + ctor wiring; rename `_syncFeatureSink`→`_syncPointerSink` (combined fan-out); `on/off/once` `'mousemove'` routing + typed overloads.
- Modify (or create) a map-level test for the routing + sink matrix — append to `src/map/handler-registry.test.ts`.
- Modify `src/index.ts` — export `PointerMoveEvent`.
- Modify `src/ui/status-control.ts` — thin-shell over `map.on('mousemove')`.
- Create `src/ui/status-control.test.ts`.
- Modify `CHANGELOG.md`.

---

### Task 1: `PointerEventDispatcher`

**Files:**
- Create: `src/core/pointer-event-dispatcher.ts`
- Test: `src/core/pointer-event-dispatcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/pointer-event-dispatcher.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { PointerEventDispatcher } from './pointer-event-dispatcher';
import type { NormalizedPointerEvent } from './handler';

function ev(
  kind: NormalizedPointerEvent['kind'],
  x: number,
  y: number,
): NormalizedPointerEvent {
  return {
    kind,
    point: { x, y },
    modifiers: { shift: false, ctrl: false, alt: false, meta: false },
    button: 0,
    originalEvent: new Event(kind),
  };
}

function stubHost() {
  return { unproject: (x: number, y: number) => [x / 10, y / 10] as [number, number] };
}

describe('PointerEventDispatcher', () => {
  it('hasListeners() false until a mousemove listener is added, true after, false after off', () => {
    const d = new PointerEventDispatcher(stubHost());
    expect(d.hasListeners()).toBe(false);
    const cb = vi.fn();
    d.on('mousemove', cb);
    expect(d.hasListeners()).toBe(true);
    d.off('mousemove', cb);
    expect(d.hasListeners()).toBe(false);
  });

  it('dispatch(move) emits one PointerMoveEvent with mapCoord = host.unproject(point) and point = ev.point', () => {
    const d = new PointerEventDispatcher(stubHost());
    const cb = vi.fn();
    d.on('mousemove', cb);
    const e0 = ev('move', 30, 40);
    d.dispatch(e0);
    expect(cb).toHaveBeenCalledTimes(1);
    const e = cb.mock.calls[0][0];
    expect(e.point).toEqual({ x: 30, y: 40 });
    expect(e.mapCoord).toEqual([3, 4]);
    expect(e.originalEvent).toBe(e0.originalEvent);
  });

  it('dispatch ignores non-move kinds (click/down/up/wheel/dblclick/contextmenu)', () => {
    const d = new PointerEventDispatcher(stubHost());
    const cb = vi.fn();
    d.on('mousemove', cb);
    for (const k of ['click', 'down', 'up', 'wheel', 'dblclick', 'contextmenu'] as const) {
      d.dispatch(ev(k, 1, 1));
    }
    expect(cb).not.toHaveBeenCalled();
  });

  it('dispatch is a no-op when there are no listeners', () => {
    const d = new PointerEventDispatcher(stubHost());
    expect(() => d.dispatch(ev('move', 5, 5))).not.toThrow();
  });

  it('once fires exactly once then auto-removes; cancellable via off(type, cb)', () => {
    const d = new PointerEventDispatcher(stubHost());
    const once = vi.fn();
    d.once('mousemove', once);
    d.dispatch(ev('move', 10, 10));
    d.dispatch(ev('move', 20, 20));
    expect(once).toHaveBeenCalledTimes(1);
    expect(d.hasListeners()).toBe(false);
    // cancellation path:
    const c2 = vi.fn();
    d.once('mousemove', c2);
    d.off('mousemove', c2);
    d.dispatch(ev('move', 1, 1));
    expect(c2).not.toHaveBeenCalled();
  });

  it('setOnChange fires on every on/once/off', () => {
    const d = new PointerEventDispatcher(stubHost());
    const onChange = vi.fn();
    d.setOnChange(onChange);
    const cb = vi.fn();
    d.on('mousemove', cb);
    d.off('mousemove', cb);
    d.once('mousemove', vi.fn());
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('a second move emits again (not deduped — unlike feature enter/leave)', () => {
    const d = new PointerEventDispatcher(stubHost());
    const cb = vi.fn();
    d.on('mousemove', cb);
    d.dispatch(ev('move', 1, 1));
    d.dispatch(ev('move', 1, 1));
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/core/pointer-event-dispatcher.test.ts`
Expected: FAIL — module `./pointer-event-dispatcher` not found.

- [ ] **Step 3: Implement**

Create `src/core/pointer-event-dispatcher.ts` (mirrors `src/core/feature-event-dispatcher.ts`, move-only, no filter, no hit-test):

```ts
import type { NormalizedPointerEvent } from './handler';

export interface PointerMoveEvent {
  /** Element-local pixel coords (= the normalized event's `point`). */
  point: { x: number; y: number };
  /** `host.unproject(point.x, point.y)` — source-data coordinates. */
  mapCoord: [number, number];
  /** The DOM event that produced this (typed `Event`; a PointerEvent at runtime). */
  originalEvent: Event;
}

type Cb = (e: PointerMoveEvent) => void;

/** Minimal surface the dispatcher needs from Emap (keeps it unit-testable). */
export interface PointerEventMapHost {
  unproject(x: number, y: number): [number, number];
}

const TYPES = ['mousemove'] as const;
type PType = (typeof TYPES)[number];

function isPointerType(t: string): t is PType {
  return (TYPES as readonly string[]).includes(t);
}

/**
 * Delegated pointer-move event registry. Fed normalized pointer events by
 * `HandlerManager`'s sink (non-gesture move) via `Emap._syncPointerSink`.
 * Move-only by design (P8 §17.3) — `click` is covered by P3
 * `feature:click`; `down`/`up`/`wheel`/`dblclick`/`contextmenu` have no
 * consumer. No hit-test, no filter (it is not feature-scoped).
 */
export class PointerEventDispatcher {
  private _reg: Record<PType, Cb[]> = { mousemove: [] };
  /** Maps user cb → its once-wrapper so `off(type, userCb)` resolves the wrap. */
  private _onceWrap = new Map<Cb, Cb>();
  private _onChange?: () => void;

  constructor(private _host: PointerEventMapHost) {}

  /** Install a callback invoked whenever the registry changes (drives sink install/teardown). */
  setOnChange(fn: () => void): void {
    this._onChange = fn;
  }

  hasListeners(): boolean {
    return TYPES.some((t) => this._reg[t].length > 0);
  }

  on(type: string, cb: Cb): void {
    if (!isPointerType(type)) return;
    this._reg[type].push(cb);
    this._onChange?.();
  }

  once(type: string, cb: Cb): void {
    if (!isPointerType(type)) return;
    const wrap: Cb = (e) => {
      this.off(type, cb);
      cb(e);
      // onChange already fired inside off(); no second call needed.
    };
    this._onceWrap.set(cb, wrap);
    this._reg[type].push(wrap);
    this._onChange?.();
  }

  off(type: string, cb: Cb): void {
    if (!isPointerType(type)) return;
    const wrap = this._onceWrap.get(cb);
    this._reg[type] = this._reg[type].filter(
      (c) => c !== cb && (wrap === undefined || c !== wrap),
    );
    this._onceWrap.delete(cb);
    this._onChange?.();
  }

  dispatch(ev: NormalizedPointerEvent): void {
    if (!this.hasListeners()) return;
    if (ev.kind !== 'move') return;
    const entries = this._reg.mousemove;
    if (entries.length === 0) return;
    const e: PointerMoveEvent = {
      point: { x: ev.point.x, y: ev.point.y },
      mapCoord: this._host.unproject(ev.point.x, ev.point.y),
      originalEvent: ev.originalEvent,
    };
    for (const cb of entries.slice()) cb(e);
  }
}
```
> NOTE: `entries.slice()` guards against a listener mutating the registry mid-emit (a `once` wrapper calls `off` during iteration — slice-then-iterate is the safe order; `FeatureEventDispatcher._emit` is safe because its `once` `off` runs before `cb`, but here the public emit loop iterates directly so we copy first). Keep this `.slice()`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/core/pointer-event-dispatcher.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: GATE**

`npx tsc --noEmit` exit 0. `npx vitest run` full suite green (baseline 1104 + 7 new — report exact). `feature:*` (P3) tests untouched.

- [ ] **Step 6: Commit**

```bash
git add src/core/pointer-event-dispatcher.ts src/core/pointer-event-dispatcher.test.ts
git commit -m "feat(core): PointerEventDispatcher — delegated mousemove registry (DX P8)"
```

---

### Task 2: wire `PointerEventDispatcher` into Emap (combined sink + routing + export)

**Files:**
- Modify: `src/map/map.ts`
- Modify: `src/index.ts`
- Test: `src/map/handler-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing top `describe` of `src/map/handler-registry.test.ts` (reuse the existing `container()` helper):

```ts
  it('map.on(mousemove) installs the combined sink and delivers PointerMoveEvent; off clears it', () => {
    const map = new Emap({ container: container() });
    const mgr = (map as any)._handlers;
    expect(mgr._pointerSink).toBeNull();
    const cb = vi.fn();
    map.on('mousemove', cb);
    expect(typeof mgr._pointerSink).toBe('function');
    // Drive a normalized move through the sink:
    mgr._pointerSink({
      kind: 'move',
      point: { x: 20, y: 30 },
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      button: 0,
      originalEvent: new Event('pointermove'),
    });
    expect(cb).toHaveBeenCalledTimes(1);
    const e = cb.mock.calls[0][0];
    expect(e.point).toEqual({ x: 20, y: 30 });
    expect(Array.isArray(e.mapCoord)).toBe(true);
    expect(e.mapCoord).toHaveLength(2);
    map.off('mousemove', cb);
    expect(mgr._pointerSink).toBeNull();
  });

  it('sink-install matrix: feature-only / pointer-only / both / neither', () => {
    const map = new Emap({ container: container() });
    const mgr = (map as any)._handlers;
    const fcb = vi.fn();
    const pcb = vi.fn();
    expect(mgr._pointerSink).toBeNull();                 // neither
    map.on('feature:hover', {}, fcb);
    expect(typeof mgr._pointerSink).toBe('function');    // feature-only
    map.on('mousemove', pcb);
    expect(typeof mgr._pointerSink).toBe('function');    // both
    map.off('feature:hover', fcb);
    expect(typeof mgr._pointerSink).toBe('function');    // pointer-only
    map.off('mousemove', pcb);
    expect(mgr._pointerSink).toBeNull();                 // neither
  });

  it('combined sink fans out: one move reaches BOTH feature hover and mousemove', () => {
    const map = new Emap({ container: container() });
    const mgr = (map as any)._handlers;
    const fcb = vi.fn();
    const pcb = vi.fn();
    map.on('feature:hover', {}, fcb);   // no data loaded → hover may not fire, but must not throw
    map.on('mousemove', pcb);
    mgr._pointerSink({
      kind: 'move',
      point: { x: 5, y: 5 },
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      button: 0,
      originalEvent: new Event('pointermove'),
    });
    expect(pcb).toHaveBeenCalledTimes(1);   // pointer-move always delivered
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/map/handler-registry.test.ts -t "mousemove|matrix|fans out"`
Expected: FAIL — `map.on('mousemove', …)` falls through to base `EventDispatcher` (no sink installed; `_pointerSink` stays null).

- [ ] **Step 3: Implement**

(a) `src/map/map.ts` import — extend the existing feature-event import line and add the pointer type. The current line 29 is:
```ts
import { FeatureEventDispatcher, type FeatureEvent, type FeatureEventFilter } from '../core/feature-event-dispatcher';
```
Add immediately below it:
```ts
import { PointerEventDispatcher, type PointerMoveEvent } from '../core/pointer-event-dispatcher';
```

(b) Field — after `private _featureEvents!: FeatureEventDispatcher;` (around line 100) add:
```ts
  private _pointerEvents!: PointerEventDispatcher;
```

(c) Constructor wiring — the current block (around line 280-285) is:
```ts
    this._featureEvents = new FeatureEventDispatcher({
      queryFeatures: (g, o) => _self.queryFeatures(g, o) as Array<{ source: string; layer: string; id: number }>,
      unproject: (x, y) => _self.unproject(x, y),
      get features() { return _self.features; },
    });
    this._featureEvents.setOnChange(() => this._syncFeatureSink());
```
Replace those two statements with (note the rename `_syncFeatureSink`→`_syncPointerSink` and the new dispatcher + its onChange):
```ts
    this._featureEvents = new FeatureEventDispatcher({
      queryFeatures: (g, o) => _self.queryFeatures(g, o) as Array<{ source: string; layer: string; id: number }>,
      unproject: (x, y) => _self.unproject(x, y),
      get features() { return _self.features; },
    });
    this._pointerEvents = new PointerEventDispatcher({
      unproject: (x, y) => _self.unproject(x, y),
    });
    this._featureEvents.setOnChange(() => this._syncPointerSink());
    this._pointerEvents.setOnChange(() => this._syncPointerSink());
```

(d) Rename the method + combined fan-out. The current method (around line 405-411) is:
```ts
  /** Install the HandlerManager sink only while ≥1 feature listener exists. */
  private _syncFeatureSink(): void {
    if (this._featureEvents.hasListeners()) {
      this._handlers.setPointerSink((ev) => this._featureEvents.dispatch(ev));
    } else {
      this._handlers.setPointerSink(null);
    }
  }
```
Replace it entirely with:
```ts
  /**
   * Install ONE HandlerManager sink while ≥1 feature OR pointer listener
   * exists; it fans out to both dispatchers (feature events first, then
   * pointer-move — independent, order fixed for determinism). Cleared when
   * neither has listeners, so default `new Emap()` pays nothing.
   */
  private _syncPointerSink(): void {
    if (this._featureEvents.hasListeners() || this._pointerEvents.hasListeners()) {
      this._handlers.setPointerSink((ev) => {
        this._featureEvents.dispatch(ev);
        this._pointerEvents.dispatch(ev);
      });
    } else {
      this._handlers.setPointerSink(null);
    }
  }
```

(e) `grep -n "_syncFeatureSink" src/map/map.ts` — every remaining hit is a stale reference. There are 3 comments in `on`/`off`/`once` reading `// onChange callback drives _syncFeatureSink(); no explicit call needed here.` Update each to `// onChange callback drives _syncPointerSink(); no explicit call needed here.`. After this, `grep -n "_syncFeatureSink" src/map/map.ts` MUST return nothing.

(f) `on`/`off`/`once` `'mousemove'` routing. In each of the three implementation bodies, add a `'mousemove'` branch BEFORE the existing `if (type.startsWith('feature:'))` branch.

`on` — current implementation body starts:
```ts
  on(type: string, filterOrListener: unknown, listener?: unknown): this {
    if (type.startsWith('feature:')) {
```
Insert before the `feature:` `if`:
```ts
    if (type === 'mousemove') {
      this._pointerEvents.on(type, filterOrListener as (e: PointerMoveEvent) => void);
      // onChange callback drives _syncPointerSink(); no explicit call needed here.
      return this;
    }
```
And add a typed overload alongside the existing feature overloads (after Overload 3):
```ts
  // Overload 4: typed pointer-move form
  on(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;
```

`off` — insert before its `feature:` `if`:
```ts
    if (type === 'mousemove') {
      this._pointerEvents.off(type, listener as (e: PointerMoveEvent) => void);
      // onChange callback drives _syncPointerSink(); no explicit call needed here.
      return this;
    }
```
And add the overload after the existing feature `off` overload:
```ts
  off(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;
```

`once` — insert before its `feature:` `if`:
```ts
    if (type === 'mousemove') {
      this._pointerEvents.once(type, filterOrListener as (e: PointerMoveEvent) => void);
      // onChange callback drives _syncPointerSink(); no explicit call needed here.
      return this;
    }
```
And add the overload after the existing feature `once` overloads:
```ts
  // Overload 4: typed pointer-move form
  once(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;
```
> NOTE: the typed `'mousemove'` overloads must appear BEFORE the generic `on<T>(type, listener)` overload would otherwise capture them only by structural match — TypeScript picks the first matching overload, and `'mousemove'` is a string literal narrower than the generic `type: string`, so placing Overload 4 among the other specific overloads (all of which already precede the implementation signature) is correct. Do NOT remove or reorder the existing generic/feature overloads.

(g) `src/index.ts` — the current line 204 is:
```ts
export type { FeatureEvent, FeatureEventFilter } from './core/feature-event-dispatcher';
```
Add immediately below:
```ts
export type { PointerMoveEvent } from './core/pointer-event-dispatcher';
```

- [ ] **Step 4: Run + GATE**

Run: `npx vitest run src/map/handler-registry.test.ts` → existing + 3 new pass.
`npx tsc --noEmit` exit 0. `npx vitest run` full suite (baseline 1104 + 7 [T1] + 3 = report exact). `npm run build` exit 0. **`feature:*` (P3) tests + `src/map/map.test.ts` byte-identical** (the rename + fan-out preserves the same `_featureEvents.dispatch` invocation). `grep -rn "_syncFeatureSink" src/` returns NOTHING. Any P3/feature regression → STOP/BLOCKED with the failing test + output.

- [ ] **Step 5: Commit**

```bash
git add src/map/map.ts src/index.ts src/map/handler-registry.test.ts
git commit -m "feat(map): delegated map.on('mousemove'); combined fan-out pointer-sink (DX P8)"
```

---

### Task 3: `StatusControl` thin-shell + CHANGELOG

**Files:**
- Modify: `src/ui/status-control.ts`
- Create: `src/ui/status-control.test.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write the failing test**

Create `src/ui/status-control.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { StatusControl } from './status-control';

/** Minimal Emap stub: on/off registry + getCRS + getCanvasContainer. */
function stubMap() {
  const listeners: Record<string, Function[]> = {};
  return {
    on: vi.fn((type: string, cb: Function) => { (listeners[type] ??= []).push(cb); }),
    off: vi.fn((type: string, cb: Function) => {
      listeners[type] = (listeners[type] ?? []).filter((c) => c !== cb);
    }),
    getCRS: () => 'EPSG:4326',
    getCanvasContainer: () => document.createElement('div'),
    _emit: (type: string, e: unknown) => (listeners[type] ?? []).forEach((c) => c(e)),
    _count: (type: string) => (listeners[type] ?? []).length,
  };
}

describe('StatusControl (thin-shell over map.on(mousemove))', () => {
  it('onAdd subscribes map.on(mousemove); does NOT add a raw canvas listener', () => {
    const map = stubMap();
    const ctrl = new StatusControl({ showMousePos: true, showEPSG: false });
    ctrl.onAdd(map as any);
    expect(map.on).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(map._count('mousemove')).toBe(1);
  });

  it('a PointerMoveEvent updates the mouse-position text from e.mapCoord (after rAF)', async () => {
    const map = stubMap();
    const ctrl = new StatusControl({ showMousePos: true, showEPSG: false });
    const el = ctrl.onAdd(map as any);
    map._emit('mousemove', { point: { x: 0, y: 0 }, mapCoord: [12.3456789, -7.654321], originalEvent: new Event('pointermove') });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const posEl = el.querySelector('.emap-status-mousepos') as HTMLElement;
    expect(posEl.textContent).toBe(' 12.3457, -7.6543');
  });

  it('onRemove calls map.off(mousemove) with the same bound listener', () => {
    const map = stubMap();
    const ctrl = new StatusControl({ showMousePos: true, showEPSG: false });
    ctrl.onAdd(map as any);
    ctrl.onRemove();
    expect(map.off).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(map._count('mousemove')).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/status-control.test.ts`
Expected: FAIL — `map.on` not called with `'mousemove'` (control still uses `getCanvasContainer().addEventListener`).

- [ ] **Step 3: Implement**

In `src/ui/status-control.ts`:

(a) Add the type import. The current line 2 is `import { Emap } from '../map/map';`. Add below it:
```ts
import type { PointerMoveEvent } from '../core/pointer-event-dispatcher';
```

(b) Rename the bound-handler field. Current (line 19):
```ts
  private _onMouseMoveBound: (e: MouseEvent) => void;
```
Replace with:
```ts
  private _onMoveBound: (e: PointerMoveEvent) => void;
```

(c) Constructor bind. Current (line 30):
```ts
    this._onMouseMoveBound = this._onMouseMove.bind(this);
```
Replace with:
```ts
    this._onMoveBound = this._onMove.bind(this);
```

(d) `onAdd` subscription. Current (line 53):
```ts
    this._map.getCanvasContainer().addEventListener('mousemove', this._onMouseMoveBound);
```
Replace with:
```ts
    this._map.on('mousemove', this._onMoveBound);
```

(e) Replace the whole `_onMouseMove` method (lines 58-77) with `_onMove` (drops the rect/clientX math; reads `e.mapCoord`; keeps the rAF-coalesced DOM write verbatim):
```ts
  private _onMove(e: PointerMoveEvent): void {
    if (!this._map || !this._mousePosEl || !this._options.showMousePos) return;

    // Throttle DOM updates to one per animation frame.
    if (this._rafPending) return;
    this._rafPending = true;

    const [mx, my] = e.mapCoord;

    requestAnimationFrame(() => {
      this._rafPending = false;
      if (!this._map || !this._mousePosEl) return;
      this._mousePosEl.textContent = ` ${mx.toFixed(4)}, ${my.toFixed(4)}`;
    });
  }
```

(f) `onRemove` teardown. Current:
```ts
      this._map.getCanvasContainer().removeEventListener('mousemove', this._onMouseMoveBound);
```
Replace with:
```ts
      this._map.off('mousemove', this._onMoveBound);
```

> Do NOT change anything else: `StatusOptions`, the class name, the DOM/`className`/EPSG span, the `crschange` subscription, the coordinate string format (`` ` ${mx.toFixed(4)}, ${my.toFixed(4)}` ``) are all byte-identical.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/ui/status-control.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: CHANGELOG**

Add this bullet immediately AFTER the DX Phase 7 bullet in `CHANGELOG.md` `[Unreleased]` `### Added` (match the surrounding line-wrap rhythm):

```markdown
- DX Phase 8 (toward 0.3.0): delegated `map.on('mousemove', cb)` event
  (payload `{ point, mapCoord, originalEvent }`), fed by the Phase-2a
  pointer arbiter via the same sink mechanism as the Phase-3 `feature:*`
  events — exported `PointerMoveEvent` type. `StatusControl` no longer
  hand-wires a raw canvas `mousemove`; it subscribes the delegated event
  (public class/options/DOM/coordinate-string unchanged). Zero cost when
  no `mousemove`/`feature:*` listener is registered (the pointer sink is
  installed lazily and shared). One intentional, documented behavior
  change: the coordinate readout pauses during an exclusive pan/drag
  gesture (consistent with `feature:hover`) and resumes on release.
  Disabled-by-default cost model unchanged → `new Emap()` behavior
  identical.
```

- [ ] **Step 6: GATE + Commit**

`npx tsc --noEmit` exit 0. `npx vitest run` full suite green (baseline 1104 + 7 + 3 + 3 = report exact). `npm run build` exit 0. `src/map/map.test.ts` + P1–P7 + `feature:*` byte-identical.

```bash
git add src/ui/status-control.ts src/ui/status-control.test.ts CHANGELOG.md
git commit -m "refactor(ui): StatusControl consumes delegated map.on('mousemove') (DX P8)"
```

---

## Self-Review

**1. Spec coverage (§17):** §17.2 Emap-layer fan-out + rename `_syncFeatureSink`→`_syncPointerSink` + dual `setOnChange` → Task 2 (c)(d)(e). §17.3 `PointerEventDispatcher` (move-only, `TYPES=['mousemove']`, `PointerMoveEvent {point,mapCoord,originalEvent}`, `PointerEventMapHost.unproject`, `hasListeners`, once/off/`_onceWrap`/`setOnChange`, ignore non-move, zero-cost) → Task 1 code + tests. §17.4 `on/off/once` `'mousemove'` routing + typed overloads + `index.ts` export → Task 2 (f)(g). §17.5 `StatusControl` thin-shell (subscribe/`_onMove`/`mapCoord`/keep rAF/`off` on remove, public surface identical) → Task 3. §17.6 back-compat (feature:* byte-identical, arbiter untouched, default zero-cost, StatusControl API unchanged) → Task 2 GATE asserts feature:*/map.test byte-identical + the sink matrix test; Task 1 zero-cost test. §17.7 testing (dispatcher unit, Emap wiring + matrix + fan-out, StatusControl thin-shell) → Tasks 1/2/3 tests. §17.8 phasing + CHANGELOG → Task 3 Step 5; no example rewrites (correct — StatusControl change transparent). Every §17 requirement mapped.

**2. Placeholder scan:** No TBD/TODO. All code blocks complete; every exact line to replace is quoted from the current source with its replacement. The `grep` checks are concrete acceptance gates, not vague instructions.

**3. Type consistency:** `PointerMoveEvent` shape (`point:{x,y}`, `mapCoord:[number,number]`, `originalEvent:Event`) is defined once (Task 1), consumed identically in Task 2 (`(e: PointerMoveEvent) => void` overloads) and Task 3 (`_onMove(e: PointerMoveEvent)`, `e.mapCoord`). `PointerEventDispatcher` API (`on/once/off(type,cb)`, `hasListeners()`, `dispatch(ev)`, `setOnChange(fn)`) defined in Task 1, called consistently in Task 2 (c)(f). `_pointerEvents` field name consistent across Task 2 (b)(c)(d)(f). `_syncPointerSink` named consistently (Task 2 c/d/e + the comment updates). `_onMoveBound`/`_onMove` consistent across Task 3 (b)(c)(d)(e)(f). Method/host signature `unproject(x:number,y:number):[number,number]` matches the existing `Emap.unproject` used by `FeatureEventDispatcher`. No drift.

Plan is internally consistent and scoped to one shippable unit: a delegated move-only event mirroring P3, a single renamed combined sink, and a transparent StatusControl thin-shell — zero default-path behavior change beyond the one documented drag-freeze.
