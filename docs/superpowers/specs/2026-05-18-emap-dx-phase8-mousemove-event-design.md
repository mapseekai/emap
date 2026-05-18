# emap DX Phase 8 — Delegated `mousemove` Event Design

> **Status:** Approved (brainstorm artifact). Extends the master design
> `2026-05-17-emap-maplibre-dx-design.md` with a new section §17 (phase P8).
> Mirrors the P3 (`feature:*`) delegated-event pattern. Next: writing-plans
> → subagent-driven execution + two-stage review. Release policy unchanged
> (accumulate toward 0.3.0; `package.json` stays `0.2.0`). OpenSpec skipped
> per the P1–P7 precedent (user-elected).

## 17. `mousemove` becomes a delegated arbiter event

### 17.1 Problem & Goal

After P1–P7 the interaction layer is uniform except for **one** pointer
interaction still bypassing the `HandlerManager` arbiter:
`StatusControl` (`src/ui/status-control.ts:53`) attaches its **own** raw
`mousemove` listener on the canvas container to display the cursor's
projected coordinate. This is the exact pre-P3 anti-pattern (a control
hand-wiring a raw pointer listener instead of consuming a delegated map
event). Goal: expose a delegated `map.on('mousemove', cb)` event fed by the
arbiter's existing pointer-sink — identical mechanism to P3's `feature:*` —
and make `StatusControl` a thin consumer. No new `Handler` (cursor readout
has no gesture / exclusivity); no new arbiter surface.

### 17.2 Sink fan-out at the Emap layer (user-approved)

`HandlerManager.setPointerSink` is a **single slot**, fed `click` +
non-gesture `move` (`src/core/handler-manager.ts:107-110`,
gated by `!this._exclusive`). P3 owns it today via
`Emap._syncFeatureSink` (`src/map/map.ts:405-411`).

Decision: **fan out at the Emap layer; the arbiter is untouched.**
- Rename `Emap._syncFeatureSink` → `_syncPointerSink`. It installs **one**
  combined sink iff `this._featureEvents.hasListeners() ||
  this._pointerEvents.hasListeners()`, else clears it
  (`setPointerSink(null)`). The installed sink fans out:
  ```ts
  this._handlers.setPointerSink((ev) => {
    this._featureEvents.dispatch(ev);
    this._pointerEvents.dispatch(ev);
  });
  ```
- Every call site that currently calls `_syncFeatureSink()` calls
  `_syncPointerSink()`. `_pointerEvents.setOnChange(() => this
  ._syncPointerSink())` is wired alongside the existing
  `_featureEvents.setOnChange(...)` (constructor, near `map.ts:285`).
- Rejected alternative (`addPointerSink`/`removePointerSink` list on the
  arbiter): widening P1 shared core for two internal consumers is
  over-engineering; Emap-level fan-out is the minimal seam.

`feature:*` dispatch is **byte-identical** — the same
`_featureEvents.dispatch(ev)` call, merely invoked from the renamed combined
sink. Order: `_featureEvents.dispatch(ev)` **before**
`_pointerEvents.dispatch(ev)` (deterministic; the two are independent —
feature events hit-test, pointer-move does not — so order is immaterial to
correctness but fixed for test stability).

### 17.3 New unit — `PointerEventDispatcher`

`src/core/pointer-event-dispatcher.ts`, mirroring
`src/core/feature-event-dispatcher.ts`:

- `TYPES = ['mousemove'] as const` (scope: move only — user-approved YAGNI;
  `click` is already covered by P3 `feature:click`; `mousedown`/`mouseup`
  have no consumer).
- Constructor takes a host exposing `unproject(x:number, y:number):
  [number, number]` (the `Emap`; the dispatcher never imports `Emap` —
  it takes a minimal `PointerEventHost` interface, like
  `FeatureEventDispatcher` takes its host).
- `on(type, cb)` / `off(type, cb)` / `once(type, cb)` — same registry +
  once-wrap bookkeeping shape as `FeatureEventDispatcher` (including the
  `_onceWrap` map + `setOnChange(fn)` so install/teardown of the sink is
  driven by listener count, exactly as P3 does).
- `hasListeners(): boolean` — true iff ≥1 `mousemove` listener.
- `dispatch(ev: NormalizedPointerEvent): void` — **returns immediately
  unless `ev.kind === 'move'`** (ignores `click`/`down`/`up`/`wheel`/
  `dblclick`/`contextmenu`). On `move`: compute
  `[mx, my] = host.unproject(ev.point.x, ev.point.y)` and emit to every
  `mousemove` listener a frozen:
  ```ts
  interface PointerMoveEvent {
    point: { x: number; y: number };   // element-local px (= ev.point)
    mapCoord: [number, number];        // host.unproject(point) — source-data coords
    originalEvent: Event;              // ev.originalEvent
  }
  ```
- Zero cost when no listener: `hasListeners()` is false → `_syncPointerSink`
  does not install the sink → `dispatch` is never called. Same cost model
  as P3 (`new Emap()` pays nothing).

`mapCoord` is `unproject(point.x, point.y)` — **exactly** the math
`StatusControl._onMouseMove` does today (`clientX/Y − rect` is the arbiter's
own `_norm` element-local `point`; `unproject` is identical), so the
displayed value is unchanged (modulo §17.5).

### 17.4 `Emap.on/off/once` routing + export

Add a `type === 'mousemove'` branch to the existing `on`/`off`/`once`
overloads in `map.ts` (sibling to the `type.startsWith('feature:')`
branch), delegating to `_pointerEvents`. Add a typed overload
`on(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this`
(and matching `off`/`once`) so `map.on('mousemove', e => e.mapCoord)`
type-checks (mirrors the P3 2-arg `FeatureEvent` overload). Export
`PointerMoveEvent` from `src/index.ts` (type-only) next to the P3
`FeatureEvent` export. No change to the generic base `on<T>()` overload or
to any `feature:*` / other event behavior.

### 17.5 `StatusControl` thin-shell

`src/ui/status-control.ts`:
- `onAdd`: replace
  `this._map.getCanvasContainer().addEventListener('mousemove',
  this._onMouseMoveBound)` with `this._map.on('mousemove',
  this._onMoveBound)`.
- `_onMouseMove(e: MouseEvent)` → `_onMove(e: PointerMoveEvent)`: drop the
  `getBoundingClientRect()` + `clientX/Y − rect` + `unproject` block;
  read `[mx, my] = e.mapCoord` directly. **Keep** the existing
  `_rafPending` rAF-coalesced `textContent` write (a DOM-write perf
  optimization, independent of the event source — preserved verbatim).
- `onRemove`: `this._map.off('mousemove', this._onMoveBound)` replacing the
  `removeEventListener`.
- Public surface byte-identical: constructor `StatusControlOptions`
  (`showMousePos`, EPSG, etc.), the `crschange` subscription, the rendered
  DOM, and the displayed coordinate string format are all unchanged.

**Behavior change (accepted, user-approved, documented):** because the
arbiter sink is gated by `!this._exclusive`, the coordinate readout
**freezes during an exclusive pan/drag gesture** and resumes on release.
This is the *only* observable difference and is consistent with P3
`feature:hover` (same sink, same gating) — model uniformity over a
negligible UX regression for a passive readout.

### 17.6 Back-compat invariants

- New: `map.on('mousemove'|...)` delegated event + exported
  `PointerMoveEvent` type + new internal
  `src/core/pointer-event-dispatcher.ts`.
- `feature:*` (P3) **byte-identical**: same `_featureEvents.dispatch(ev)`,
  invoked from the renamed combined sink; `FeatureEventDispatcher`
  untouched.
- `HandlerManager` **untouched** (no new sink API; `setPointerSink` stays
  single-slot; no new event kind).
- Default `new Emap()` unchanged: no `mousemove` listener by default →
  `_pointerEvents.hasListeners()` false → sink not installed →
  `dispatch` never runs. Identical zero-cost model to P3.
- `StatusControl` public class / options / DOM / coordinate-string format
  unchanged; only the internal pointer source changes (+ the §17.5
  drag-freeze).
- P1–P7 handlers, `map.test.ts`, selection/pan/zoom/edit byte-identical.

### 17.7 Testing strategy

- `PointerEventDispatcher` unit (`src/core/pointer-event-dispatcher.test.ts`):
  `dispatch` with `kind:'move'` → emits one `PointerMoveEvent` whose
  `mapCoord` equals the stub `host.unproject` result and `point` ===
  `ev.point`; `dispatch` with `kind` in `click`/`down`/`up`/`wheel`/
  `dblclick`/`contextmenu` → **no emission**; `hasListeners()` false until
  `on`, true after, false after `off`; `once` fires once then auto-removes
  and is cancelable via `off(type, cb)`; `setOnChange` invoked on
  add/remove.
- `Emap` wiring (`src/map/` test): `map.on('mousemove', cb)` installs the
  combined sink (`setPointerSink` non-null) and `cb` receives
  `{point, mapCoord, originalEvent}` on a normalized move; `map.off`
  removes it and — when no `feature:*` listener remains — clears the sink
  (`setPointerSink(null)`); the **matrix**: feature-only listener → sink
  installed; pointer-only → installed; both → installed (single sink, fans
  out to both); neither → cleared. A `feature:*` regression assertion:
  with both listener kinds, a normalized `move` reaches **both** the
  feature hover state machine and the `mousemove` listener.
- `StatusControl` thin-shell test: on `onAdd` subscribes `map.on
  ('mousemove', …)`; a dispatched `PointerMoveEvent` updates the
  mouse-position element text (after the rAF flush) to the
  `mapCoord`-formatted string; `onRemove` calls `map.off('mousemove', …)`.
- Gate: `tsc --noEmit` 0, full `vitest run` green, `npm run build` 0;
  `feature:*` (P3) tests + `map.test.ts` + P1–P7 byte-identical.

### 17.8 Phasing

P8, independently testable / PR-able, after P7 (done). Own implementation
plan via writing-plans; subagent-driven execution + two-stage review per
task + a holistic review. No example rewrites (the `StatusControl` change
is transparent except the §17.5 drag-freeze; status-control is used across
many `test/examples/*.html` and needs no per-file edit). CHANGELOG
`[Unreleased]` `### Added` gets a P8 bullet. The remaining P2c (selection
controls thin-shell + `SelectMode`/`BoxSelectStyle`/`DrawGeometryType` type
consolidation) and P4 (CSS variables) are separate, unaffected; the
optional MouseWheel→arbiter `'wheel'` consolidation remains a low-value
deferred tidy.

## 18. OpenSpec note

Per `CLAUDE.md` this is a new public-surface addition (a delegated event +
exported type) normally warranting an OpenSpec proposal. Consistent with
P1–P7, the user has elected to skip OpenSpec and proceed brainstorm-doc →
writing-plans directly.
