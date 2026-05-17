# emap DX Phase 3 — Delegated Feature Event Dispatcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement design spec §5 — `map.on('feature:click'|'feature:hover'|'feature:enter'|'feature:leave', {source?,layers?}, cb)` — a delegated feature-event API fed by the Phase-2a pointer arbiter, reusing the existing `FeatureQuery` hit-test, decoupled from selection, zero-cost when no `feature:*` listener is registered.

**Architecture:** A new `FeatureEventDispatcher` owns a `{listener, filter}` registry per `feature:*` type and a single "last hit ref" state machine for enter/leave/hover. `HandlerManager` gains an optional pointer **sink** it calls (in addition to handler dispatch) for `click` (always) and `move` (only when no exclusive gesture is active). `Emap` overrides `on/off/once`: a `feature:`-prefixed type routes to the dispatcher (3-arg filter form), everything else falls through to the inherited `EventDispatcher` (no parallel system for consumers). Hit-test calls the existing `map.queryFeatures([x,y],{layers})` — no new hit logic, same LOD/Flatbush path.

**Tech Stack:** TypeScript 5 (strict), Vitest 1.x (jsdom), Rollup.

## Design Decisions (challenge these in review)

1. **Registration via `Emap.on/off/once` overload, not a parallel API.** `Emap extends EventDispatcher` (2-arg `on(type, listener)`). We override the three methods: if `type.startsWith('feature:')` → delegate to `FeatureEventDispatcher` with an optional filter as the middle arg (`on('feature:click', filter, cb)` OR `on('feature:click', cb)`); otherwise `super.on/off/once`. `fire` is untouched. Consumers keep using `map.on(...)` — spec §5 "no parallel system" is satisfied at the API surface; the internal registry is the new dispatcher.
2. **HandlerManager sink, called independent of consumption.** Feature events are pure notification — they must fire even when `dragPan`/`clickSelect` consumes the pointer event. `HandlerManager` gets `setPointerSink(fn | null)`. In `_dispatch`: call the sink for `ev.kind === 'click'` **always**; for `ev.kind === 'move'` **only when `this._exclusive` is null** (mid box/pan drag is not "hovering"). `down`/`up`/`wheel` are not fed (no feature semantics). The sink call happens before the handler loop and never affects `HandlerResult`/exclusive-lock.
3. **Zero-cost when idle.** `Emap` sets the sink lazily: the sink is installed only once the first `feature:*` listener is registered, and the dispatcher's `dispatch()` early-returns if its registry is empty. With no `feature:*` listener the sink is null → `_dispatch` does one `=== null` check per move/click (same "one check when none registered" shape as the validators).
4. **Hit-test reuses `map.queryFeatures`.** Point query `map.queryFeatures([x,y], listenerLayers ? {layers} : undefined)` → dedupe → topmost (first) result is the hit. No new hit-test code; same Flatbush/LOD path as everywhere else. One query is run per distinct `{layers}` filter set actually registered (deduped), not per listener.
5. **enter/leave/hover state machine** keyed by a single `string|null` "last hit key" = `source|layer|id`. On each fed `move`: compute current topmost hit (unfiltered, full visible set); if key changed → fire `feature:leave` for the old ref (to its matching listeners), `feature:enter` for the new; always fire `feature:hover` for the current ref while one exists. `click` fires only `feature:click`. Per-listener `{source?,layers?}` filter is applied at fire time (a listener only hears refs matching its filter; the state machine itself is global/unfiltered so enter/leave are correct regardless of per-listener filters).
6. **`FeatureEvent.feature`** comes from the existing `map.features.get(ref)` (frozen properties). `lngLat` from `map.unproject(point.x, point.y)`. `originalEvent` is typed `Event` (the real `NormalizedPointerEvent.originalEvent` type) — spec said `PointerEvent`; we expose the truthful `Event` type and document it (no lying casts).
7. **Decoupled from selection.** The dispatcher never calls `select()`/`setHighlightedFeatures()`. `clickSelect` (P2b) and `feature:click` are independent chains off the same normalized events. Docs show the opt-in highlight recipe; the dispatcher does not auto-highlight (single responsibility).
8. **No new public surface beyond the event names.** `FeatureEvent`/`FeatureEventFilter` types are exported (consumers type their callbacks); `FeatureEventDispatcher` is internal (constructed by `Emap`). `map.off('feature:click', fn)` removes by listener reference; the filter is stored alongside the listener so `off` needs only the fn (spec §5).

---

## File Structure

- Create `src/core/feature-event-dispatcher.ts` — registry + state machine + `dispatch(ev)`. Owns no DOM, fed normalized events.
- Create `src/core/feature-event-dispatcher.test.ts`.
- Modify `src/core/handler-manager.ts` — add `_pointerSink` field, `setPointerSink(fn|null)`, and the sink calls in `_dispatch` (decision #2). No change to existing register/dispatch/exclusive semantics.
- Modify `src/core/handler-manager.test.ts` — add sink-call tests (click always; move only when not exclusive).
- Modify `src/map/map.ts` — construct the dispatcher; override `on/off/once` for `feature:*`; lazily install/uninstall the HandlerManager sink; feed `map` (for queryFeatures/features/unproject) into the dispatcher.
- Modify `src/map/handler-registry.test.ts` — e2e: a registered `feature:click` listener fires on canvas click with the right ref/feature; zero listeners ⇒ no sink cost.
- Modify `src/index.ts` — export `FeatureEvent`, `FeatureEventFilter` types (and `FeatureEventDispatcher` type for advanced typing, value not required).
- Modify `CHANGELOG.md`.

---

### Task 1: HandlerManager pointer sink

**Files:**
- Modify: `src/core/handler-manager.ts`
- Test: `src/core/handler-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/core/handler-manager.test.ts` (it already has `// @vitest-environment jsdom` at top and a `recordingHandler` helper in the arbitration describe; add a NEW describe):

```ts
describe('HandlerManager pointer sink', () => {
  function passHandler(name = 'dragPan') {
    return { name, enable() {}, disable() {}, isEnabled: () => true,
      setOptions() {}, getOptions: () => ({}), handlePointer: () => 'passthrough' as const };
  }
  function exclHandler(name = 'dragPan') {
    let on = false;
    return { name, enable() {}, disable() {}, isEnabled: () => true,
      setOptions() {}, getOptions: () => ({}),
      handlePointer: (e: any) => { if (e.kind === 'down') { on = true; return 'exclusive' as const; }
        if (e.kind === 'up') { on = false; return 'passthrough' as const; }
        return on ? 'exclusive' as const : 'passthrough' as const; } };
  }
  function norm(kind: any) {
    return { kind, point: { x: 1, y: 2 }, modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      button: 0, originalEvent: new Event(kind) };
  }
  function mgrWith(h: any) {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} }) as any;
    const m = new HandlerManager();
    m.register(h);
    m.attach(el);
    return { m, el };
  }

  it('sink receives click and move (no exclusive); not down/up', () => {
    const seen: string[] = [];
    const { m } = mgrWith(passHandler());
    m.setPointerSink((e) => seen.push(e.kind));
    (m as any)._dispatch(norm('down'));
    (m as any)._dispatch(norm('move'));
    (m as any)._dispatch(norm('up'));
    (m as any)._dispatch(norm('click'));
    expect(seen).toEqual(['move', 'click']);
    m.detach();
  });

  it('sink does NOT get move while an exclusive gesture is active; still gets click', () => {
    const seen: string[] = [];
    const { m } = mgrWith(exclHandler());
    m.setPointerSink((e) => seen.push(e.kind));
    (m as any)._dispatch(norm('down'));   // handler → exclusive
    (m as any)._dispatch(norm('move'));   // suppressed (mid-gesture)
    (m as any)._dispatch(norm('up'));     // releases
    (m as any)._dispatch(norm('move'));   // now allowed
    (m as any)._dispatch(norm('click'));
    expect(seen).toEqual(['move', 'click']);
    m.detach();
  });

  it('setPointerSink(null) removes the sink', () => {
    const seen: string[] = [];
    const { m } = mgrWith(passHandler());
    m.setPointerSink((e) => seen.push(e.kind));
    m.setPointerSink(null);
    (m as any)._dispatch(norm('click'));
    expect(seen).toEqual([]);
    m.detach();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/handler-manager.test.ts -t "pointer sink"`
Expected: FAIL — `m.setPointerSink is not a function`.

- [ ] **Step 3: Implement**

In `src/core/handler-manager.ts`:

Add a field next to `private _exclusive: Handler | null = null;`:
```ts
  private _pointerSink: ((ev: NormalizedPointerEvent) => void) | null = null;
```
Add a method (place right after `attach`/`detach`, before `_norm`):
```ts
  /** Install (or clear with `null`) a passive observer fed click + non-gesture move. */
  setPointerSink(sink: ((ev: NormalizedPointerEvent) => void) | null): void {
    this._pointerSink = sink;
  }
```
In `_dispatch`, add the sink call as the FIRST statements (before the exclusive-lock check), so it observes every relevant event without affecting routing:
```ts
  private _dispatch(ev: NormalizedPointerEvent): void {
    if (this._pointerSink) {
      if (ev.kind === 'click' || (ev.kind === 'move' && !this._exclusive)) {
        this._pointerSink(ev);
      }
    }
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
(`detach()` should also clear the sink — add `this._pointerSink = null;` next to `this._exclusive = null;` in `detach`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/handler-manager.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: GATE**

Run: `npx tsc --noEmit` (exit 0) AND `npx vitest run` (full suite green; the P2a `handler-manager` arbitration tests + P2b conflict tests unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/core/handler-manager.ts src/core/handler-manager.test.ts
git commit -m "feat(core): HandlerManager passive pointer sink (DX P3)"
```

---

### Task 2: FeatureEventDispatcher (registry + state machine)

**Files:**
- Create: `src/core/feature-event-dispatcher.ts`
- Test: `src/core/feature-event-dispatcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/feature-event-dispatcher.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { FeatureEventDispatcher } from './feature-event-dispatcher';
import type { NormalizedPointerEvent } from './handler';

function ev(kind: 'move' | 'click', x: number, y: number): NormalizedPointerEvent {
  return { kind, point: { x, y }, modifiers: { shift: false, ctrl: false, alt: false, meta: false },
    button: 0, originalEvent: new Event(kind) };
}

// Minimal map stub: queryFeatures returns scripted hits; features.get echoes a feature; unproject trivial.
function stubMap(script: Array<Array<{ source: string; layer: string; id: number }>>) {
  let i = 0;
  return {
    queryFeatures: vi.fn(() => script[Math.min(i++, script.length - 1)]),
    unproject: (x: number, y: number) => [x / 10, y / 10] as [number, number],
    features: { get: (ref: any) => ({ ref, geometry: null, properties: Object.freeze({ k: ref.id }) }) },
  };
}

describe('FeatureEventDispatcher', () => {
  it('hasListeners() false until a feature:* listener is added', () => {
    const d = new FeatureEventDispatcher(stubMap([[]]) as any);
    expect(d.hasListeners()).toBe(false);
    d.on('feature:click', undefined, () => {});
    expect(d.hasListeners()).toBe(true);
  });

  it('feature:click fires with ref + frozen feature + lngLat for the topmost hit', () => {
    const map = stubMap([[{ source: 's', layer: 'l', id: 9 }, { source: 's', layer: 'l', id: 9 }]]);
    const d = new FeatureEventDispatcher(map as any);
    const cb = vi.fn();
    d.on('feature:click', undefined, cb);
    d.dispatch(ev('click', 30, 40));
    expect(cb).toHaveBeenCalledTimes(1);
    const e = cb.mock.calls[0][0];
    expect(e).toMatchObject({ type: 'feature:click', ref: { source: 's', layer: 'l', id: 9 },
      point: { x: 30, y: 40 }, lngLat: [3, 4] });
    expect(e.feature.properties).toEqual({ k: 9 });
    expect(Object.isFrozen(e.feature.properties)).toBe(true);
  });

  it('enter/leave/hover state machine across moves', () => {
    const map = stubMap([
      [{ source: 's', layer: 'l', id: 1 }],   // move1 → enter 1, hover 1
      [{ source: 's', layer: 'l', id: 1 }],   // move2 → hover 1 (no enter/leave)
      [{ source: 's', layer: 'l', id: 2 }],   // move3 → leave 1, enter 2, hover 2
      [],                                      // move4 → leave 2
    ]);
    const d = new FeatureEventDispatcher(map as any);
    const enter = vi.fn(), leave = vi.fn(), hover = vi.fn();
    d.on('feature:enter', undefined, enter);
    d.on('feature:leave', undefined, leave);
    d.on('feature:hover', undefined, hover);
    d.dispatch(ev('move', 0, 0));
    d.dispatch(ev('move', 1, 1));
    d.dispatch(ev('move', 2, 2));
    d.dispatch(ev('move', 3, 3));
    expect(enter.mock.calls.map((c) => c[0].ref.id)).toEqual([1, 2]);
    expect(leave.mock.calls.map((c) => c[0].ref.id)).toEqual([1, 2]);
    expect(hover.mock.calls.map((c) => c[0].ref.id)).toEqual([1, 1, 2]);
  });

  it('per-listener {layers} filter: only matching refs delivered', () => {
    const map = stubMap([[{ source: 's', layer: 'roads', id: 5 }]]);
    const d = new FeatureEventDispatcher(map as any);
    const roads = vi.fn(), water = vi.fn();
    d.on('feature:click', { layers: ['roads'] }, roads);
    d.on('feature:click', { layers: ['water'] }, water);
    d.dispatch(ev('click', 0, 0));
    expect(roads).toHaveBeenCalledTimes(1);
    expect(water).not.toHaveBeenCalled();
    // queryFeatures called with the union/!per-filter — at least the layers filter is honored:
    expect(map.queryFeatures).toHaveBeenCalled();
  });

  it('off removes by listener reference (filter stored alongside)', () => {
    const map = stubMap([[{ source: 's', layer: 'l', id: 1 }]]);
    const d = new FeatureEventDispatcher(map as any);
    const cb = vi.fn();
    d.on('feature:click', { layers: ['l'] }, cb);
    d.off('feature:click', cb);
    d.dispatch(ev('click', 0, 0));
    expect(cb).not.toHaveBeenCalled();
    expect(d.hasListeners()).toBe(false);
  });

  it('empty registry → dispatch is a no-op (no queryFeatures call)', () => {
    const map = stubMap([[{ source: 's', layer: 'l', id: 1 }]]);
    const d = new FeatureEventDispatcher(map as any);
    d.dispatch(ev('click', 0, 0));
    d.dispatch(ev('move', 0, 0));
    expect(map.queryFeatures).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/feature-event-dispatcher.test.ts`
Expected: FAIL — `Cannot find module './feature-event-dispatcher'`.

- [ ] **Step 3: Implement**

Create `src/core/feature-event-dispatcher.ts`:

```ts
import type { NormalizedPointerEvent } from './handler';
import type { FeatureRef } from '../map/types';
import type { Feature } from '../map/feature-accessor';

/** Restrict which features a `feature:*` listener hears. Omitted = all visible. */
export interface FeatureEventFilter {
  source?: string;
  layers?: string[];
}

export interface FeatureEvent {
  type: string;
  feature: Feature;
  ref: FeatureRef;
  point: { x: number; y: number };
  lngLat: [number, number];
  modifiers: { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean };
  /** The DOM event that produced this (typed `Event`; it is a PointerEvent/MouseEvent at runtime). */
  originalEvent: Event;
}

type Cb = (e: FeatureEvent) => void;
type Entry = { filter?: FeatureEventFilter; cb: Cb };

/** Minimal surface the dispatcher needs from Emap (keeps it unit-testable). */
export interface FeatureEventMapHost {
  queryFeatures(
    geom: [number, number],
    opts?: { layers?: string[] },
  ): Array<{ source: string; layer: string; id: number }>;
  unproject(x: number, y: number): [number, number];
  features: { get(ref: FeatureRef): Feature | null };
}

const TYPES = ['feature:click', 'feature:hover', 'feature:enter', 'feature:leave'] as const;
type FType = (typeof TYPES)[number];

function isFeatureType(t: string): t is FType {
  return (TYPES as readonly string[]).includes(t);
}
function keyOf(r: FeatureRef): string { return `${r.source}|${r.layer}|${r.id}`; }
function matches(filter: FeatureEventFilter | undefined, ref: FeatureRef): boolean {
  if (!filter) return true;
  if (filter.source && filter.source !== ref.source) return false;
  if (filter.layers && !filter.layers.includes(ref.layer)) return false;
  return true;
}

/**
 * Delegated feature-event registry + enter/leave/hover state machine.
 * Fed normalized pointer events by `HandlerManager`'s sink (click + non-
 * gesture move). Reuses `host.queryFeatures` (existing FeatureQuery/LOD
 * path) — no new hit-test. Decoupled from selection.
 */
export class FeatureEventDispatcher {
  private _reg: Record<FType, Entry[]> = {
    'feature:click': [], 'feature:hover': [], 'feature:enter': [], 'feature:leave': [],
  };
  private _lastKey: string | null = null;
  private _lastRef: FeatureRef | null = null;

  constructor(private _host: FeatureEventMapHost) {}

  hasListeners(): boolean {
    return TYPES.some((t) => this._reg[t].length > 0);
  }

  /** `on(type, filter, cb)` or `on(type, cb)`. Non-feature types are rejected (Emap routes them). */
  on(type: string, filter: FeatureEventFilter | undefined, cb: Cb): void {
    if (!isFeatureType(type)) return;
    this._reg[type].push({ filter, cb });
  }

  off(type: string, cb: Cb): void {
    if (!isFeatureType(type)) return;
    this._reg[type] = this._reg[type].filter((e) => e.cb !== cb);
  }

  /** Topmost hit at a point, restricted to the union of all registered filters' layers. */
  private _hit(x: number, y: number): FeatureRef | null {
    // Union of layer filters across all registered entries; undefined = unrestricted.
    let layers: string[] | undefined = [];
    for (const t of TYPES) {
      for (const e of this._reg[t]) {
        if (!e.filter?.layers) { layers = undefined; break; }
        layers.push(...e.filter.layers);
      }
      if (layers === undefined) break;
    }
    const hits = this._host.queryFeatures([x, y], layers && layers.length ? { layers } : undefined);
    if (hits.length === 0) return null;
    const h = hits[0];
    return { source: h.source, layer: h.layer, id: h.id };
  }

  private _emit(type: FType, ref: FeatureRef, ev: NormalizedPointerEvent): void {
    const entries = this._reg[type];
    if (entries.length === 0) return;
    let built: FeatureEvent | null = null;
    for (const e of entries) {
      if (!matches(e.filter, ref)) continue;
      if (!built) {
        const feature = this._host.features.get(ref);
        if (!feature) return;
        built = {
          type, feature, ref,
          point: { x: ev.point.x, y: ev.point.y },
          lngLat: this._host.unproject(ev.point.x, ev.point.y),
          modifiers: { ...ev.modifiers },
          originalEvent: ev.originalEvent,
        };
      }
      e.cb(built);
    }
  }

  dispatch(ev: NormalizedPointerEvent): void {
    if (!this.hasListeners()) return;
    if (ev.kind === 'click') {
      const ref = this._hit(ev.point.x, ev.point.y);
      if (ref) this._emit('feature:click', ref, ev);
      return;
    }
    if (ev.kind !== 'move') return;
    const ref = this._hit(ev.point.x, ev.point.y);
    const key = ref ? keyOf(ref) : null;
    if (key !== this._lastKey) {
      if (this._lastRef) this._emit('feature:leave', this._lastRef, ev);
      if (ref) this._emit('feature:enter', ref, ev);
      this._lastKey = key;
      this._lastRef = ref;
    }
    if (ref) this._emit('feature:hover', ref, ev);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/feature-event-dispatcher.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/feature-event-dispatcher.ts src/core/feature-event-dispatcher.test.ts
git commit -m "feat(core): FeatureEventDispatcher registry + enter/leave/hover state machine (DX P3)"
```

---

### Task 3: Wire dispatcher into Emap (`on/off/once` overload + lazy sink)

**Files:**
- Modify: `src/map/map.ts`
- Modify: `src/index.ts`
- Test: `src/map/handler-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing top `describe` of `src/map/handler-registry.test.ts` (reuse its `container()` + canvas-2d `beforeAll`):

```ts
  it('map.on("feature:click", filter, cb) fires for the hit feature via the arbiter', () => {
    const map = new Emap({ container: container() });
    const canvas = map.getCanvasContainer();
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
    const hit = { source: 's', layer: 'l', id: 1 };
    (map as any).queryFeatures = () => [hit];
    (map as any).features = { get: (r: any) => ({ ref: r, geometry: null, properties: Object.freeze({}) }) };
    const cb = vi.fn();
    map.on('feature:click', { layers: ['l'] }, cb);
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10, button: 0 }));
    canvas.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 10 }));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toMatchObject({ type: 'feature:click', ref: hit });
  });

  it('non-feature map.on still works (super delegation unaffected)', () => {
    const map = new Emap({ container: container() });
    const cb = vi.fn();
    map.on('move', cb);
    map.fire('move', { foo: 1 });
    expect(cb).toHaveBeenCalled();
  });

  it('no feature:* listener ⇒ no pointer sink installed (zero cost)', () => {
    const map = new Emap({ container: container() });
    const hm = (map as any)._handlers;
    expect((hm as any)._pointerSink).toBeNull();
    const cb = () => {};
    map.on('feature:hover', cb);
    expect((hm as any)._pointerSink).not.toBeNull();
    map.off('feature:hover', cb);
    expect((hm as any)._pointerSink).toBeNull();
  });
```
(Ensure the test file imports `vi` from vitest — it should already; if not, add it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/map/handler-registry.test.ts -t "feature:click"`
Expected: FAIL — `feature:click` not routed (fires nothing / super has no such listeners).

- [ ] **Step 3: Implement**

In `src/map/map.ts`:

(a) Import (near other core imports):
```ts
import { FeatureEventDispatcher, type FeatureEventFilter } from '../core/feature-event-dispatcher';
```

(b) Field (near `private _handlers: HandlerManager;`):
```ts
  private _featureEvents!: FeatureEventDispatcher;
```

(c) Construct it AFTER `this._handlers.attach(this._canvasContainer);` and after `this._featureQuery` exists (it is created earlier at ~L257; `this.features` accessor and `this.unproject` are instance methods so passing `this` is fine):
```ts
    this._featureEvents = new FeatureEventDispatcher(this);
```
(`Emap` already satisfies `FeatureEventMapHost` structurally: it has `queryFeatures`, `unproject`, and the public `features` accessor. If TypeScript complains about the `queryFeatures` overload shape, pass an explicit adapter object `{ queryFeatures: (g, o) => this.queryFeatures(g, o), unproject: (x, y) => this.unproject(x, y), features: this.features }` instead — do whichever compiles cleanly with zero `any`.)

(d) Override `on/off/once` — add these methods to the `Emap` class (they shadow the inherited `EventDispatcher` ones; non-feature types delegate to `super`):
```ts
  /**
   * `on('feature:click'|'feature:hover'|'feature:enter'|'feature:leave',
   * filter?, cb)` registers a delegated feature listener; any other type
   * is a normal EventDispatcher subscription.
   */
  on(type: string, filterOrListener: unknown, listener?: unknown): this {
    if (type.startsWith('feature:')) {
      const cb = (listener ?? filterOrListener) as (e: never) => void;
      const filter = (listener ? filterOrListener : undefined) as FeatureEventFilter | undefined;
      this._featureEvents.on(type, filter, cb as (e: import('../core/feature-event-dispatcher').FeatureEvent) => void);
      this._syncFeatureSink();
      return this;
    }
    return super.on(type, filterOrListener as (e: { type: string }) => void);
  }

  off(type: string, listener: unknown): this {
    if (type.startsWith('feature:')) {
      this._featureEvents.off(type, listener as (e: import('../core/feature-event-dispatcher').FeatureEvent) => void);
      this._syncFeatureSink();
      return this;
    }
    return super.off(type, listener as (e: { type: string }) => void);
  }

  once(type: string, filterOrListener: unknown, listener?: unknown): this {
    if (type.startsWith('feature:')) {
      const cb = (listener ?? filterOrListener) as (e: import('../core/feature-event-dispatcher').FeatureEvent) => void;
      const filter = (listener ? filterOrListener : undefined) as FeatureEventFilter | undefined;
      const wrap = (e: import('../core/feature-event-dispatcher').FeatureEvent) => { this._featureEvents.off(type, wrap); this._syncFeatureSink(); cb(e); };
      this._featureEvents.on(type, filter, wrap);
      this._syncFeatureSink();
      return this;
    }
    return super.once(type, filterOrListener as (e: { type: string }) => void);
  }

  /** Install the HandlerManager sink only while ≥1 feature listener exists. */
  private _syncFeatureSink(): void {
    if (this._featureEvents.hasListeners()) {
      this._handlers.setPointerSink((ev) => this._featureEvents.dispatch(ev));
    } else {
      this._handlers.setPointerSink(null);
    }
  }
```
> NOTE: `super.on/off/once` signatures are `(type, listener)`. Match the exact `EventListener` parameter type used by `EventDispatcher` (see `src/core/events.ts`) to avoid an `any`. If the override's signature is incompatible with the base class under strict TS, widen the base call via the precise `EventListener` type rather than casting to `any`; if genuinely impossible without `any`, STOP and report BLOCKED with the tsc error (do not ship an `any` cast silently).

In `src/index.ts`, add after the P2b handler exports:
```ts
export type { FeatureEvent, FeatureEventFilter } from './core/feature-event-dispatcher';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/map/handler-registry.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: GATE — no default behavior change**

Run: `npx tsc --noEmit` (exit 0) AND `npx vitest run` AND `npm run build` (exit 0).
**`src/map/map.test.ts` and all P1/P2a/P2b suites must pass byte-identically** — overriding `on/off/once` must not change non-`feature:` behavior (the early `startsWith` guard + `super` delegation guarantees this; the tests prove it). If any existing `on`/`off` test regresses, STOP and report BLOCKED.

- [ ] **Step 6: Commit**

```bash
git add src/map/map.ts src/index.ts src/map/handler-registry.test.ts
git commit -m "feat(map): delegated feature:* events via Emap.on overload + lazy sink (DX P3)"
```

---

### Task 4: CHANGELOG + docs recipe

**Files:** Modify `CHANGELOG.md` (`[Unreleased]` → existing `### Added`).

- [ ] **Step 1: Add after the Phase-2b bullet**

```markdown
- DX Phase 3 (toward 0.3.0): delegated feature events —
  `map.on('feature:click'|'feature:hover'|'feature:enter'|'feature:leave',
  { source?, layers? }?, cb)`. Fed by the Phase-2a pointer arbiter, hit-test
  reuses the existing `FeatureQuery` (no new path), decoupled from
  selection. Zero cost when no `feature:*` listener is registered (the
  pointer sink is installed lazily). Canonical highlight recipe:
  `map.on('feature:enter', {}, e => map.setHighlightedFeatures([e.ref]));
  map.on('feature:leave', {}, () => map.clearHighlightedFeatures());` —
  replaces the manual mousemove-poll + highlight-sync boilerplate.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG for DX Phase 3 feature events"
```

---

## Self-Review

**1. Spec coverage (design spec §5):** Four events `feature:click|hover|enter|leave` with `{source?,layers?}` filter → Tasks 2/3. Fed by `HandlerManager` → Task 1 sink + Task 3 lazy install. Hit-test reuses `FeatureQuery` via `map.queryFeatures` (no new path) → Task 2 `_hit`. Listener registry filtered by `{source?,layers?}`, one hit query per event (deduped to the union of registered layer filters) → Task 2 `_hit`/`_emit`. Zero cost when none registered → decision #3, Task 1 (`_pointerSink` null check) + Task 2 (`hasListeners` early return) + Task 3 (lazy `_syncFeatureSink`), asserted by the "no sink installed" + "empty registry no-op" tests. enter/leave/hover last-hit state machine → Task 2 `dispatch`. Decoupled from selection / no auto-highlight → dispatcher never calls select/highlight (decision #7); recipe documented → Task 4. `off`/`once` reuse + filter stored alongside listener, `off` by reference → Task 2 `off`, Task 3 `once` override, asserted by the "off removes by reference" test. `FeatureEvent` from existing `FeatureAccessor` with frozen properties → Task 2 `_emit` uses `host.features.get`; `lngLat` via `unproject`. Big-dataset perf = same `FeatureQuery` path, no regression → decision #4. Every §5 requirement mapped.

**2. Placeholder scan:** No TBD/TODO. Every code step is complete. Two NOTE callouts (Task 3c host adapter, Task 3d `super` signature) are precise correctness instructions with a concrete fallback and an explicit "STOP/BLOCKED rather than `any`" rule — not deferred design. The `import('...').FeatureEvent` inline type imports are valid TS used to avoid a top-of-file type import churn in map.ts; an implementer may hoist them to a normal `import type` if cleaner — behavior identical.

**3. Type consistency:** `NormalizedPointerEvent` is the P1/P2a type from `src/core/handler.ts`, used identically in Tasks 1/2/3. `FeatureRef` = `{id,source,layer}` from `src/map/types.ts` (verified). `Feature` = `{ref,geometry,properties}` from `src/map/feature-accessor.ts` (verified) via `map.features.get`. `queryFeatures([x,y],{layers?})` matches the real `Emap.queryFeatures` point-form signature (verified). `FeatureEventFilter`/`FeatureEvent` defined once in Task 2, consumed by Task 3 + exported in Task 3. `setPointerSink(fn|null)` signature identical across Task 1 definition and Task 3 call sites. `_syncFeatureSink` consistently gated on `hasListeners()` (Task 2) in all three override paths (Task 3). The sink fires for click-always / move-if-not-exclusive in both Task 1 (`_dispatch`) and is what Task 2's `dispatch` expects (it only acts on `click`/`move`). No signature drift.

Plan is internally consistent and scoped to one shippable unit: an opt-in, zero-when-idle delegated feature-event API with zero change to any existing default-path or non-`feature:` event behavior.
