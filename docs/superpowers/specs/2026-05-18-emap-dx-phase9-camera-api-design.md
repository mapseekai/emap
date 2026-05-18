# emap DX Phase 9 — MapLibre-Parity Camera API Design

> **Status:** Approved (brainstorm artifact). Extends the master design
> `2026-05-17-emap-maplibre-dx-design.md` with a new section §19 (phase P9).
> First of a 3-part DX-ergonomics batch: **P9 camera API** → P10 typed
> `EmapEventMap` (covers P9's new events) → P11 per-handler cursor. Next:
> writing-plans → subagent-driven execution + two-stage review. Release
> policy unchanged (accumulate toward 0.3.0; `package.json` stays `0.2.0`).
> OpenSpec skipped per the P1–P8 precedent (user-elected).

## 19. A MapLibre-parity camera API

### 19.1 Problem & Goal

`Emap`'s view surface today is only `getCenter()` / `getZoom()` /
`setExtent(Bounds)` / `reset()` / `zoomIn()` / `zoomOut()`. There is **no**
animated `flyTo`/`easeTo`, no `jumpTo`, no `fitBounds` with padding, no
`setCenter`/`setZoom`/`panTo`/`panBy`/`zoomTo`. Every consumer hand-rolls
camera moves by computing a `Bounds` and calling `setExtent`, with no
animation, no easing, no interrupt semantics, and no `movestart`/`moveend`
lifecycle. Goal: a MapLibre-parity camera API (the same vocabulary GIS/
Leaflet/MapLibre developers already know), built on the **existing**
`Tween`/`Timer` (`src/core/tween.ts`) + `Viewport` transform — collapsing
the camera-move boilerplate exactly as P1–P8 collapsed interaction
boilerplate. **2D top-down only** — no bearing/pitch (the `Viewport`
affine transform is axis-aligned; rotation is explicitly out of scope).

### 19.2 Architecture — a focused `Camera` orchestrator

New `src/geo/camera.ts` exporting `class Camera`. It owns the animation
loop and drives the existing `Viewport` transform via the existing `Tween`
(generalizing the `_zoomTween` + `initZoomTween` pattern already in
`src/geo/viewport.ts`). `Emap` holds one `Camera` and exposes thin facade
methods that delegate to it. `Camera` depends only on a minimal host
surface (the `Viewport` + an event-fire callback) so it is unit-testable
without a full `Emap`.

- **Coordinate space:** source-data coords throughout. `center: [x, y]`
  is in the same space as `getCenter()`; `zoom` is consistent with
  `getZoom()`. No new coordinate vocabulary.
- **Interpolation:** `center` lerps linearly in source coords; `zoom`
  interpolates in log/scale space (the multiplicative form the existing
  `Viewport._zoomTo` already uses — `scale = startScale * factor^t`).
  `flyTo` uses the van-Wijk (1.42 ρ default) parabolic path so a long
  jump zooms out, pans, then zooms back in.
- **Animation primitive:** reuse `Tween` — it tweens a scalar over a
  duration with an `EaseFunction` and emits `change {value, done}`. The
  `Camera` tweens normalized `t ∈ [0,1]` and maps `t →
  {center,zoom}` per frame, applying it to the viewport and firing
  events. One `Camera` owns at most one active tween (the single shared
  animation handle — see §19.5 interrupt).
- One small `Viewport` primitive may be added if needed:
  `applyCameraState(center:[number,number], zoom:number)` (set transform
  to an exact center+zoom without animating). If `Viewport` already has a
  sufficient internal setter, reuse it; do not duplicate. This is the
  only permitted `viewport.ts` change and must not alter existing
  `setExtent`/`reset`/`zoomIn`/`zoomOut` behavior.

### 19.3 API surface (on `Emap`, delegating to `Camera`)

Shared option records (exported from `src/index.ts`):

```ts
interface CameraOptions {
  /** Target center in source-data coords. */
  center?: [number, number];
  /** Target zoom (same scale as getZoom()). */
  zoom?: number;
}
interface AnimationOptions {
  /** ms. Default 1000 for ease/fly; ignored when animate:false. */
  duration?: number;
  /** t∈[0,1] → eased t. Default: ease-in-out (cubic). */
  easing?: (t: number) => number;
  /** false (or duration:0) ⇒ jump (no animation). Default true. */
  animate?: boolean;
}
interface FlyToOptions extends CameraOptions, AnimationOptions {
  /** van-Wijk zoom-path curvature. Default 1.42. */
  curve?: number;
  /** Average flight speed (screenfuls/sec). Overrides duration if set. */
  speed?: number;
}
interface FitBoundsOptions extends AnimationOptions {
  /** Pixels of inset; number = all sides. Default 0. */
  padding?: number;
  /** Clamp the fitted zoom. */
  maxZoom?: number;
}
```

Methods (all return `this` — strict MapLibre parity; chainable; await via
`await map.once('moveend')` once P10 types it):

| Method | Behavior |
|---|---|
| `jumpTo(o: CameraOptions): this` | Instant. Apply `center`/`zoom` (omitted ⇒ keep current). Fires the triplet synchronously (§19.4). |
| `setCenter(c: [number,number]): this` | `jumpTo({center:c})`. |
| `setZoom(z: number): this` | `jumpTo({zoom:z})`. |
| `easeTo(o: CameraOptions & AnimationOptions): this` | Animated lerp of center+zoom. `animate:false`/`duration:0` ⇒ delegates to `jumpTo`. |
| `panTo(center: [number,number], o?: AnimationOptions): this` | `easeTo({center}, o)` — zoom unchanged. |
| `panBy(offset: [number,number], o?: AnimationOptions): this` | Pan by a **pixel** delta (converted to a source-coord center shift via the current transform), then `easeTo`. |
| `zoomTo(zoom: number, o?: AnimationOptions): this` | `easeTo({zoom}, o)` — center unchanged. |
| `flyTo(o: FlyToOptions): this` | van-Wijk parabolic flight. `animate:false`/`duration:0` ⇒ `jumpTo`. |
| `fitBounds(b: Bounds, o?: FitBoundsOptions): this` | Compute target center/zoom from `b` + `padding` (+ `maxZoom` clamp), then `easeTo` (or `jumpTo` if not animating). Zero-area bounds → center on it clamped to `maxZoom ?? current` (no throw). |
| `stop(): this` | Cancel any running camera animation immediately; fire the in-flight animation's terminal events (§19.5). No-op if idle. |

**Kept byte-identical (additive only):** `getCenter`, `getZoom`,
`setExtent(Bounds)`, `reset()`, `zoomIn()`, `zoomOut()` — unchanged
signatures and behavior. Existing `move` listeners keep working
(`setExtent` still fires its bare `move`; camera methods additionally
fire the full lifecycle). `zoomIn/zoomOut` keep their current 200 ms
internal tween (NOT re-routed — byte-identical).

Validation: non-finite `center`/`zoom` (`NaN`/`Infinity`) → throw
`Error('camera: center/zoom must be finite')` (validation-style, the
P6 `drawFeature.enable()` philosophy). `duration < 0` → throw.

### 19.4 Camera events (P10 will type them)

New fired events: `movestart`, `move`, `moveend`, `zoomstart`, `zoom`,
`zoomend`. Contract (MapLibre-parity):

- Animated move: `movestart` once at begin → `move` every frame →
  `moveend` once at end. If the target zoom differs from the start zoom,
  the corresponding `zoomstart`/`zoom`/`zoomend` fire interleaved (a
  pure pan fires no `zoom*`; a pure zoom fires both move* and zoom*
  because the viewport center pixel can shift — match MapLibre: `zoom*`
  fire whenever zoom changes, `move*` whenever center OR zoom changes).
- `jumpTo` (and `setCenter`/`setZoom`): fires `movestart`, one `move`,
  `moveend` (plus `zoom*` triplet if zoom changed) **synchronously**
  within the call.
- Payloads are minimal & uniform: `{ center: [number,number], zoom:
  number, originalEvent: null }` (no DOM event for programmatic moves;
  the field exists for P10 union-shape consistency with pointer/feature
  events). The terminal `moveend`/`zoomend` carry the final state.
- Existing `pan`/`panstart`/`panend` from `dragPan` and
  `mousewheel*` from `scrollZoom` are **untouched** — camera events are
  a separate, additive lifecycle. (A future cleanup could unify
  drag→`move*`; explicitly out of P9 scope.)

### 19.5 Interruptibility (MapLibre parity)

- **Last-call-wins:** a new camera method while one is animating cancels
  the running tween; the cancelled animation fires its `moveend`/
  `zoomend` (at its interrupted state) before the new one's
  `movestart`. One `Camera` ⇒ one active animation handle.
- **`map.stop()`** cancels the active animation (fires its terminal
  events) and is a **no-op when idle**.
- **User-gesture cancel:** `dragPan` (on the gesture-starting `down`)
  and `scrollZoom` (on `wheel`) call `this._map.stop()` before their
  own viewport mutation. This is a **one-line additive** call in each
  of those two handlers. Because `stop()` is a no-op when no camera
  animation is running, the pan/zoom path is **byte-identical** in the
  common (no-animation) case — verified by the unchanged
  `handler-registry`/`map.test.ts` pan/zoom assertions. No other
  handler is touched; the arbiter is untouched.

### 19.6 Back-compat invariants

- New: `Emap.{jumpTo,setCenter,setZoom,easeTo,panTo,panBy,zoomTo,flyTo,
  fitBounds,stop}` + exported `CameraOptions`/`AnimationOptions`/
  `FlyToOptions`/`FitBoundsOptions` + new `src/geo/camera.ts`.
- `getCenter`/`getZoom`/`setExtent`/`reset`/`zoomIn`/`zoomOut`
  **byte-identical** (signatures + behavior + the existing `move` emit
  + the 200 ms zoomIn/Out tween).
- `Viewport` change limited to (at most) one additive
  `applyCameraState` primitive; existing `Viewport` public methods
  byte-identical.
- `dragPan`/`scrollZoom` gain exactly one `this._map.stop()` line each;
  no behavior change when idle (the regression gate asserts pan/zoom
  tests byte-identical).
- New events fire **only** from the new camera methods; default
  `new Emap()` constructs a `Camera` but starts no animation and fires
  no new event → behavior unchanged. No always-on cost (no timer runs
  until a camera method is called).
- P1–P8 handlers, delegated events, selection, edit, `map.test.ts` —
  byte-identical.

### 19.7 Testing strategy

- `Camera` unit (`src/geo/camera.test.ts`, jsdom + `vi.useFakeTimers()`):
  `jumpTo` applies exact transform instantly + fires `movestart`/`move`/
  `moveend` (+`zoom*` iff zoom changed) synchronously; `easeTo`
  interpolates center+zoom across ticks, fires one `movestart`, ≥1
  `move`, one `moveend`, and lands **exactly** on target at `t=1`;
  custom `easing` is honoured (spy a known curve); `flyTo` zoom path is
  non-monotonic (zooms out then in for a far target) yet terminates
  exactly at target; `fitBounds` computes the correct center/zoom for a
  known `Bounds`+`padding` (+`maxZoom` clamp; zero-area → clamped, no
  throw); interrupt: a 2nd call mid-flight cancels the 1st and the 1st's
  `moveend` fires before the 2nd's `movestart`; `stop()` cancels +
  fires terminal events + is a no-op when idle; `duration:0`/
  `animate:false` ⇒ jump path (no timer); non-finite center/zoom +
  negative duration throw.
- Facade delegation (`src/map/` test): each `Emap.*` camera method
  delegates to `Camera` and returns `this`; `dragPan` down / `scrollZoom`
  wheel invoke `map.stop()` (spy) exactly once and pan/zoom still work.
- Back-compat regression: `getCenter`/`getZoom`/`setExtent`/`reset`/
  `zoomIn`/`zoomOut` + `handler-registry`/`map.test.ts` pan-zoom
  byte-identical.
- Gate: `tsc --noEmit` 0, full `vitest run` green, `npm run build` 0,
  `map.test.ts` + P1–P8 byte-identical.

### 19.8 Phasing

P9, independently testable / PR-able, after P8 (done). Own implementation
plan via writing-plans; subagent-driven execution + two-stage review per
task + a holistic review. **P10** (typed `EmapEventMap`) is brainstormed
**after** P9 lands so its event map enumerates P9's `movestart`/`move`/
`moveend`/`zoomstart`/`zoom`/`zoomend`; **P11** (per-handler cursor) is
independent and last. The remaining P2c (selection controls thin-shell +
type consolidation) and P4 (CSS variables) are separate, unaffected. No
example rewrites required (the camera API is additive; an optional
playground demo may be added but is not in P9 scope).

## 20. OpenSpec note

Per `CLAUDE.md` this is a new public-surface addition normally warranting
an OpenSpec proposal. Consistent with P1–P8, the user has elected to skip
OpenSpec and proceed brainstorm-doc → writing-plans directly.
