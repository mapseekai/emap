# Map Scale Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a QGIS/ArcGIS-style, CRS-aware map scale control with a truthful distance bar, nominal `1:N` scale, and Web-Mercator-only zoom label.

**Architecture:** A DOM-free `ScaleCalculator` samples the current view, turns map coordinates into geographic coordinates on the active CRS ellipsoid, and measures their geodesic distance. `Emap.getScaleMetrics()` is a small public facade over that calculator. `ScaleControl` only schedules updates and renders returned metrics, following the existing Control lifecycle.

**Tech Stack:** TypeScript, Vitest + jsdom, existing `mproj`, existing `geographiclib-geodesic`, Emap `EventDispatcher`, existing Emap control CSS.

## Global Constraints

- Use `rtk` as the prefix for every shell command in this repository.
- Before changing an existing function, method, or class, run GitNexus upstream impact analysis; stop and report a HIGH/CRITICAL result before editing.
- Keep every direct `mapshaper` and `mproj` runtime operation in `src/adapter/mapshaper-adapter.ts`; the calculator must consume an exported adapter helper rather than importing either package.
- Use `AffineTransform` only through `Viewport.unproject()` / `Emap.unproject()`; do not add hand-written transform math.
- A CRS that cannot produce a finite Earth distance returns `null`; do not log repeated errors or fabricate a metric distance, nominal scale, or zoom level.
- Use CSS pixels and a 96-DPI default. Do not use `devicePixelRatio` in scale calculations.
- Preserve the existing dirty worktree. Stage and commit only files owned by each completed task.
- Before every task commit, run GitNexus detection against the full worktree to identify unrelated changes, then run it again with `scope: 'staged'`; do not commit unless the staged report is limited to that task's expected symbols and files.
- Do not regenerate `packages/docs/static/api` as part of this change; its generated files are already outside the feature scope.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/adapter/mapshaper-adapter.ts` | Convert one active map coordinate to geographic longitude/latitude on its own CRS ellipsoid, keeping `mproj` behind the adapter boundary. |
| `src/geo/scale-calculator.ts` | Resolve CRS definitions, cache geographic transformers, sample view rows, calculate geodesic metres-per-pixel and nominal scale. |
| `src/geo/scale-calculator.test.ts` | Test real CRS measurement, position modes, unknown/invalid inputs, unit-independent formatting helpers, and 96-DPI arithmetic. |
| `src/map/map.ts` | Expose the calculator through `Emap.getScaleMetrics()` using the current `Viewport`. |
| `src/map/scale-metrics.test.ts` | Verify the public map API passes the live view/CRS and only exposes a zoom for Web Mercator. |
| `src/ui/scale-control.ts` | Implement the lifecycle, stale-request protection, and DOM rendering for the scale control. |
| `src/ui/scale-control.test.ts` | Test subscriptions, rAF coalescing, DOM output, stale async result suppression, and teardown. |
| `src/ui/controls.css` | Style the compact segmented scale bar using existing theme tokens. |
| `src/ui/controls-css.test.ts` | Assert the new CSS control exposes the expected theme-backed presentation rules. |
| `src/index.ts` | Export the control and public scale types. |
| `README.md` | Document the public API and list the new control. |
| `packages/examples/examples/crs-switch/index.html` | Demonstrate that the same scale control updates across EPSG:4326 and EPSG:3857. |

## Task 1: Geographic transformation and pure scale calculation

**Files:**
- Modify: `src/adapter/mapshaper-adapter.ts:128-417,426-462`
- Create: `src/geo/scale-calculator.ts`
- Create: `src/geo/scale-calculator.test.ts`

**Interfaces:**
- Consumes: `resolveProjectCrsDefinition(crs)` from `src/geo/crs-resolver.ts`; `Viewport.unproject(px, py)`-compatible callback; `Geodesic.Geodesic(a, f).Inverse(...)` from `geographiclib-geodesic`.
- Produces: `createGeographicCoordinateTransformer(definition)`, `ScaleCalculationMethod`, `ScaleMetrics`, `GetScaleMetricsOptions`, `ScaleView`, `ScaleCalculator`, and pure `formatScaleDistance()` / `selectScaleDistance()` helpers for the control.

- [ ] **Step 1: Add failing scale-calculator tests for geographic, projected, and invalid CRS views.**

  Create `src/geo/scale-calculator.test.ts` with a deterministic view factory. The factory maps one CSS pixel to a known coordinate increment so latitude-dependent scale can be tested without a DOM:

  ```ts
  import { describe, expect, it } from 'vitest';
  import { ScaleCalculator } from './scale-calculator';

  function geographicView(latitude: number) {
    return {
      crs: 'EPSG:4326',
      width: 200,
      height: 100,
      unproject: (px: number, py: number): [number, number] => [
        -1 + px / 100,
        latitude + (50 - py) / 100,
      ],
    };
  }

  describe('ScaleCalculator', () => {
    it('reports fewer metres per pixel at 60° latitude than at the equator', async () => {
      const calculator = new ScaleCalculator();
      const equator = await calculator.getMetrics(geographicView(0));
      const highLatitude = await calculator.getMetrics(geographicView(60));

      expect(equator).not.toBeNull();
      expect(highLatitude).not.toBeNull();
      expect(highLatitude!.metersPerPixel / equator!.metersPerPixel).toBeCloseTo(0.5, 2);
    });
  });
  ```

  Add cases that assert all of the following contracts:

  ```ts
  expect(await calculator.getMetrics(webMercatorView)).toMatchObject({ calculationMethod: 'center' });
  expect(await calculator.getMetrics(utmView)).toMatchObject({ calculationMethod: 'center' });
  expect(await calculator.getMetrics(invalidView)).toBeNull();
  expect((await calculator.getMetrics(projectedView, { calculationMethod: 'equator' }))?.calculationMethod)
    .toBe('center');
  expect((await calculator.getMetrics(geographicView(45), { dpi: 192 }))!.scaleDenominator)
    .toBeCloseTo((await calculator.getMetrics(geographicView(45), { dpi: 96 }))!.scaleDenominator * 2);
  ```

  Include pure helper assertions for `1 / 2 / 5 × 10^n` selection, `200 m`, `2 km`, `656 ft`, `0.12 mi`, dual labels, and a non-finite input returning no label.

- [ ] **Step 2: Run the focused test to verify it fails because the calculator does not exist.**

  Run:

  ```bash
  rtk node_modules/.bin/vitest run src/geo/scale-calculator.test.ts
  ```

  Expected: FAIL with a module-resolution error for `./scale-calculator`.

- [ ] **Step 3: Add the adapter-owned geographic inverse helper.**

  In `src/adapter/mapshaper-adapter.ts`, define these public types next to `MapshaperRuntimeCrs` without extending `MapshaperAdapter` (existing adapter mocks must remain source-compatible):

  ```ts
  export interface GeographicCoordinateTransformer {
    readonly isGeographic: boolean;
    readonly semiMajorAxis: number;
    readonly flattening: number;
    inverse(point: readonly [number, number]): [number, number] | null;
  }

  interface MprojProjection {
    is_latlong?: boolean;
    a?: number;
    es?: number;
  }
  ```

  Implement `createGeographicCoordinateTransformer(definition: string)`. It must parse once with `parseMapshaperCrs()`, derive `a` and `f = 1 - sqrt(1 - es)` when both are finite, and otherwise use WGS 84 constants `6378137` and `1 / 298.257223563`. Its `inverse()` must:

  ```ts
  if (projection.is_latlong) return finite(point[0], point[1]) ? [point[0], point[1]] : null;

  const lp = mproj.pj_inv({ x: point[0], y: point[1] }, projection);
  const longitude = lp.lam * (180 / Math.PI);
  const latitude = lp.phi * (180 / Math.PI);
  return finite(longitude, latitude) ? [longitude, latitude] : null;
  ```

  Catch `mproj` exceptions and treat infinite results as `null`. This conversion remains in the adapter and retains the source CRS ellipsoid, avoiding an unnecessary datum conversion to WGS 84.

- [ ] **Step 4: Implement the DOM-free `ScaleCalculator`.**

  Create `src/geo/scale-calculator.ts` with these exported contracts:

  ```ts
  export type ScaleCalculationMethod = 'top' | 'center' | 'bottom' | 'average' | 'equator';

  export interface ScaleMetrics {
    metersPerPixel: number;
    scaleDenominator: number;
    calculationMethod: ScaleCalculationMethod;
  }

  export interface GetScaleMetricsOptions {
    calculationMethod?: ScaleCalculationMethod;
    dpi?: number;
  }

  export interface ScaleView {
    crs: string;
    width: number;
    height: number;
    unproject(px: number, py: number): [number, number];
  }
  ```

  `ScaleCalculator.getMetrics(view, options)` must resolve the CRS with `resolveProjectCrsDefinition(view.crs)`, cache the resulting transformer `Promise` by `signature`, and return `null` for an empty viewport, resolver failure, transformer failure, or no finite samples. For `top`, `center`, and `bottom`, sample `view.width / 2` and `+1` at rows `0`, `height / 2`, and `height` respectively. Convert inverse-transform longitudes/latitudes with `new Geodesic.Geodesic(a, f).Inverse(lat1, lon1, lat2, lon2).s12`.

  Implement `average` as the arithmetic mean of valid top, center, and bottom metres-per-pixel samples. Implement `equator` only when `transformer.isGeographic`; use the center sample's longitude delta but measure its endpoints at latitude `0`. For a projected CRS requested with `equator`, change the effective method to `center` and return `calculationMethod: 'center'`.

  Calculate the unsnapped nominal denominator exactly as:

  ```ts
  const scaleDenominator = (metersPerPixel * (options.dpi ?? 96)) / 0.0254;
  ```

  Keep bar-distance selection and unit formatting as pure exported helpers. Select the greatest `1`, `2`, or `5 × 10^n` distance no greater than `metersPerPixel * maxWidth`; return its width in CSS pixels and its metric/imperial/dual labels. Do not let formatting round the returned `scaleDenominator`.

- [ ] **Step 5: Run the focused test and the CRS resolver suite.**

  Run:

  ```bash
  rtk node_modules/.bin/vitest run src/geo/scale-calculator.test.ts src/geo/crs-resolver.test.ts
  ```

  Expected: PASS. The new test proves metre distance varies by latitude, works for real Web Mercator/UTM inputs, respects 96-DPI arithmetic, and returns `null` for unmeasurable inputs.

- [ ] **Step 6: Typecheck and commit the isolated calculation layer.**

  Run:

  ```bash
  rtk npm run typecheck
  rtk git diff --check -- src/adapter/mapshaper-adapter.ts src/geo/scale-calculator.ts src/geo/scale-calculator.test.ts
  rtk git add src/adapter/mapshaper-adapter.ts src/geo/scale-calculator.ts src/geo/scale-calculator.test.ts
  rtk git commit -m "feat: add CRS-aware scale calculation"
  ```

  Before the `git add`, call `mcp__gitnexus__detect_changes({ repo: 'emap', scope: 'all' })`; after it, call the same tool with `scope: 'staged'`. Expected: typecheck and whitespace checks pass, staged detection has no unexpected execution flow, and the commit contains only the three listed files.

## Task 2: Expose scale metrics from `Emap`

**Files:**
- Modify: `src/map/map.ts:169-250,1745-1751,2019-2028`
- Create: `src/map/scale-metrics.test.ts`
- Modify: `src/index.ts:5-60,350-370`

**Interfaces:**
- Consumes: `ScaleCalculator`, `ScaleMetrics`, and `GetScaleMetricsOptions` from Task 1; `_viewport.width`, `_viewport.height`, and `_viewport.unproject()`.
- Produces: `Emap.getScaleMetrics(options?): Promise<(ScaleMetrics & { zoom?: number }) | null>` and root-package type exports.

- [ ] **Step 1: Add failing public-API tests.**

  Create `src/map/scale-metrics.test.ts` under jsdom. Build a map with an explicit `setCRS()`, `setExtent()`, and viewport size, then assert:

  ```ts
  const metrics = await map.getScaleMetrics();
  expect(metrics).toMatchObject({ metersPerPixel: expect.any(Number), scaleDenominator: expect.any(Number) });
  expect(metrics?.zoom).toBeUndefined();

  map.setCRS('EPSG:3857');
  const webMercator = await map.getScaleMetrics();
  expect(webMercator?.zoom).toEqual(expect.any(Number));
  ```

  Add a case that builds an empty/zero-sized map view and requires `null`, not a thrown error.

- [ ] **Step 2: Run the public-API test to verify it fails.**

  Run:

  ```bash
  rtk node_modules/.bin/vitest run src/map/scale-metrics.test.ts
  ```

  Expected: FAIL because `Emap.getScaleMetrics` is not yet defined.

- [ ] **Step 3: Add a lazy calculator facade to `Emap`.**

  Add a lazily initialized private calculator field beside `_viewport`, preserving test helpers that create `Emap` with `Object.create(Emap.prototype)`. Add the public method beside `getZoom()`:

  ```ts
  public async getScaleMetrics(
    options: GetScaleMetricsOptions = {},
  ): Promise<(ScaleMetrics & { zoom?: number }) | null> {
    const metrics = await this._scaleCalculatorInstance().getMetrics(
      {
        crs: this.getCRS(),
        width: this._viewport.width,
        height: this._viewport.height,
        unproject: (px, py) => this._viewport.unproject(px, py),
      },
      options,
    );
    if (!metrics) return null;
    const crs = this.getCRS().toLowerCase();
    return crs === 'epsg:3857' || crs === 'webmercator'
      ? { ...metrics, zoom: this.getZoom() }
      : metrics;
  }
  ```

  Name the lazy getter `_scaleCalculatorInstance()` and return a single cached `ScaleCalculator`. Do not change `getZoom()` or make its `0` value a public sentinel for other CRSs.

  Re-export `ScaleCalculationMethod`, `ScaleMetrics`, and `GetScaleMetricsOptions` from `src/index.ts` next to the existing geometry/projection exports.

- [ ] **Step 4: Run the API and calculator suites.**

  Run:

  ```bash
  rtk node_modules/.bin/vitest run src/map/scale-metrics.test.ts src/geo/scale-calculator.test.ts src/map/camera-facade.test.ts
  ```

  Expected: PASS. The new map API returns local metrics for Earth CRSs and adds `zoom` only for the same two Web Mercator aliases already used by `Projection.getZoom()`.

- [ ] **Step 5: Typecheck and commit the map facade.**

  Run:

  ```bash
  rtk npm run typecheck
  rtk git diff --check -- src/map/map.ts src/map/scale-metrics.test.ts src/index.ts
  rtk git add src/map/map.ts src/map/scale-metrics.test.ts src/index.ts
  rtk git commit -m "feat: expose map scale metrics"
  ```

  Before the `git add`, call `mcp__gitnexus__detect_changes({ repo: 'emap', scope: 'all' })`; after it, call the same tool with `scope: 'staged'`. Expected: all checks pass, staged detection has no unexpected execution flow, and the commit contains only Task 2 files.

## Task 3: Add `ScaleControl` and themed segmented-bar rendering

**Files:**
- Create: `src/ui/scale-control.ts`
- Create: `src/ui/scale-control.test.ts`
- Modify: `src/ui/controls.css:137-169`
- Modify: `src/ui/controls-css.test.ts`

**Interfaces:**
- Consumes: `Control`, `Emap.getScaleMetrics()`, `ScaleCalculationMethod`, `formatScaleDistance()`, and `selectScaleDistance()`.
- Produces: `ScaleControl` and `ScaleControlOptions`; `.emap-scale-ctrl` DOM/CSS contract.

- [ ] **Step 1: Add failing jsdom lifecycle and rendering tests.**

  Create `src/ui/scale-control.test.ts` with an Emap-shaped stub exposing `on`, `off`, `getScaleMetrics`, and `_emit`. Start with this contract:

  ```ts
  const metrics = {
    metersPerPixel: 2,
    scaleDenominator: 7559.055,
    calculationMethod: 'center' as const,
    zoom: 12.25,
  };
  const map = stubMap(Promise.resolve(metrics));
  const control = new ScaleControl();
  const root = control.onAdd(map as any);

  expect(map.on).toHaveBeenCalledWith('move', expect.any(Function));
  expect(map.on).toHaveBeenCalledWith('resize', expect.any(Function));
  expect(map.on).toHaveBeenCalledWith('crschange', expect.any(Function));
  ```

  Stub `requestAnimationFrame` so tests can flush exactly one queued update. Assert the default DOM contains `.emap-scale-summary`, `.emap-scale-labels`, `.emap-scale-bar`, a readable `1:7,559`, `Zoom 12.25`, labels `0`, midpoint, and a bar width no greater than 140 px. Add separate tests for `showScale: false`, `showZoom: false`, metric/imperial/dual units, a `null` result hiding the root, two `move` events scheduling one frame, `crschange` clearing stale text immediately, and `onRemove()` detaching all three listeners/cancelling the outstanding frame.

  Add a deferred-promise test: resolve request A after request B and assert only B is allowed to update the DOM.

- [ ] **Step 2: Run the new control tests to verify they fail.**

  Run:

  ```bash
  rtk node_modules/.bin/vitest run src/ui/scale-control.test.ts
  ```

  Expected: FAIL because `ScaleControl` is not yet implemented.

- [ ] **Step 3: Implement the thin `ScaleControl` shell.**

  Create `src/ui/scale-control.ts` with this option contract:

  ```ts
  export interface ScaleControlOptions {
    units?: 'metric' | 'imperial' | 'dual';
    calculationMethod?: ScaleCalculationMethod;
    maxWidth?: number;
    dpi?: number;
    showScale?: boolean;
    showZoom?: boolean;
    className?: string;
  }
  ```

  Default to `metric`, `center`, `140`, `96`, `true`, and `true`. In `onAdd`, create a `div` with class `emap-ctrl emap-scale-ctrl`, `aria-live="polite"`, and child elements for summary, labels, and a four-segment alternating bar. Register one bound update function for `move`, `resize`, and `crschange`.

  Schedule updates with one stored `requestAnimationFrame` id. Each scheduled update increments a numeric revision before awaiting `map.getScaleMetrics({ calculationMethod, dpi })`; only apply a result when its revision equals the latest revision and `_map`/`_container` still exist. On `crschange`, increment the revision, clear child text, and set `hidden = true` before scheduling. On ordinary movement, retain the last completed reading until the fresh request returns.

  Render denominator with `Math.round(metrics.scaleDenominator).toLocaleString('en-US')`; render zoom only when `metrics.zoom !== undefined && showZoom`; derive the bar distance/labels with Task 1's pure helpers; set `--emap-scale-width` from the selected width. A `null` metric hides the root. Never call `console.error` for an unavailable result.

  In `onRemove`, call `off()` for all subscribed events, cancel the saved frame id, remove the DOM node, and null all retained elements/maps.

- [ ] **Step 4: Add focused control CSS and a CSS contract assertion.**

  Add `.emap-scale-ctrl` rules after the status-control section in `src/ui/controls.css`. Reuse `--emap-current-card`, `--emap-current-card-foreground`, `--emap-current-border`, `--emap-font`, and `--emap-surface-shadow`; give it compact padding, tabular figures, `pointer-events: auto`, and no fixed opaque color. Style `.emap-scale-bar` to use `width: var(--emap-scale-width)`, a 1px border, and four equal `.emap-scale-segment` children alternating current foreground/card background. Keep labels in a three-column layout so `0`, midpoint, and end remain aligned.

  Extend `src/ui/controls-css.test.ts` to append an `.emap-scale-ctrl` fixture with bar and segments, then assert its computed text color/background/border resolve from the existing theme tokens in both default and `.dark` hosts.

- [ ] **Step 5: Run UI tests and commit the control.**

  Run:

  ```bash
  rtk node_modules/.bin/vitest run src/ui/scale-control.test.ts src/ui/controls-css.test.ts src/ui/status-control.test.ts
  rtk npm run typecheck
  rtk git diff --check -- src/ui/scale-control.ts src/ui/scale-control.test.ts src/ui/controls.css src/ui/controls-css.test.ts
  rtk git add src/ui/scale-control.ts src/ui/scale-control.test.ts src/ui/controls.css src/ui/controls-css.test.ts
  rtk git commit -m "feat: add map scale control"
  ```

  Before the `git add`, call `mcp__gitnexus__detect_changes({ repo: 'emap', scope: 'all' })`; after it, call the same tool with `scope: 'staged'`. Expected: all tests and typecheck pass; staged detection has no unexpected execution flow; the control has no raw DOM map listeners and no stale async DOM writes.

## Task 4: Export, document, demonstrate, and run feature-level verification

**Files:**
- Modify: `src/index.ts:350-370`
- Modify: `README.md:62-84,920-932`
- Modify: `packages/examples/examples/crs-switch/index.html:132-145`
- Test: `src/ui/scale-control.test.ts`
- Test: `src/map/scale-metrics.test.ts`

**Interfaces:**
- Consumes: `ScaleControl`, `ScaleControlOptions`, and root-exported metric types from Tasks 2 and 3.
- Produces: public package exports, an API usage example, and a CRS-switching manual acceptance example.

- [ ] **Step 1: Add a failing package-entry export assertion.**

  In `src/ui/scale-control.test.ts`, add a dynamic package-entry test that imports `../index` and requires:

  ```ts
  const api = await import('../index');
  expect(api.ScaleControl).toBe(ScaleControl);
  ```

  Add a compile-only assignment in `src/map/scale-metrics.test.ts` proving `GetScaleMetricsOptions` and `ScaleMetrics` are importable from `../index`.

- [ ] **Step 2: Run export tests to verify they fail before the entry-point change.**

  Run:

  ```bash
  rtk node_modules/.bin/vitest run src/ui/scale-control.test.ts src/map/scale-metrics.test.ts
  ```

  Expected: FAIL because the root entry point does not export `ScaleControl` yet.

- [ ] **Step 3: Export and document the finished public surface.**

  In the UI-control export block of `src/index.ts`, add:

  ```ts
  export { ScaleControl } from './ui/scale-control';
  export type { ScaleControlOptions } from './ui/scale-control';
  ```

  Keep the metric type exports next to the existing geometry/projection exports from Task 2. Update README's Quick Start import and control setup with `ScaleControl` in the lower-left corner. Add this row to the control table:

  ```md
  | `ScaleControl` | Local ellipsoidal distance bar, nominal `1:N`, and Web Mercator zoom |
  ```

  Add a compact `ScaleControl` options example that demonstrates `units: 'dual'`, `calculationMethod: 'average'`, and an explicit `dpi` override. State that unsupported/non-Earth CRSs hide measurements rather than guessing.

- [ ] **Step 4: Add the scale control to the CRS-switching example.**

  Change the example's destructuring import to include `ScaleControl`, then add:

  ```js
  map.addControl(new ScaleControl({ units: 'metric', calculationMethod: 'center' }), 'bottom-left');
  ```

  Extend the nearby Chinese hint with one concise sentence explaining that the distance bar measures local ground distance and continues to work after switching between EPSG:4326 and EPSG:3857 when the CRS is supported.

- [ ] **Step 5: Run the complete relevant validation set.**

  Run:

  ```bash
  rtk node_modules/.bin/vitest run src/geo/scale-calculator.test.ts src/map/scale-metrics.test.ts src/ui/scale-control.test.ts src/ui/controls-css.test.ts src/geo/crs-resolver.test.ts src/map/source-loading.test.ts
  rtk npm run typecheck
  rtk npm run build
  rtk git diff --check -- src/index.ts README.md packages/examples/examples/crs-switch/index.html src/ui/scale-control.test.ts src/map/scale-metrics.test.ts
  ```

  Expected: every focused regression suite, typecheck, production build, and whitespace check pass.

- [ ] **Step 6: Run isolated GitNexus review and commit the public integration.**

  Before staging, call `mcp__gitnexus__detect_changes({ repo: 'emap', scope: 'all' })`; identify existing unrelated dirty files separately. Stage only this task's files, then call `mcp__gitnexus__detect_changes({ repo: 'emap', scope: 'staged' })`. The staged report must name only expected public-export/docs/example changes and no unexpected process.

  Run:

  ```bash
  rtk git add src/index.ts README.md packages/examples/examples/crs-switch/index.html src/ui/scale-control.test.ts src/map/scale-metrics.test.ts
  rtk git commit -m "docs: document map scale control"
  ```

  Expected: commit only the integration/docs files. Do not stage prior CRS fixes, generated API pages, or any unrelated user changes.

## Final acceptance checklist

- [ ] `new ScaleControl()` renders a friendly segmented distance bar for EPSG:4326, EPSG:3857, UTM, and supported custom Proj.4 data.
- [ ] EPSG:4326 local distance changes by latitude; output remains metres/feet, never degrees.
- [ ] `1:N` comes from local metres-per-CSS-pixel at 96 DPI unless the caller supplies another DPI.
- [ ] `top`, `center`, `bottom`, `average`, and geographic `equator` calculation methods return the documented behavior; projected `equator` falls back to `center`.
- [ ] Unknown/non-Earth/failed transformations show no invented distance, nominal scale, or zoom.
- [ ] Dragging, wheel zoom, resize, and CRS changes schedule at most one frame update and cannot apply an obsolete async result.
- [ ] `zoom` is displayed only for EPSG:3857 or `webmercator`.
- [ ] Root exports, README, CRS-switching example, focused tests, typecheck, build, GitNexus staged detection, and whitespace validation all pass.
