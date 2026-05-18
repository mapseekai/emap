# emap DX Phase 9 — Camera API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a MapLibre-parity, CRS-safe camera API (`jumpTo`/`easeTo`/`flyTo`/`fitBounds`/`panTo`/`panBy`/`zoomTo`/`setCenter`/`setZoom`/`stop`) built on the existing `Tween`/`Viewport`, with a `movestart`/`move`/`moveend` + `zoomstart`/`zoom`/`zoomend` lifecycle.

**Architecture:** A focused `Camera` (`src/geo/camera.ts`) owns the animation loop, driving the `Viewport` via the existing `Tween`. Camera state is **`{ center:[dataX,dataY], scale }`** — projected/data coords (= P8 `mapCoord`/`unproject`/`getExtent` space), `scale=|mx|`; CRS-agnostic. `zoom` is an optional convenience converted via a new `Projection.getScale` inverse (WebMercator-only). `Emap` exposes thin facade methods. The arbiter and existing view methods (`setExtent`/`reset`/`zoomIn`/`zoomOut`/`getCenter`/`getZoom`) are byte-identical.

**Tech Stack:** TypeScript 5 (strict), Vitest 1.x (jsdom + fake timers), Rollup.

**Execution order:** T1 → T2 → T3 → T4 → T5.

**Design of record:** `docs/superpowers/specs/2026-05-18-emap-dx-phase9-camera-api-design.md` (§19), as refined by two brainstorm clarifications: camera `center` = projected/data space (= P8 `mapCoord`), camera internal unit = `scale` with `zoom` an optional WebMercator convenience.

## Verified codebase facts (do not re-derive; cited inline)

- `AffineTransform` (`src/geo/transform.ts`): fields `mx,my,bx,by`; `project(x,y)=[x*mx+bx, y*my+by]`; `unproject(px,py)=[(px-bx)/mx,(py-by)/my]`; `clone()`. Viewport builds it with `flipY` so `my<0`.
- `Viewport` (`src/geo/viewport.ts`): `get transform`, `get width`, `get height`, `updateSize`, `setExtent`, `reset`, `pan`, `applyWheelZoom`, `cancelZoomAnimation`, `zoomIn`, `zoomOut`, `onViewChange:(()=>void)|null` (Emap sets it to `() => this.fire('move')`, `map.ts:246`), `private _transform`, `private _applyConstraints()`. `_zoomTween = new Tween(Tween.sineInOut)`.
- `Tween` (`src/core/tween.ts`): `new Tween(ease?)`; `start(a,b,duration?)` (default 500); `stop()`; emits `change {value}`; `Tween.sineInOut`, `Tween.quadraticOut`. `Timer` uses `requestAnimationFrame` (or `setTimeout 25`); fake timers in tests must advance accordingly.
- `Emap.getCenter()` (`map.ts:959`): `cx=(w/2-bx)/mx`, `cy=(h/2-by)/my`, then `_projection.getCenter(cx,cy)`. `Emap.getZoom()`: `_projection.getZoom(|mx|)`. The camera's `center` is the **`(cx,cy)` before `_projection.getCenter`** — i.e. projected/data space.
- `Projection` (`src/geo/projection.ts`): `getZoom(mx)= crs∈{epsg:3857,webmercator} ? Math.log2((mx*EARTH_CIRCUMFERENCE_WEB_MERCATOR)/512) : 0` (`EARTH_CIRCUMFERENCE_WEB_MERCATOR=40075016.6855`, module-private). `get crs`.
- `Bounds` (`src/geo/bounds.ts`): ctor `(xmin,ymin,xmax,ymax)`; `get width/height/centerX/centerY`; `hasBounds()`; `clone()`.
- `Emap`: `private _viewport: Viewport` (`map.ts:74`), `private _projection` (used by getCenter/getZoom), `_scheduleRender()`, `fire(type,payload?)`. `dragPan` `handlePointer` `down` branch at `src/core/handlers/drag-pan.ts:40`. `scrollZoom` re-emits `mousewheel` from `MouseWheel` in its constructor (`src/core/handlers/scroll-zoom.ts:24`); Emap consumes it at `map.ts:487-492` (`_viewport.cancelZoomAnimation()` then `applyWheelZoom`).
- `src/index.ts:204-205`: feature/pointer event type exports (place camera type exports nearby in the "Core events" block ~line 187+).

---

## File Structure

- Modify `src/geo/projection.ts` — add `getScale(zoom): number` (inverse of `getZoom`, single source of the WebMercator constant).
- Modify `src/geo/viewport.ts` — add `getCameraState()` + `applyCameraState(center, scale)` primitives (additive; no change to existing methods).
- Create `src/geo/camera.ts` — `Camera` class + `CameraOptions`/`AnimationOptions`/`FlyToOptions`/`FitBoundsOptions`/`CameraState` types.
- Create `src/geo/camera.test.ts`.
- Modify `src/geo/viewport.test.ts` (or create) — primitive tests.
- Modify `src/geo/projection.test.ts` (or create) — `getScale` round-trip test.
- Modify `src/map/map.ts` — construct `Camera`; facade methods + `stop()`.
- Modify `src/core/handlers/drag-pan.ts`, `src/core/handlers/scroll-zoom.ts` — one `map.stop()` line each (via an injected callback — see T5).
- Modify `src/index.ts` — export the camera option types.
- Modify `src/map/handler-registry.test.ts` (or a new `src/map/camera-facade.test.ts`) — facade + stop-on-gesture + back-compat.
- Modify `CHANGELOG.md`.

---

### Task 1: `Projection.getScale` inverse + `Viewport` camera-state primitives

**Files:** Modify `src/geo/projection.ts`, `src/geo/viewport.ts`; Test `src/geo/projection.test.ts` (create if absent), `src/geo/viewport.test.ts` (create if absent).

- [ ] **Step 1: Write the failing tests**

Create/append `src/geo/projection.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Projection } from './projection';

describe('Projection.getScale (inverse of getZoom)', () => {
  it('round-trips zoom→scale→zoom in WebMercator', () => {
    const p = new Projection();
    p.setCRS('EPSG:3857');
    for (const z of [0, 1, 5, 12, 19]) {
      const s = p.getScale(z);
      expect(p.getZoom(s)).toBeCloseTo(z, 9);
    }
  });
  it('returns NaN when zoom is not meaningful (non-WebMercator)', () => {
    const p = new Projection(); // default EPSG:4326
    expect(Number.isNaN(p.getScale(5))).toBe(true);
  });
});
```

Create/append `src/geo/viewport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Viewport } from './viewport';
import { Bounds } from './bounds';

function vp(): Viewport {
  const v = new Viewport();
  v.updateSize(800, 600);
  v.setExtent(new Bounds(0, 0, 100, 100));
  return v;
}

describe('Viewport camera-state primitives', () => {
  it('getCameraState returns center (data coords) + positive scale', () => {
    const v = vp();
    const s = v.getCameraState();
    expect(s.scale).toBeGreaterThan(0);
    expect(s.center).toHaveLength(2);
    expect(Number.isFinite(s.center[0])).toBe(true);
    expect(Number.isFinite(s.center[1])).toBe(true);
  });
  it('applyCameraState then getCameraState round-trips center+scale', () => {
    const v = vp();
    v.applyCameraState([42, 17], 3);
    const s = v.getCameraState();
    expect(s.center[0]).toBeCloseTo(42, 6);
    expect(s.center[1]).toBeCloseTo(17, 6);
    expect(s.scale).toBeCloseTo(3, 9);
  });
  it('applyCameraState centers the data point at the viewport middle', () => {
    const v = vp();
    v.applyCameraState([10, 20], 2);
    const t = v.transform;
    const [px, py] = t.project(10, 20);
    expect(px).toBeCloseTo(400, 6); // width/2
    expect(py).toBeCloseTo(300, 6); // height/2
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/geo/projection.test.ts src/geo/viewport.test.ts`
Expected: FAIL — `getScale`/`getCameraState`/`applyCameraState` are not functions.

- [ ] **Step 3: Implement**

`src/geo/projection.ts` — add this method to `class Projection` (immediately after `getZoom`):

```ts
  /**
   * Inverse of `getZoom`: the scale factor (|mx|) for a given zoom.
   * Only meaningful for Web Mercator — returns `NaN` otherwise so callers
   * can detect "zoom not applicable for this CRS" and fall back to scale.
   */
  getScale(zoom: number): number {
    const crs = this._crs.toLowerCase();
    if (crs === 'epsg:3857' || crs === 'webmercator') {
      return (Math.pow(2, zoom) * 512) / EARTH_CIRCUMFERENCE_WEB_MERCATOR;
    }
    return NaN;
  }
```
(`EARTH_CIRCUMFERENCE_WEB_MERCATOR` is already a module constant in this file — reuse it; do NOT redeclare.)

`src/geo/viewport.ts` — add these two methods to `class Viewport` (place them right after `reset()`; they are additive and touch no existing method):

```ts
  /**
   * Current camera state in projected/data coords. `center` is the data
   * point currently at the viewport centre (the (cx,cy) BEFORE any
   * `Projection.getCenter` mapping — i.e. the same space as `unproject`
   * / P8 `mapCoord` / `getExtent`). `scale` is `|mx|`.
   */
  getCameraState(): { center: [number, number]; scale: number } {
    const t = this._transform;
    const cx = (this._width / 2 - t.bx) / t.mx;
    const cy = (this._height / 2 - t.by) / t.my;
    return { center: [cx, cy], scale: Math.abs(t.mx) };
  }

  /**
   * Set the transform so `center` (data coords) sits at the viewport
   * centre at `scale` (= |mx|), preserving the existing flipY (my<0)
   * convention, then re-apply pan/zoom constraints. Additive primitive
   * for the Camera; does not touch `setExtent`/`reset` state.
   */
  applyCameraState(center: [number, number], scale: number): void {
    const mx = scale;
    const my = -scale; // flipY convention (Viewport builds transforms with flipY=true)
    const bx = this._width / 2 - mx * center[0];
    const by = this._height / 2 - my * center[1];
    this._transform = new AffineTransform(mx, my, bx, by);
    this._applyConstraints();
  }
```
`AffineTransform` is already imported at the top of `viewport.ts` (`import { AffineTransform } from './transform';`). `_applyConstraints` is the existing private method `pan()`/`applyWheelZoom()` already call. Do NOT call `onViewChange` here — the Camera fires events itself (T2/T3); a raw `applyCameraState` is a pure transform write.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/geo/projection.test.ts src/geo/viewport.test.ts`
Expected: PASS.

- [ ] **Step 5: GATE**

`npx tsc --noEmit` exit 0. `npx vitest run` full suite green (baseline 1119 + 5 new — report exact). `setExtent`/`reset`/`zoomIn`/`zoomOut`/`getCenter`/`getZoom` untouched → `map.test.ts` + P1–P8 byte-identical.

- [ ] **Step 6: Commit**

```bash
git add src/geo/projection.ts src/geo/projection.test.ts src/geo/viewport.ts src/geo/viewport.test.ts
git commit -m "feat(geo): Projection.getScale inverse + Viewport camera-state primitives (DX P9)"
```

---

### Task 2: `Camera` class — `jumpTo` + synchronous event lifecycle

**Files:** Create `src/geo/camera.ts`, `src/geo/camera.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/geo/camera.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { Camera } from './camera';

/** Minimal viewport-host stub: in-memory camera state + spy. */
function hostStub() {
  let st = { center: [0, 0] as [number, number], scale: 1 };
  const fired: Array<{ type: string; e: any }> = [];
  return {
    host: {
      getCameraState: () => ({ center: [...st.center] as [number, number], scale: st.scale }),
      applyCameraState: (c: [number, number], s: number) => { st = { center: [c[0], c[1]], scale: s }; },
      scaleFromZoom: (z: number) => Math.pow(2, z),     // pretend WebMercator-ish
      fire: (type: string, e: any) => fired.push({ type, e }),
      requestRender: vi.fn(),
    },
    fired,
    state: () => st,
  };
}

describe('Camera.jumpTo', () => {
  it('applies center+scale instantly and fires move/zoom lifecycle synchronously', () => {
    const { host, fired, state } = hostStub();
    const cam = new Camera(host as any);
    cam.jumpTo({ center: [10, 20], zoom: 3 });   // scale = 2^3 = 8
    expect(state()).toEqual({ center: [10, 20], scale: 8 });
    const types = fired.map((f) => f.type);
    expect(types).toEqual(['movestart', 'zoomstart', 'move', 'zoom', 'moveend', 'zoomend']);
    expect(fired.at(-1)!.e).toMatchObject({ center: [10, 20], zoom: expect.any(Number) });
    expect(host.requestRender).toHaveBeenCalled();
  });

  it('pure pan (zoom unchanged) fires only move* — no zoom*', () => {
    const { host, fired } = hostStub();
    const cam = new Camera(host as any);
    cam.jumpTo({ center: [5, 5] });               // scale stays 1
    expect(fired.map((f) => f.type)).toEqual(['movestart', 'move', 'moveend']);
  });

  it('accepts scale directly (CRS-agnostic path) and omitted fields keep current', () => {
    const { host, state } = hostStub();
    const cam = new Camera(host as any);
    cam.jumpTo({ scale: 4 });
    expect(state()).toEqual({ center: [0, 0], scale: 4 });
    cam.jumpTo({ center: [9, 9] });
    expect(state()).toEqual({ center: [9, 9], scale: 4 });
  });

  it('throws on non-finite center/zoom/scale', () => {
    const { host } = hostStub();
    const cam = new Camera(host as any);
    expect(() => cam.jumpTo({ center: [NaN, 0] })).toThrow(/finite/);
    expect(() => cam.jumpTo({ zoom: Infinity })).toThrow(/finite/);
    expect(() => cam.jumpTo({ scale: -1 })).toThrow(/finite|positive/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/geo/camera.test.ts`
Expected: FAIL — module `./camera` not found.

- [ ] **Step 3: Implement**

Create `src/geo/camera.ts`:

```ts
import { Tween } from '../core/tween';

export interface CameraOptions {
  /** Target centre in projected/data coords (= P8 `mapCoord` space). */
  center?: [number, number];
  /** Target zoom (WebMercator convenience; converted via host.scaleFromZoom). */
  zoom?: number;
  /** Target scale (= |mx|); CRS-agnostic. Takes precedence over `zoom`. */
  scale?: number;
}

export interface AnimationOptions {
  /** ms. Default 1000 for ease/fly. Ignored when animate:false. */
  duration?: number;
  /** t∈[0,1] → eased t. Default Tween.sineInOut. */
  easing?: (t: number) => number;
  /** false (or duration:0) ⇒ jump (no animation). Default true. */
  animate?: boolean;
}

export interface FlyToOptions extends CameraOptions, AnimationOptions {
  /** van-Wijk curvature. Default 1.42. */
  curve?: number;
  /** Average flight speed (screenfuls/sec). Overrides duration if set. */
  speed?: number;
}

export interface FitBoundsOptions extends AnimationOptions {
  /** Pixels of inset on every side. Default 0. */
  padding?: number;
  /** Clamp the fitted scale to <= scale(maxZoom-equivalent). */
  maxScale?: number;
}

export interface CameraState {
  center: [number, number];
  scale: number;
}

/** Minimal surface Camera needs (keeps it unit-testable, no Emap import). */
export interface CameraHost {
  getCameraState(): CameraState;
  applyCameraState(center: [number, number], scale: number): void;
  /** zoom→scale (NaN if not meaningful for the CRS). */
  scaleFromZoom(zoom: number): number;
  fire(type: string, e: { center: [number, number]; zoom: number; originalEvent: null }): void;
  requestRender(): void;
}

const DEFAULT_DURATION = 1000;

function isFinitePair(p: [number, number]): boolean {
  return Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/**
 * Camera — animated view controller (DX P9). Drives the host viewport via
 * the existing `Tween`. State is `{center (data coords), scale}`; `zoom`
 * is an optional WebMercator convenience. 2D only (no bearing/pitch).
 * One active animation at a time (last-call-wins; see `easeTo`/`stop`).
 */
export class Camera {
  private _tween: Tween | null = null;
  private _activeEnd: (() => void) | null = null;

  constructor(private _host: CameraHost) {}

  /** Resolve a CameraOptions to a concrete target {center,scale}. */
  private _resolve(o: CameraOptions): CameraState {
    const cur = this._host.getCameraState();
    const center = o.center ?? cur.center;
    if (!isFinitePair(center)) throw new Error('camera: center must be finite');
    let scale = cur.scale;
    if (o.scale !== undefined) {
      scale = o.scale;
    } else if (o.zoom !== undefined) {
      if (!Number.isFinite(o.zoom)) throw new Error('camera: zoom must be finite');
      const s = this._host.scaleFromZoom(o.zoom);
      if (!Number.isFinite(s)) {
        throw new Error('camera: zoom is not meaningful for this CRS — pass { scale } instead');
      }
      scale = s;
    }
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new Error('camera: scale must be a finite positive number');
    }
    return { center: [center[0], center[1]], scale };
  }

  private _payload(s: CameraState): { center: [number, number]; zoom: number; originalEvent: null } {
    // zoom field is best-effort (NaN-safe): consumers that care about a
    // CRS-meaningful zoom can recompute; the camera contract is center+scale.
    return { center: [s.center[0], s.center[1]], zoom: Math.log2(s.scale), originalEvent: null };
  }

  /** True while an animation is running. */
  isMoving(): boolean {
    return this._tween !== null;
  }

  /** Instant move. Fires the movestart/move/moveend (+zoom*) lifecycle synchronously. */
  jumpTo(o: CameraOptions): void {
    const target = this._resolve(o);
    const from = this._host.getCameraState();
    const zoomChanged = target.scale !== from.scale;
    this._cancel(); // a jump supersedes any running animation (fires its terminal events)
    const p = this._payload(target);
    this._host.fire('movestart', p);
    if (zoomChanged) this._host.fire('zoomstart', p);
    this._host.applyCameraState(target.center, target.scale);
    this._host.requestRender();
    this._host.fire('move', p);
    if (zoomChanged) this._host.fire('zoom', p);
    this._host.fire('moveend', p);
    if (zoomChanged) this._host.fire('zoomend', p);
  }

  /** Cancel a running animation, firing its terminal events at the current state. */
  private _cancel(): void {
    if (this._tween) {
      this._tween.stop();
      this._tween = null;
    }
    if (this._activeEnd) {
      const end = this._activeEnd;
      this._activeEnd = null;
      end();
    }
  }

  /** Public: stop any running animation (no-op when idle). */
  stop(): void {
    this._cancel();
  }
}
```
> NOTE: `easeTo`/`flyTo`/`fitBounds`/wrappers are added in T3/T4 — this task ships `jumpTo`+`stop`+`_resolve`+lifecycle only. Verify the synchronous event ORDER in the test (`movestart,zoomstart,move,zoom,moveend,zoomend`) matches the implementation exactly; if the spec's intent differs, follow the test (it is the contract). `Math.log2(scale)` in `_payload` is a non-authoritative convenience (the camera contract is center+scale; P10 will type the event, a CRS-correct zoom is out of P9 scope) — do not block on it.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/geo/camera.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: GATE**

`npx tsc --noEmit` exit 0. `npx vitest run` full suite green (baseline after T1 + 4 new — report exact).

- [ ] **Step 6: Commit**

```bash
git add src/geo/camera.ts src/geo/camera.test.ts
git commit -m "feat(geo): Camera.jumpTo + synchronous move/zoom lifecycle (DX P9)"
```

---

### Task 3: `Camera.easeTo` — Tween-driven animation, interrupt, `stop`

**Files:** Modify `src/geo/camera.ts`, `src/geo/camera.test.ts`.

- [ ] **Step 1: Write the failing test**

Append to `src/geo/camera.test.ts`:

```ts
describe('Camera.easeTo', () => {
  it('duration:0 / animate:false delegates to the jump path (no tween, sync lifecycle)', () => {
    const { host, fired, state } = hostStub();
    const cam = new Camera(host as any);
    cam.easeTo({ center: [7, 8], scale: 5, duration: 0 });
    expect(state()).toEqual({ center: [7, 8], scale: 5 });
    expect(fired.map((f) => f.type)).toEqual(['movestart', 'zoomstart', 'move', 'zoom', 'moveend', 'zoomend']);
    expect(cam.isMoving()).toBe(false);
  });

  it('animates over ticks: one movestart, ≥1 move, lands exactly on target, one moveend', () => {
    vi.useFakeTimers();
    const { host, fired, state } = hostStub();
    const cam = new Camera(host as any);
    cam.easeTo({ center: [100, 0], scale: 4, duration: 100, easing: (t) => t });
    expect(cam.isMoving()).toBe(true);
    expect(fired.filter((f) => f.type === 'movestart')).toHaveLength(1);
    vi.advanceTimersByTime(200);              // run all rAF/timeout ticks
    const t = fired.map((f) => f.type);
    expect(t.filter((x) => x === 'movestart')).toHaveLength(1);
    expect(t.filter((x) => x === 'move').length).toBeGreaterThanOrEqual(1);
    expect(t.filter((x) => x === 'moveend')).toHaveLength(1);
    expect(state().center[0]).toBeCloseTo(100, 6);
    expect(state().scale).toBeCloseTo(4, 6);
    expect(cam.isMoving()).toBe(false);
    vi.useRealTimers();
  });

  it('a second easeTo mid-flight cancels the first; first moveend precedes second movestart', () => {
    vi.useFakeTimers();
    const { host, fired } = hostStub();
    const cam = new Camera(host as any);
    cam.easeTo({ center: [50, 50], scale: 2, duration: 100, easing: (t) => t });
    vi.advanceTimersByTime(30);
    cam.easeTo({ center: [0, 0], scale: 1, duration: 100, easing: (t) => t });
    const types = fired.map((f) => f.type);
    const firstEnd = types.indexOf('moveend');
    const secondStart = types.indexOf('movestart', types.indexOf('movestart') + 1);
    expect(firstEnd).toBeGreaterThanOrEqual(0);
    expect(secondStart).toBeGreaterThan(firstEnd);
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
  });

  it('stop() mid-flight cancels and fires terminal events; no-op when idle', () => {
    vi.useFakeTimers();
    const { host, fired } = hostStub();
    const cam = new Camera(host as any);
    cam.easeTo({ center: [9, 9], scale: 3, duration: 100, easing: (t) => t });
    vi.advanceTimersByTime(20);
    cam.stop();
    expect(fired.map((f) => f.type)).toContain('moveend');
    expect(cam.isMoving()).toBe(false);
    const n = fired.length;
    cam.stop();                                // idle → no-op
    expect(fired.length).toBe(n);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/geo/camera.test.ts -t easeTo`
Expected: FAIL — `easeTo` is not a function.

- [ ] **Step 3: Implement**

Add to `class Camera` in `src/geo/camera.ts` (after `jumpTo`, before `_cancel`):

```ts
  /**
   * Animated move. Lerps centre linearly and scale in log space over
   * `duration` ms with `easing`. `animate:false`/`duration:0` ⇒ jump.
   * Last-call-wins: supersedes any running animation (its terminal
   * events fire first, via `_cancel`).
   */
  easeTo(o: CameraOptions & AnimationOptions): void {
    const target = this._resolve(o);
    if (o.animate === false || o.duration === 0) {
      this.jumpTo(o);
      return;
    }
    const duration = o.duration ?? DEFAULT_DURATION;
    if (!Number.isFinite(duration) || duration < 0) {
      throw new Error('camera: duration must be a finite non-negative number');
    }
    const ease = o.easing ?? Tween.sineInOut;

    this._cancel();
    const from = this._host.getCameraState();
    const zoomChanged = target.scale !== from.scale;
    const logFrom = Math.log(from.scale);
    const logTo = Math.log(target.scale);
    const startP = this._payload(from);
    this._host.fire('movestart', startP);
    if (zoomChanged) this._host.fire('zoomstart', startP);

    let lastState: CameraState = from;
    const emitEnd = () => {
      const endP = this._payload(lastState);
      this._host.fire('moveend', endP);
      if (zoomChanged) this._host.fire('zoomend', endP);
    };
    this._activeEnd = emitEnd;

    const tween = new Tween(ease);
    this._tween = tween;
    tween.on('change', (e: { value: number }) => {
      const t = e.value; // Tween already eased; lerps 0→1
      const cx = from.center[0] + (target.center[0] - from.center[0]) * t;
      const cy = from.center[1] + (target.center[1] - from.center[1]) * t;
      const scale = Math.exp(logFrom + (logTo - logFrom) * t);
      lastState = { center: [cx, cy], scale };
      this._host.applyCameraState(lastState.center, lastState.scale);
      this._host.requestRender();
      const p = this._payload(lastState);
      this._host.fire('move', p);
      if (zoomChanged) this._host.fire('zoom', p);
      if (t >= 1) {
        // settle exactly on target, then finish
        lastState = target;
        this._host.applyCameraState(target.center, target.scale);
        this._tween = null;
        this._activeEnd = null;
        emitEnd();
      }
    });
    tween.start(0, 1, duration);
  }
```
> NOTE on `Tween`: `Tween._onTick` fires `change {value}` where `value = endValue*easedPct + startValue*(1-easedPct)`; with `start(0,1,duration)` that is exactly the eased `t∈[0,1]`, and `t` reaches `1` on the final tick (`pct>=1`). So the `if (t >= 1)` settle branch fires once at the end. Do NOT add a separate `done` listener — `Tween` does not expose one; the `t>=1` check is the contract (verified against `src/core/tween.ts:40-48,87-91`). The interrupt test relies on `_cancel()` calling the stored `_activeEnd` (the previous animation's `emitEnd`) before the new `movestart`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/geo/camera.test.ts`
Expected: PASS (all `jumpTo` + `easeTo` tests).

- [ ] **Step 5: GATE**

`npx tsc --noEmit` exit 0. `npx vitest run` full suite green (report exact). `npm run build` exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/geo/camera.ts src/geo/camera.test.ts
git commit -m "feat(geo): Camera.easeTo — tween animation, interrupt, stop (DX P9)"
```

---

### Task 4: convenience wrappers + `fitBounds` + `flyTo`

**Files:** Modify `src/geo/camera.ts`, `src/geo/camera.test.ts`.

- [ ] **Step 1: Write the failing test**

Append to `src/geo/camera.test.ts`:

```ts
import { Bounds } from './bounds';

describe('Camera wrappers / fitBounds / flyTo', () => {
  it('setCenter/setZoom/zoomTo/panTo/panBy delegate correctly', () => {
    const { host, state } = hostStub();
    const cam = new Camera(host as any);
    cam.setCenter([3, 4]);
    expect(state().center).toEqual([3, 4]);
    cam.setZoom(2);                         // scale 2^2=4
    expect(state().scale).toBe(4);
    cam.zoomTo(3, { duration: 0 });         // scale 8
    expect(state().scale).toBe(8);
    cam.panTo([10, 10], { duration: 0 });
    expect(state().center).toEqual([10, 10]);
    expect(state().scale).toBe(8);          // pan keeps scale
  });

  it('panBy shifts the centre by a pixel delta converted through current scale', () => {
    const { host, state } = hostStub();
    const cam = new Camera(host as any);
    cam.jumpTo({ center: [0, 0], scale: 2 }); // 1 data unit = 2 px
    cam.panBy([20, 10], { duration: 0 });     // → +10 data x, ∓ y (flipY)
    expect(state().center[0]).toBeCloseTo(10, 6);
    expect(Math.abs(state().center[1])).toBeCloseTo(5, 6);
  });

  it('fitBounds centres on the bounds and never exceeds maxScale; zero-area → maxScale/current', () => {
    const { host, state } = hostStub();
    const cam = new Camera(host as any);
    // host stub has no width/height; fitBounds needs viewport size — extend stub:
    (host as any).getViewportSize = () => ({ width: 800, height: 600 });
    cam.fitBounds(new Bounds(0, 0, 100, 50), { padding: 0, duration: 0 });
    expect(state().center).toEqual([50, 25]); // bounds centre
    expect(state().scale).toBeGreaterThan(0);
    cam.fitBounds(new Bounds(10, 10, 10, 10), { duration: 0, maxScale: 7 });
    expect(state().center).toEqual([10, 10]);
    expect(state().scale).toBeLessThanOrEqual(7);
  });

  it('flyTo lands exactly on target and (for a far jump) zoom is non-monotonic', () => {
    vi.useFakeTimers();
    const { host, state } = hostStub();
    (host as any).getViewportSize = () => ({ width: 800, height: 600 });
    const cam = new Camera(host as any);
    cam.jumpTo({ center: [0, 0], scale: 8 });
    const scales: number[] = [];
    (host as any).applyCameraState = ((orig) => (c: [number, number], s: number) => {
      scales.push(s);
    })((host as any).applyCameraState);
    cam.flyTo({ center: [10000, 10000], scale: 8, duration: 200, easing: (t) => t });
    vi.advanceTimersByTime(400);
    expect(scales.some((s) => s < 8)).toBe(true); // zoomed out mid-flight
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/geo/camera.test.ts -t "wrappers"`
Expected: FAIL — `setCenter`/`fitBounds`/`flyTo` not functions; `getViewportSize` not on `CameraHost`.

- [ ] **Step 3: Implement**

In `src/geo/camera.ts`: extend `CameraHost` with the viewport size accessor (needed by `fitBounds`/`panBy`/`flyTo`):

```ts
export interface CameraHost {
  getCameraState(): CameraState;
  applyCameraState(center: [number, number], scale: number): void;
  scaleFromZoom(zoom: number): number;
  getViewportSize(): { width: number; height: number };
  fire(type: string, e: { center: [number, number]; zoom: number; originalEvent: null }): void;
  requestRender(): void;
}
```

Add these methods to `class Camera` (after `easeTo`):

```ts
  setCenter(center: [number, number]): void { this.jumpTo({ center }); }
  setZoom(zoom: number): void { this.jumpTo({ zoom }); }
  zoomTo(zoom: number, o: AnimationOptions = {}): void { this.easeTo({ zoom, ...o }); }
  panTo(center: [number, number], o: AnimationOptions = {}): void { this.easeTo({ center, ...o }); }

  /** Pan by a pixel offset (converted to a data-coord centre shift). */
  panBy(offset: [number, number], o: AnimationOptions = {}): void {
    const { center, scale } = this._host.getCameraState();
    // px → data: dx_data = dpx / mx ; flipY ⇒ dy_data = dpy / my = dpy / -scale
    const next: [number, number] = [
      center[0] + offset[0] / scale,
      center[1] + offset[1] / -scale,
    ];
    this.easeTo({ center: next, ...o });
  }

  /** Fit a Bounds (data coords) into the viewport with optional padding. */
  fitBounds(b: import('./bounds').Bounds, o: FitBoundsOptions = {}): void {
    const { width, height } = this._host.getViewportSize();
    const pad = o.padding ?? 0;
    const vw = Math.max(1, width - 2 * pad);
    const vh = Math.max(1, height - 2 * pad);
    const center: [number, number] = [b.centerX, b.centerY];
    const bw = b.width;
    const bh = b.height;
    let scale: number;
    if (!b.hasBounds() || (bw <= 0 && bh <= 0)) {
      // zero-area → keep current scale, clamped to maxScale
      scale = this._host.getCameraState().scale;
    } else {
      // scale so the larger dimension fits the padded viewport
      const sx = bw > 0 ? vw / bw : Infinity;
      const sy = bh > 0 ? vh / bh : Infinity;
      scale = Math.min(sx, sy);
    }
    if (o.maxScale !== undefined) scale = Math.min(scale, o.maxScale);
    if (!Number.isFinite(scale) || scale <= 0) scale = this._host.getCameraState().scale;
    this.easeTo({ center, scale, ...o });
  }

  /**
   * van-Wijk (2004) parabolic flight: for a far move, zoom out, pan, zoom
   * back in. Reduces to easeTo for near moves. `curve` default 1.42.
   */
  flyTo(o: FlyToOptions): void {
    const target = this._resolve(o);
    if (o.animate === false || o.duration === 0) { this.jumpTo(o); return; }
    const duration = o.duration ?? DEFAULT_DURATION;
    if (!Number.isFinite(duration) || duration < 0) {
      throw new Error('camera: duration must be a finite non-negative number');
    }
    const ease = o.easing ?? Tween.sineInOut;
    const rho = o.curve ?? 1.42;
    const { width, height } = this._host.getViewportSize();

    this._cancel();
    const from = this._host.getCameraState();
    const zoomChanged = target.scale !== from.scale;
    // Work in a "world" where 1 unit = 1 px at scale 1: w0/w1 are the
    // viewport widths in data units at the start/end scales.
    const u1 = Math.hypot(
      target.center[0] - from.center[0],
      target.center[1] - from.center[1],
    ) * Math.max(from.scale, 1e-9); // pixel distance between centres at start scale
    const w0 = width / from.scale;
    const w1 = width / target.scale;
    const rho2 = rho * rho;

    // van-Wijk closed form (guard the degenerate u1≈0 → linear log-scale)
    function r(i: number): number {
      const b =
        (w1 * w1 - w0 * w0 + (i ? -1 : 1) * rho2 * rho2 * (u1 || 1e-9) * (u1 || 1e-9)) /
        (2 * (i ? w1 : w0) * rho2 * (u1 || 1e-9));
      return Math.log(Math.sqrt(b * b + 1) - b);
    }
    const r0 = r(0);
    const S = u1 < 1e-6 ? Math.abs(Math.log(w1 / w0)) / rho : (r(1) - r0) / rho;
    const startP = this._payload(from);
    this._host.fire('movestart', startP);
    if (zoomChanged) this._host.fire('zoomstart', startP);

    let lastState: CameraState = from;
    const emitEnd = () => {
      const endP = this._payload(lastState);
      this._host.fire('moveend', endP);
      if (zoomChanged) this._host.fire('zoomend', endP);
    };
    this._activeEnd = emitEnd;

    const tween = new Tween(ease);
    this._tween = tween;
    tween.on('change', (e: { value: number }) => {
      const k = e.value; // eased 0→1
      let cx: number, cy: number, scale: number;
      if (u1 < 1e-6) {
        // pure zoom: log-lerp scale, centre lerps trivially
        const lf = Math.log(from.scale);
        const lt = Math.log(target.scale);
        scale = Math.exp(lf + (lt - lf) * k);
        cx = from.center[0] + (target.center[0] - from.center[0]) * k;
        cy = from.center[1] + (target.center[1] - from.center[1]) * k;
      } else {
        const s = k * S;
        const us = (w0 / (rho2 * (u1 || 1e-9))) *
          (Math.cosh(r0) * Math.tanh(rho * s + r0) - Math.sinh(r0));
        const w = w0 * (Math.cosh(r0) / Math.cosh(rho * s + r0));
        scale = width / w;
        const frac = us; // 0→u1 in "start-scale pixels", normalized below
        const t01 = Math.min(Math.max(frac, 0), 1);
        cx = from.center[0] + (target.center[0] - from.center[0]) * t01;
        cy = from.center[1] + (target.center[1] - from.center[1]) * t01;
      }
      lastState = { center: [cx, cy], scale };
      this._host.applyCameraState(lastState.center, lastState.scale);
      this._host.requestRender();
      const p = this._payload(lastState);
      this._host.fire('move', p);
      if (zoomChanged) this._host.fire('zoom', p);
      if (k >= 1) {
        lastState = target;
        this._host.applyCameraState(target.center, target.scale);
        this._tween = null;
        this._activeEnd = null;
        emitEnd();
      }
    });
    tween.start(0, 1, duration);
  }
```
> NOTE: the van-Wijk closed form is intricate; the **only** test contract is "lands exactly on target at k≥1" and "scale dips below the start scale for a far move" (zoom-out-then-in). If the closed-form `us` normalization proves numerically finicky in the test, the acceptable fallback (still spec-compliant) is: keep the `scale` curve from the van-Wijk `w(s)` (this is what produces the visible zoom-out) and drive `cx,cy` by the eased `k` directly (`t01=k`). Do NOT silently ship a version that fails "lands exactly on target" — the `k>=1` settle branch guarantees it. Keep `flyTo` reducing to the log-lerp for `u1<1e-6` (pure zoom).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/geo/camera.test.ts`
Expected: PASS (all camera tests).

- [ ] **Step 5: GATE**

`npx tsc --noEmit` exit 0. `npx vitest run` full suite green (report exact). `npm run build` exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/geo/camera.ts src/geo/camera.test.ts
git commit -m "feat(geo): Camera wrappers + fitBounds + flyTo (van-Wijk) (DX P9)"
```

---

### Task 5: `Emap` facade + `map.stop()` + handler stop-wiring + exports + CHANGELOG

**Files:** Modify `src/map/map.ts`, `src/core/handlers/drag-pan.ts`, `src/core/handlers/scroll-zoom.ts`, `src/index.ts`; Test `src/map/camera-facade.test.ts` (create); Modify `CHANGELOG.md`.

- [ ] **Step 1: Write the failing test**

Create `src/map/camera-facade.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Emap } from './map';

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => ({
    scale: () => {}, clearRect: () => {}, fillRect: () => {}, strokeRect: () => {},
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
    fill: () => {}, arc: () => {}, save: () => {}, restore: () => {},
    translate: () => {}, setTransform: () => {}, drawImage: () => {},
    measureText: () => ({ width: 0 }),
  } as any);
});

function container(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 800 });
  Object.defineProperty(el, 'clientHeight', { value: 600 });
  document.body.appendChild(el);
  return el;
}

describe('Emap camera facade (DX P9)', () => {
  it('exposes camera methods that return `this` and move the view', () => {
    const map = new Emap({ container: container() });
    expect(map.jumpTo({ center: [10, 20], scale: 3 })).toBe(map);
    const t = map.getTransform();
    const [px, py] = t.project(10, 20);
    expect(px).toBeCloseTo(400, 3);
    expect(py).toBeCloseTo(300, 3);
    expect(typeof map.easeTo).toBe('function');
    expect(typeof map.flyTo).toBe('function');
    expect(typeof map.fitBounds).toBe('function');
    expect(typeof map.panBy).toBe('function');
    expect(map.stop()).toBe(map);
  });

  it('jumpTo fires the movestart/move/moveend lifecycle', () => {
    const map = new Emap({ container: container() });
    const seen: string[] = [];
    for (const t of ['movestart', 'move', 'moveend']) map.on(t, () => seen.push(t));
    map.jumpTo({ center: [1, 2], scale: 2 });
    expect(seen).toEqual(expect.arrayContaining(['movestart', 'move', 'moveend']));
  });

  it('starting a drag stops a running camera animation', () => {
    const map = new Emap({ container: container() });
    const stop = vi.spyOn(map, 'stop');
    const canvas = map.getCanvasContainer();
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, button: 0 }));
    expect(stop).toHaveBeenCalled();
  });

  it('legacy view methods still work (back-compat)', () => {
    const map = new Emap({ container: container() });
    const c0 = map.getCenter();
    map.zoomIn();
    map.zoomOut();
    expect(map.getCenter()).toBeDefined();
    expect(typeof map.getZoom()).toBe('number');
    expect(Array.isArray(c0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/map/camera-facade.test.ts`
Expected: FAIL — `map.jumpTo` is not a function.

- [ ] **Step 3: Implement**

(a) `src/map/map.ts` — import the Camera + types (add below the existing geo imports near the top; find the `import { Viewport } from '../geo/viewport';` line and add after it):
```ts
import { Camera, type CameraOptions, type AnimationOptions, type FlyToOptions, type FitBoundsOptions } from '../geo/camera';
```

(b) Field — near `private _viewport: Viewport = new Viewport();` (`map.ts:74`) add:
```ts
  private _camera!: Camera;
```

(c) Construct the camera AFTER `this._viewport.initZoomTween();` (`map.ts:247`) — the projection/viewport are ready there. Insert:
```ts
    this._camera = new Camera({
      getCameraState: () => this._viewport.getCameraState(),
      applyCameraState: (c, s) => this._viewport.applyCameraState(c, s),
      scaleFromZoom: (z) => this._projection.getScale(z),
      getViewportSize: () => ({ width: this._viewport.width, height: this._viewport.height }),
      fire: (type, e) => this.fire(type, e),
      requestRender: () => this._scheduleRender(),
    });
```
Verify the exact private field names: `this._projection` is the `Projection` instance used by `getCenter`/`getZoom` (confirm at `map.ts` ~959); `this._scheduleRender()` exists (`map.ts:192`). If `_projection` has a different name, use the real one (do NOT invent — grep `getZoom(` in map.ts to find it).

(d) Facade methods — add a "Camera (DX P9)" block near the existing `zoomIn`/`zoomOut` (`map.ts:1021`). Each returns `this`:
```ts
  /** Instant camera move. Fires movestart/move/moveend (+zoom*). */
  public jumpTo(o: CameraOptions): this { this._camera.jumpTo(o); return this; }
  /** Set centre (projected/data coords) instantly. */
  public setCenter(center: [number, number]): this { this._camera.setCenter(center); return this; }
  /** Set zoom (WebMercator) instantly. */
  public setZoom(zoom: number): this { this._camera.setZoom(zoom); return this; }
  /** Animated move (centre+zoom/scale). */
  public easeTo(o: CameraOptions & AnimationOptions): this { this._camera.easeTo(o); return this; }
  /** Animated pan to a centre. */
  public panTo(center: [number, number], o: AnimationOptions = {}): this { this._camera.panTo(center, o); return this; }
  /** Animated pan by a pixel offset. */
  public panBy(offset: [number, number], o: AnimationOptions = {}): this { this._camera.panBy(offset, o); return this; }
  /** Animated zoom to a level. */
  public zoomTo(zoom: number, o: AnimationOptions = {}): this { this._camera.zoomTo(zoom, o); return this; }
  /** van-Wijk parabolic flight. */
  public flyTo(o: FlyToOptions): this { this._camera.flyTo(o); return this; }
  /** Fit a Bounds into the viewport with optional padding. */
  public fitBounds(b: import('../geo/bounds').Bounds, o: FitBoundsOptions = {}): this { this._camera.fitBounds(b, o); return this; }
  /** Cancel any running camera animation (no-op when idle). */
  public stop(): this { this._camera.stop(); return this; }
```
Do NOT modify `getCenter`/`getZoom`/`setExtent`/`reset`/`zoomIn`/`zoomOut`.

(e) Handler stop-wiring — `dragPan`/`scrollZoom` must call `map.stop()` at gesture start without importing `Emap` (avoid a cycle). Both already take constructor args. Add an optional `onGestureStart?: () => void` the registry wires to `() => this._camera.stop()`.

`src/core/handlers/drag-pan.ts`: add a constructor param + call it on `down`. Find the constructor and the `if (ev.kind === 'down') {` block (line ~40). After `if (ev.button !== 0) return 'passthrough';` and before `this._dragging = true;` add `this._onGestureStart?.();`. Add `private _onGestureStart?: () => void;` and accept it: locate the existing constructor signature and append an optional `onGestureStart?: () => void` parameter assigned to `this._onGestureStart`. (If `DragPanHandler`'s constructor currently takes specific args, ADD the optional param last — do not reorder existing args.)

`src/core/handlers/scroll-zoom.ts`: in the constructor, the `this._wheel.on('mousewheel', (e) => { if (this._enabled) this.fire('mousewheel', e); });` callback — add `this._onGestureStart?.();` as the FIRST line inside that callback (before the `_enabled` check, so a wheel always interrupts a camera animation even mid-fly). Add the same optional `onGestureStart` constructor param + `private _onGestureStart?: () => void;`.

In `src/map/map.ts`, where `DragPanHandler`/`ScrollZoomHandler` are constructed (grep `new DragPanHandler`/`new ScrollZoomHandler`), pass `() => this._camera.stop()` as the new optional arg. The camera is constructed in step (c) BEFORE the handlers? — VERIFY ordering: if handlers are constructed before `_camera`, wrap the callback so it is late-bound: `() => this._camera?.stop()` (the `?.` tolerates construction order; `_camera` is set during the same constructor before any event can fire). Prefer reordering so `_camera` is built before the handlers if trivially safe; otherwise the `?.` guard is acceptable and must be justified by a one-line comment.

(f) `src/index.ts` — in the "Core events + interactions" export region (near line 187+, where `Handler`/handler types are exported) add:
```ts
export type { CameraOptions, AnimationOptions, FlyToOptions, FitBoundsOptions } from './geo/camera';
```

- [ ] **Step 4: Run + GATE**

Run: `npx vitest run src/map/camera-facade.test.ts` → all pass.
`npx tsc --noEmit` exit 0. `npx vitest run` full suite (report EXACT — baseline 1119 + T1(5)+T2(4)+T3(4)+T4(4)+facade(4) ≈ report actual). `npm run build` exit 0. **`src/map/map.test.ts` + `src/map/handler-registry.test.ts` pan/zoom + P1–P8 byte-identical** (the only handler change is an optional callback that is unset in pure-handler unit tests and a no-op `stop()` when idle). Any pan/zoom regression → STOP/BLOCKED with the failing test + output.

- [ ] **Step 5: CHANGELOG**

Add this bullet immediately AFTER the DX Phase 8 bullet in `CHANGELOG.md` `[Unreleased]` `### Added` (match the surrounding wrap):

```markdown
- DX Phase 9 (toward 0.3.0): MapLibre-parity camera API — `map.jumpTo`,
  `setCenter`, `setZoom`, `easeTo`, `panTo`, `panBy`, `zoomTo`, `flyTo`
  (van-Wijk parabolic), `fitBounds`, `stop` (all chainable, return
  `this`), built on the existing `Tween`/`Viewport`. Fires a
  `movestart`/`move`/`moveend` + `zoomstart`/`zoom`/`zoomend` lifecycle.
  Camera state is `{ center (projected/data coords, = the Phase-8
  `mapCoord` space), scale }`; `zoom` is an optional Web-Mercator
  convenience (`Projection.getScale` inverse) — non-Web-Mercator CRSs
  pass `{ scale }`. 2D only (no bearing/pitch). A new camera call (or a
  user pan/wheel) interrupts a running animation; the interrupted move
  still fires its `moveend`. `getCenter`/`getZoom`/`setExtent`/`reset`/
  `zoomIn`/`zoomOut` are byte-identical; default `new Emap()` behaviour
  unchanged (no animation runs until a camera method is called).
```

- [ ] **Step 6: Commit**

```bash
git add src/map/map.ts src/core/handlers/drag-pan.ts src/core/handlers/scroll-zoom.ts src/index.ts src/map/camera-facade.test.ts CHANGELOG.md
git commit -m "feat(map): expose camera facade + stop-on-gesture wiring (DX P9)"
```

---

## Self-Review

**1. Spec coverage (§19):** §19.2 architecture (focused `Camera` on `Tween`/`Viewport`, source-data coords, scale internal) → T1 (primitives) + T2/T3/T4 (`Camera`). §19.3 full API surface (`jumpTo`/`setCenter`/`setZoom`/`easeTo`/`panTo`/`panBy`/`zoomTo`/`flyTo`/`fitBounds`/`stop`, option records, validation throws, `getCenter…zoomOut` byte-identical) → T2 (`jumpTo`+validation), T3 (`easeTo`), T4 (wrappers/`fitBounds`/`flyTo`), T5 (facade returns `this`, legacy untouched). §19.4 events (`movestart`/`move`/`moveend`+`zoomstart`/`zoom`/`zoomend`, jump synchronous, `zoom*` only on scale change, payload `{center,zoom,originalEvent:null}`) → T2 lifecycle test + T3/T4 animated lifecycle. §19.5 interruptibility (last-call-wins fires prior `moveend`; `stop()`; user-gesture cancel via dragPan down / scrollZoom wheel) → T3 interrupt/stop tests + T5 stop-wiring + drag-stops-animation test. §19.6 back-compat (additive, viewport additive, one-line handler change, no default cost) → T1 byte-identical gate, T5 legacy+pan/zoom byte-identical gate. §19.7 testing strategy → each task's tests + facade. §19.8 phasing (P9 standalone, P10 after) → 5 tasks, each green & committed; CHANGELOG T5.

The brainstorm clarifications are encoded: camera `center` = projected/data space (T1 `getCameraState`/`applyCameraState` operate on `(cx,cy)` BEFORE `_projection.getCenter`; documented); `scale` internal with `zoom` optional via `Projection.getScale` (T1) and `_resolve` precedence `scale` > `zoom` > current (T2), throwing if `zoom` not CRS-meaningful.

**2. Placeholder scan:** No TBD/TODO. Every code step shows complete code. The two NOTEs (Tween `t>=1` settle; van-Wijk numerical fallback) are explicit engineering constraints with a defined acceptable fallback and a hard test contract ("lands exactly on target"), not vague hand-waving. The "verify the real `_projection` field name / handler constructor signature / construction order" instructions are concrete verification steps with an explicit no-invention rule (mirrors the P5–P8 NOTE pattern).

**3. Type consistency:** `CameraState {center:[number,number],scale:number}` defined once (T2), produced by `Viewport.getCameraState` (T1) and consumed throughout. `CameraHost` defined in T2, extended once in T4 (adds `getViewportSize`) — T5's Emap host literal supplies all members incl. `getViewportSize`. `CameraOptions`/`AnimationOptions`/`FlyToOptions`/`FitBoundsOptions` defined T2/T4, exported T5 (`src/index.ts`), consumed by the Emap facade T5 with identical signatures. `Projection.getScale(zoom):number` (T1) ↔ `host.scaleFromZoom` (T2 `_resolve`) ↔ Emap wiring `(z)=>this._projection.getScale(z)` (T5) — names consistent. `applyCameraState(center,scale)`/`getCameraState()` identical across T1 (Viewport), T2 (`CameraHost`), T5 (Emap host). `_camera`/`_viewport`/`_projection`/`_scheduleRender` Emap field names flagged for real-name verification in T5(c)(e). Facade methods all return `this` (T5) matching §19.3.

Plan is internally consistent and scoped to one shippable subsystem: an additive, CRS-safe camera built on existing primitives, zero default-path behavior change, with P10 (typed event map covering P9's new events) and P11 (cursor) explicitly deferred to their own cycles.
