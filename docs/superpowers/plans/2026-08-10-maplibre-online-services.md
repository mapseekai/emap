# MapLibre Online Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one Emap-owned MapLibre canvas that can show zero or one basemap plus multiple online overlays, while presenting basemaps separately in `BasemapControl` and overlays together with Emap business layers in a new `LayerControl`.

**Architecture:** Keep MapLibre lifecycle, registry state, style switching, overlay reconciliation, camera synchronization, and teardown in one internal manager owned by `Emap`. Expose that manager through a public `MapLibreServiceManager` interface; keep both controls as event-driven views over the same state. Preserve Emap's existing Canvas renderer above the complete MapLibre canvas and preserve legacy `BasemapControl` inputs through a narrow adapter.

**Tech Stack:** TypeScript, installed MapLibre GL JS `5.17.0`, HTML5 Canvas, `EventDispatcher`, Vitest, jsdom, Biome, Rollup, TypeDoc, Docusaurus.

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-08-10-maplibre-online-services-design.md`; implementation must not silently weaken or expand it.
- There is exactly one MapLibre map and canvas per `Emap`. It renders below the entire Emap canvas. Do not create one map per control or one map per service.
- Exactly zero or one `role: 'basemap'` service is active. Any number of `role: 'overlay'` services may be active.
- Service definitions use native MapLibre `StyleSpecification`, `SourceSpecification`, and `LayerSpecification`. Do not add a parallel XYZ/WMS/WMTS/TileJSON abstraction or a capabilities parser.
- WMS support is a native raster tile template containing `{bbox-epsg-3857}`. TMS uses the source's native `scheme: 'tms'`; WMTS is a normal tile template; TileJSON uses a native source `url`.
- `Emap` remains the only camera and pointer owner. MapLibre is always `interactive: false`; camera updates flow from Emap `move`/`resize` events, never from side effects inside `render()`.
- The manager must lazy-load `maplibre-gl`. Registry-only operations and maps with no visible MapLibre service must not import or instantiate MapLibre.
- Do not change the MapLibre dependency version in this feature; implement against the repository's locked `5.17.0` surface.
- A basemap change uses `setStyle()`. Immediately before every actual base, blank, or recovery style transition, remove all manager-owned overlay layers in reverse visual order and then their sources, and invalidate their ownership handles. Reconcile every still-visible overlay after `style.load`; do not rely on MapLibre style-diff object reuse for ownership.
- Map construction's initial style load, ordinary `setStyle()`, blank-style transitions, and recovery all use one serialized style coordinator. One actual style load is in flight, the latest desired revision wins, superseded public promises reject with `AbortError`, and an older completion never commits current service state.
- Every service record has a definition revision and an operation revision/token. Overlay work waits for the current desired style to become stable and also captures its ready style generation. Dynamic import, reprojection, initial style readiness, install, update, hide, and remove recheck the operation token, desired state, and style generation after every `await` and before resource mutation. A style-only generation change retries the still-current intent on the newest stable style; a superseded service operation rejects with `AbortError`.
- Style reconciliation and public overlay calls use one serialized per-service operation path. A style generation becomes externally stable only after its visible-overlay reconciliation completes; waiting calls observe the completed current-generation job instead of duplicating resource adds.
- Overlay installation and active-overlay updates are transactional. Roll back only resources added by the failed attempt, restore the prior definition when updating, and never disturb sibling services.
- A failed basemap restores the last successfully loaded basemap only while that registry record still has the exact definition revision that became ready; a missing or updated candidate falls back to blank. Tile errors are observable but non-fatal.
- Resources added through `getMapLibreMap()` are unmanaged and need not survive `setStyle()`.
- `MapLibreOverlayService.visible` is initial/add intent only. `updateService()` preserves the current active state; callers use `setOverlayVisibility()` to change runtime visibility.
- `BasemapStyle`, `BasemapOptions.styles`, `BasemapOptions.defaultStyle`, and `BasemapControl.isOn()` remain source-compatible. `defaultStyle` must become functional.
- `BasemapControl.onRemove()` and `LayerControl.onRemove()` only detach their DOM/listeners. Only `Emap.remove()` destroys the manager and MapLibre runtime.
- `getLayers()` keeps returning explicit Emap layers only. `getRenderedLayers()` returns cloned effective layers, including generated defaults.
- The first visibility change targeting a generated default materializes the complete generated list into explicit `_layers` before applying the change.
- Activating a previously inactive service must reproject Emap to Web Mercator as today. If a later external `reproject()` moves Emap away from Web Mercator, preserve service intent/resources and active/status values but suspend and hide the MapLibre container. Reveal, resize, and resync when Emap returns to Web Mercator. While suspended, same-value visibility calls remain no-ops; deactivation/removal and already-active updates may mutate the hidden MapLibre runtime and settle normally, but do not reproject or reveal it. Never display knowingly misaligned canvases.
- Engine notifications use `EventDispatcher`; raw DOM events remain inside controls. Do not genericize or otherwise modify `src/core/events.ts`.
- `EventDispatcher.fire()` is synchronous and listeners may call the manager reentrantly. Install intent/revision/state atomically before emitting a snapshot, then recheck the originating operation/style token after every `fire()` before further events or runtime mutations.
- Do not touch `src/map/layer-registry.ts`; it remains the `(sourceId, layerId) -> MapshaperLayer` resolver and is unrelated to MapLibre services.
- Do not import `mapshaper` outside the existing approved boundaries. No new operation is introduced, so `COMMAND_EFFECTS` must not change.
- Automated tests must not fetch public tiles. Use a controllable MapLibre test double and static example assertions.
- TypeScript code uses precise interfaces/unions, type-only MapLibre imports, inferred locals, `unknown` instead of `any` in production, and `@ts-expect-error` for negative type assertions.
- Tests assert observable behavior and use targeted fakes/spies rather than a global MapLibre module mock. Async tests must explicitly settle controlled `style.load`/`error` events.
- GitNexus currently rates `MapOptions` CRITICAL (about 121 impacted symbols), `EventDispatcher` CRITICAL (about 193), and `Emap` HIGH (about 40). Before implementation edits, report these risks again. Do not proceed past a newly reported HIGH/CRITICAL impact without warning the user.
- Before editing every existing symbol, run GitNexus upstream `impact`. Before every commit, run GitNexus `detect_changes` and `rtk git diff --check`.
- All repository shell commands are prefixed with `rtk`. Use `apply_patch` for hand edits and let Biome/TypeDoc perform mechanical generated changes.

---

## File Map

| File | Responsibility in this change |
| --- | --- |
| `src/map/maplibre-service.ts` | Public service, state, event, integration-option, and manager-interface contracts. |
| `src/map/maplibre-service-manager.ts` | Internal registry and MapLibre lifecycle implementation plus internal factory/host seam. |
| `src/map/maplibre-service-manager.test.ts` | Deterministic manager validation, lifecycle, race, rollback, and cleanup tests. |
| `src/map/maplibre-service.test-d.ts` | Public MapLibre-native type and event inference assertions. |
| `src/map/maplibre-emap-integration.test.ts` | Real `Emap` ownership/getter/options/teardown integration without network access. |
| `src/map/types.ts` | Add `MapOptions.mapLibre`. |
| `src/map/map.ts` | Own the shared manager, expose it, destroy it, publish rendered-layer state, and materialize defaults. |
| `src/core/event-map.ts` | Add the typed `layerchange` payload to `EmapEventMap`. |
| `src/core/event-map.test-d.ts` | Assert `layerchange` inference and invalid values. |
| `src/core/event-map.test.ts` | Assert runtime `layerchange` dispatch through a real Emap. |
| `src/ui/basemap-control.ts` | Replace MapLibre ownership with legacy normalization and a manager-driven basemap panel. |
| `src/ui/basemap-control.test.ts` | Legacy compatibility, selection, accessibility, rerender, and teardown tests. |
| `src/ui/layer-control.ts` | New unified Emap-layer/online-overlay panel. |
| `src/ui/layer-control.test.ts` | Group order, visibility routing, event synchronization, accessibility, and teardown tests. |
| `src/ui/controls.css` | Shared panel/row/status styling and specific basemap/layer control classes. |
| `src/index.ts` | Export the public manager/service contracts and `LayerControl`. |
| `src/index.test.ts` | Pin the new runtime `LayerControl` export and preserved `BasemapControl` export. |
| `packages/examples/examples/online-map-services/index.html` | Runnable two-basemap, two-overlay, one-business-layer example. |
| `docs-meta/examples.ts` | Register the example and its API/docs/fixture metadata. |
| `packages/examples/vite.config.ts` | Add the example route. |
| `test/docs/example-catalog.test.ts` | Pin the new example id and static behavioral contract. |
| `README.md` | English control table and concise online-services API introduction. |
| `README.zh-CN.md` | Chinese control table and concise online-services API introduction. |
| `packages/docs/docs/guides/controls.md` | Chinese complete MapLibre services/control guide and metadata. |
| `packages/docs/i18n/en/docusaurus-plugin-content-docs/current/guides/controls.md` | Synchronized English guide and metadata. |
| `packages/docs/static/api/**` | Regenerated TypeDoc output; never hand-edit. |

## Public Contract to Hold Constant

Create `src/map/maplibre-service.ts` around this exact public shape. The manager implementation is internal so callers cannot accidentally construct a second canvas; callers receive the interface from `Emap.mapLibreServices`.

```ts
import type * as maplibregl from 'maplibre-gl';

export type MapLibreService = MapLibreBasemapService | MapLibreOverlayService;

export interface MapLibreBasemapService {
  id: string;
  name: string;
  role: 'basemap';
  style: string | maplibregl.StyleSpecification;
}

export interface MapLibreOverlayService {
  id: string;
  name: string;
  role: 'overlay';
  sources: Record<string, maplibregl.SourceSpecification>;
  layers: maplibregl.LayerSpecification[];
  visible?: boolean;
}

export interface MapLibreIntegrationOptions {
  services?: readonly MapLibreService[];
  defaultBasemap?: string;
  mapOptions?: Omit<
    maplibregl.MapOptions,
    'container' | 'style' | 'center' | 'zoom' | 'interactive'
  >;
}

export interface MapLibreServiceState {
  id: string;
  active: boolean;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: Error;
}

export type MapLibreServiceChangeReason =
  | 'add'
  | 'update'
  | 'remove'
  | 'basemap'
  | 'visibility'
  | 'status';

export interface MapLibreServiceChangeEvent {
  serviceId: string;
  role: MapLibreService['role'];
  reason: MapLibreServiceChangeReason;
  state?: MapLibreServiceState;
}

export interface MapLibreServiceErrorEvent {
  serviceId?: string;
  phase: 'style' | 'source' | 'layer' | 'tile' | 'lifecycle';
  error: Error;
  fatal: boolean;
}

export interface MapLibreServiceEventMap {
  change: MapLibreServiceChangeEvent;
  error: MapLibreServiceErrorEvent;
}

export interface MapLibreServiceManager {
  addService(service: MapLibreService): Promise<void>;
  updateService(id: string, service: MapLibreService): Promise<void>;
  removeService(id: string): Promise<void>;
  setBasemap(id: string | null): Promise<void>;
  setOverlayVisibility(id: string, visible: boolean): Promise<void>;
  getServices(): readonly MapLibreService[];
  getServiceState(id: string): MapLibreServiceState | undefined;
  getMapLibreMap(): maplibregl.Map | null;
  on<K extends keyof MapLibreServiceEventMap>(
    type: K,
    listener: (event: { type: K } & MapLibreServiceEventMap[K]) => void,
  ): this;
  off<K extends keyof MapLibreServiceEventMap>(
    type: K,
    listener: (event: { type: K } & MapLibreServiceEventMap[K]) => void,
  ): this;
  once<K extends keyof MapLibreServiceEventMap>(
    type: K,
    listener: (event: { type: K } & MapLibreServiceEventMap[K]) => void,
  ): this;
}
```

For `remove`, `MapLibreServiceChangeEvent.state` is `undefined` because the id no longer resolves. For every other change it is a defensive state snapshot. `getServices()` and `getServiceState()` must not expose mutable registry records.

`setBasemap(next)` publishes one `basemap` change for the previous basemap becoming inactive and one for `next` becoming active. Selecting `null` publishes only the previous basemap change; selecting `null` when none is active is a no-op. This keeps `serviceId` required and gives controls a simple “rerender on any change” contract.

Whenever a new selection supersedes the previous basemap—including one still loading—the previous change snapshot is `{ active: false, status: 'idle' }` with `error` cleared. Its already-superseded promise rejects with `AbortError`, and its later physical terminal event cannot change that final inactive state.

`setBasemap()` installs the new desired request/revision and both state snapshots before its first synchronous `change` event. It guards after each event callback. If a listener selects another basemap reentrantly, the outer call emits/starts nothing further once its revision is no longer desired.

---

## Task 1: Define and Validate the Service Registry

**Files:**

- Create: `src/map/maplibre-service.ts`
- Create: `src/map/maplibre-service-manager.ts`
- Create: `src/map/maplibre-service-manager.test.ts`

**Interfaces:**

- Produces: the public contract above, internal `MapLibreServiceHost`, internal `MapLibreModuleLoader`, `MapLibreServiceManagerImpl`, and `createMapLibreServiceManager()`.
- Consumes later: `Emap`, both controls, public exports, and type tests.

- [ ] **Step 1: Record the no-edit impact boundary**

This task creates new symbols only. Query GitNexus for the concepts `BasemapControl MapLibre lifecycle` and `Emap EventDispatcher manager ownership` to record related flows, but do not edit `EventDispatcher`, `Emap`, or `MapOptions` yet.

- [ ] **Step 2: Add registry-first failing tests**

Start `src/map/maplibre-service-manager.test.ts` with `// @vitest-environment jsdom`. Define a narrow host fake and an injected loader spy; do not import real tiles or construct real WebGL:

```ts
const host = {
  getCanvasContainer: vi.fn(() => document.createElement('div')),
  getCRS: vi.fn(() => 'webmercator'),
  reproject: vi.fn(async () => undefined),
  getCenter: vi.fn(() => [120, 30] as [number, number]),
  getZoom: vi.fn(() => 4),
  on: vi.fn(),
  off: vi.fn(),
};

const base = {
  id: 'light',
  name: 'Light',
  role: 'basemap',
  style: 'https://example.test/light.json',
} as const;

const roads = {
  id: 'roads',
  name: 'Roads',
  role: 'overlay',
  sources: {
    roads: { type: 'vector', url: 'https://example.test/roads.json' },
  },
  layers: [
    { id: 'roads-line', type: 'line', source: 'roads', 'source-layer': 'roads' },
  ],
} as const satisfies MapLibreOverlayService;
```

Add tests that assert:

1. Construction with no visible service does not call the loader.
2. `addService()` records a cloned inactive basemap or overlay and emits one `change/add`.
3. Duplicate service ids reject without mutation.
4. Overlay source and layer ids are globally unique across overlays.
5. A layer with a `source` references one declared by that service; a native `background` layer without `source` is allowed, while other source-requiring layer types without one are rejected at runtime.
6. `updateService()` preserves registry position and rejects role changes or `service.id !== id`.
7. Inactive update/remove never load MapLibre.
8. Unknown ids and role-mismatched operations reject with stable messages.
9. Duplicate/invalid initial services and an invalid `defaultBasemap` are rejected synchronously by manager construction.
10. A throwing `change` listener produces a typed non-fatal `error` event with `phase: 'lifecycle'`.
11. Updating either an active or inactive overlay preserves its current active flag even if the replacement definition's `visible` hint differs.

- [ ] **Step 3: Verify RED**

```bash
rtk pnpm exec vitest run src/map/maplibre-service-manager.test.ts --reporter=dot
```

Expected: module imports fail because the contract and manager files do not exist.

- [ ] **Step 4: Add the public types and internal host seam**

Add the exact public contract from “Public Contract to Hold Constant”. In `src/map/maplibre-service-manager.ts`, add these internal seams without exporting them from `src/index.ts`:

```ts
/** @internal */
export interface MapLibreServiceHost {
  getCanvasContainer(): HTMLElement;
  getCRS(): string;
  reproject(crs: string): Promise<void>;
  getCenter(): [number, number];
  getZoom(): number;
  on(type: 'move' | 'resize' | 'crschange', listener: () => void): unknown;
  off(type: 'move' | 'resize' | 'crschange', listener: () => void): unknown;
}

/** @internal */
export type MapLibreModuleLoader = () => Promise<typeof import('maplibre-gl')>;

/** @internal */
export function createMapLibreServiceManager(
  host: MapLibreServiceHost,
  options: MapLibreIntegrationOptions = {},
  loadMapLibre: MapLibreModuleLoader = () => import('maplibre-gl'),
): MapLibreServiceManagerImpl;
```

`MapLibreServiceManagerImpl` extends `EventDispatcher`, mirrors the typed `on/off/once` overload pattern used by `Emap`, and keeps registry order in `Map<string, ServiceRecord>`. Override `fire()` only to normalize the base dispatcher's `{ error }` fallback into `{ phase: 'lifecycle', fatal: false, error }`; do not alter `EventDispatcher`.

- [ ] **Step 5: Implement pure validation and inactive CRUD**

Use small local helpers with these responsibilities:

```ts
interface ServiceRecord {
  definition: MapLibreService;
  state: MapLibreServiceState;
  definitionRevision: number;
  operationRevision: number;
}

function cloneService(service: MapLibreService): MapLibreService;
function validateServiceId(id: string): void;
function validateOverlayDefinition(
  service: MapLibreOverlayService,
  registry: ReadonlyMap<string, ServiceRecord>,
  replacingId?: string,
): void;
function toError(value: unknown): Error;
function abortError(message: string): DOMException;
```

Validation must run before any registry mutation. The constructor uses a synchronous private registration helper for all configured services, then validates `defaultBasemap`; it must not call the async public `addService()` and accidentally turn construction errors into rejected promises. `addService()` installs active intent immediately for `visible: true` overlays but leaves status `idle` until runtime work begins. Allocate `definitionRevision` from one manager-wide monotonic counter on every add/update, so remove/re-add of the same id cannot reuse a recovery identity. `updateService()` preserves the existing `Map` position by replacing its value without delete/re-add and increments both revisions. Visibility/removal operations increment `operationRevision`. A transactional rollback restores the retained old definition revision but advances `operationRevision` again to invalidate replacement work. `removeService()` emits `state: undefined` after deletion.

For layer validation, inspect `source` only when the property exists. Accept `type: 'background'` without it. Reject a missing source for every native layer type that requires one, and reject cross-service source references.

- [ ] **Step 6: Verify GREEN**

```bash
rtk pnpm exec vitest run src/map/maplibre-service-manager.test.ts --reporter=dot
rtk pnpm run typecheck
```

- [ ] **Step 7: Review and commit the registry contract**

Run GitNexus `detect_changes({ scope: "working" })` and confirm only the new service/manager/test symbols appear.

```bash
rtk git diff --check
rtk git add src/map/maplibre-service.ts src/map/maplibre-service-manager.ts src/map/maplibre-service-manager.test.ts
rtk git commit -m "feat: define MapLibre service registry"
```

## Task 2: Lazily Render Multiple Overlay Services

**Files:**

- Modify: `src/map/maplibre-service-manager.ts`
- Modify: `src/map/maplibre-service-manager.test.ts`

**Interfaces:**

- Consumes: active overlay intent, `MapLibreServiceHost`, and injected `MapLibreModuleLoader`.
- Produces: one hidden/visible MapLibre container, one map, blank-style startup, overlay source/layer installation, camera sync, and deterministic destroy.

- [ ] **Step 1: Run impact before extending manager methods**

Run upstream impact for `MapLibreServiceManagerImpl`, `addService`, `removeService`, and `setOverlayVisibility`. Expected risk is local because these are new symbols. Report unexpected cross-feature callers before continuing.

- [ ] **Step 2: Add a controllable MapLibre test double**

Inside the test file, define `FakeMap` with observable `options`, `sources`, `layers`, `removed`, every resource snapshot seen by `setStyle`, and event listeners. It must implement only:

```ts
on(type: string, listener: (event?: unknown) => void): this;
off(type: string, listener: (event?: unknown) => void): this;
emit(type: string, event?: unknown): void;
setStyle(style: string | maplibregl.StyleSpecification | null): void;
addSource(id: string, source: maplibregl.SourceSpecification): void;
getSource(id: string): unknown;
removeSource(id: string): void;
addLayer(layer: maplibregl.LayerSpecification, beforeId?: string): void;
getLayer(id: string): unknown;
removeLayer(id: string): void;
jumpTo(options: { center: [number, number]; zoom: number }): void;
resize(): void;
remove(): void;
```

Inject `async () => ({ Map: FakeMap })` through the existing loader seam. Give the fake a `rebuildOnSetStyle` switch so later tests can simulate both a full rebuild and a diff-preserving style change and prove that manager-owned overlays were already detached in either case.

- [ ] **Step 3: Add failing lazy-host and teardown tests**

Cover these contracts:

1. First visible overlay awaits `host.reproject('webmercator')` when CRS is neither `webmercator` nor `epsg:3857`.
2. The container is inserted before Emap's first canvas child and has both `.emap-maplibre` and the legacy `.emap-basemap` class, absolute fill, `z-index: 0`, and `pointer-events: none`.
3. Constructor options merge compatibility defaults with allowed `mapOptions`, but owned `container/style/center/zoom/interactive` win at runtime.
4. Overlay-only startup uses `{ version: 8, sources: {}, layers: [] }`.
5. `move` calls `jumpTo({ center, zoom })`; `resize` calls `resize()`; both listeners attach once.
6. A later `crschange` away from Web Mercator hides/suspends the container without clearing active service intent; returning to Web Mercator reveals, resizes, and resyncs it. While suspended, same-value calls are no-ops, hide/remove and already-active updates can mutate the hidden runtime and settle without reprojection, and only an inactive-to-active transition calls `_ensureWebMercator()` to resume and reveal explicitly.
7. `getMapLibreMap()` is `null` before initialization and returns the fake afterwards.
8. `destroy()` is idempotent, rejects pending style readiness with `AbortError`, detaches host/map listeners, calls `map.remove()`, removes the container, and clears the raw getter.

- [ ] **Step 4: Verify RED**

```bash
rtk pnpm exec vitest run src/map/maplibre-service-manager.test.ts --reporter=dot
```

Expected: registry tests pass; lazy-host tests fail because no MapLibre host exists yet.

- [ ] **Step 5: Implement lazy host creation and blank-style readiness**

Add named constants and keep all DOM creation out of controls:

```ts
const EMPTY_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
};

const MAP_DEFAULTS = {
  attributionControl: false,
  maxPitch: 0,
  renderWorldCopies: true,
} as const;
```

Implement `_ensureWebMercator()`, `_ensureMap(initialStyle)`, `_handleCrsChange()`, `_syncCamera()`, `_syncVisibility()`, and `destroy()`. The `new Map` options order must be:

```ts
{
  ...MAP_DEFAULTS,
  ...this._options.mapOptions,
  container,
  style: initialStyle,
  center: this._host.getCenter(),
  zoom: this._host.getZoom(),
  interactive: false,
}
```

- [ ] **Step 6: Verify the lazy host is GREEN**

```bash
rtk pnpm exec vitest run src/map/maplibre-service-manager.test.ts --reporter=dot
```

- [ ] **Step 7: Add failing overlay application tests**

Now add the second behavior slice:

1. `setOverlayVisibility(id, true)` waits for the initial `style.load`, then adds sources before layers and preserves service/layer registration order.
2. `addService({ ...overlay, visible: true })` applies that overlay immediately and resolves only after it is ready; adding an inactive service remains registry-only.
3. Two overlays can be ready simultaneously.
4. Hiding or removing an active overlay removes its layers in reverse order and then its sources, verifies every removal postcondition, and never touches its sibling.
5. Hiding the final overlay with no basemap hides the container but keeps the map reusable.
6. No-op visibility calls neither import MapLibre nor emit duplicate changes.
7. `show -> hide`, `add visible -> remove`, `update -> remove`, and `show -> hide -> show` during import/reprojection/initial style readiness abort stale promises and leave only the latest intent/resources/state.
8. Hiding then showing an earlier-registered overlay, and actively updating it, restores its layers before the first visible layer of every later-registered overlay.

- [ ] **Step 8: Verify the overlay slice is RED**

```bash
rtk pnpm exec vitest run src/map/maplibre-service-manager.test.ts --reporter=dot
```

- [ ] **Step 9: Implement overlay visibility and initial activation**

Implement `_installOverlay()`, `_removeOverlayResources()`, `_reconcileOverlayForGeneration()`, and `_reconcileVisibleOverlays()`. Every async path captures the service record plus `operationRevision`. A public add/show/update path either joins an existing same-service/current-generation reconciliation job or awaits a helper that resolves only when the current desired style is externally stable. The style coordinator instead passes its internally parsed generation directly to `_reconcileOverlayForGeneration()`; that runner must never await external stability or it would deadlock the coordinator that publishes it. Recheck the record, operation revision, desired intent, generation, and absence of a newer style after every `await` and immediately before/after resource mutations. If only the style generation changed, discard current-generation ownership, wait for the newest stable style, and retry the still-current public operation; throw `AbortError` only when the service operation itself was superseded.

Track the exact object handles returned by `getSource(id)` and `getLayer(id)` after installation, not just their ids. Those handles establish ownership only within the current style generation. An existing resource is reusable only when its current handle equals the stored manager-owned handle; a same-id resource introduced by a raw caller is a collision. Task 3 invalidates all handles at each style transition before inspecting the next style, so a base-style resource can never inherit manager ownership through MapLibre diff reuse. MapLibre sometimes reports validation failures through its `error` event instead of throwing, so wrap each add/remove in a scoped mutation context (`serviceId`, `phase`, resource id), capture a synchronous matching error event, and verify the postcondition with `getSource()`/`getLayer()` before changing ownership records. Missing postconditions fail transactionally even when the call returned normally. When adding a layer, find the first already-present desired managed layer that follows it (remaining layers in the same service, then later visible services) and pass that id as `beforeId`. This preserves declared and registration order after hide/show, partial reconciliation, and active updates.

Add internal `initialize(): Promise<void>` for Emap to call later. In this task it activates every overlay whose definition has `visible: true`; with overlays only, it initializes the blank style once and installs all visible overlays in registry order. Task 3 extends the same method to activate `defaultBasemap` through the completed style coordinator.

Public calls update active intent and emit `change` immediately, then transition `idle -> loading -> ready` through `status` events. A no-op visibility call resolves without importing MapLibre or emitting duplicate changes.

- [ ] **Step 10: Verify the complete overlay task is GREEN**

```bash
rtk pnpm exec vitest run src/map/maplibre-service-manager.test.ts --reporter=dot
rtk pnpm run typecheck
```

- [ ] **Step 11: Review and commit overlay rendering**

Run GitNexus `detect_changes({ scope: "working" })` and verify the affected flow is confined to the new manager tests and implementation.

```bash
rtk git diff --check
rtk git add src/map/maplibre-service-manager.ts src/map/maplibre-service-manager.test.ts
rtk git commit -m "feat: render MapLibre overlay services"
```

## Task 3: Coordinate Basemap Styles, Races, Rollback, and Errors

**Files:**

- Modify: `src/map/maplibre-service-manager.ts`
- Modify: `src/map/maplibre-service-manager.test.ts`

**Interfaces:**

- Consumes: `setBasemap`, active-service updates/removals, MapLibre `style.load`/`error` events.
- Produces: mutually exclusive basemaps, overlay restoration, latest-request-wins promises, transactional active updates, and recovery.

- [ ] **Step 1: Run upstream impact**

Run impact for `setBasemap`, `updateService`, `removeService`, `_installOverlay`, and `_reconcileVisibleOverlays`. Report the direct callers and service-state flows.

- [ ] **Step 2: Add failing style-coordinator tests**

Add focused tests for:

1. Selecting a basemap makes every other basemap inactive and sets exactly that style.
2. Switching publishes `basemap` changes for the old service first and new service second; `setBasemap(null)` publishes only the old service, loads blank when overlays remain, and otherwise hides the container.
3. Removing the active basemap selects none and never auto-selects a sibling.
4. Turning off the only basemap before MapLibre exists resolves without importing it; showing an overlay later installs blank style rather than revealing the previously selected hidden style.
5. Immediately before each actual base, blank, or recovery `setStyle()`, all manager-owned overlay layers are removed in reverse visual order and then their sources; the fake's `setStyle` snapshot contains none of them.
6. A matching `style.load` reconciles all visible overlays in registry order, producing the same result when the fake performs a full rebuild or preserves unrelated runtime resources through a style diff.
7. Rapid `light -> dark -> streets` selection rejects the first two promises with `AbortError`, never commits their ready state, and resolves only `streets`.
8. The serialized coordinator starts at most one actual `setStyle()` at a time; when an obsolete in-flight style finishes, it skips reconciliation/commit and immediately starts the latest desired revision.
9. `initialize()` activates a valid configured `defaultBasemap` and all initially visible overlays in one style cycle.
10. Map construction with an initial blank/base style is itself the first in-flight operation: an immediate basemap switch waits for that initial terminal event and cannot misinterpret it as the new style.
11. A style-load event delivered after its request already failed is ignored, and a synchronous `setStyle()` throw follows the same failure/recovery path.
12. With `A` ready, selecting loading `B` and then `C` rejects `B`, immediately leaves `B` in `{ active: false, status: 'idle', error: undefined }`, and includes that state in its inactive `basemap` event; a later physical error from `B` emits no error/status/basemap event and starts or continues `C` without recovery to `A`.
13. Overlay show and active-overlay update started before/during a basemap switch never write resources into the obsolete generation; their still-current promises resolve only after reconciliation on the newest stable style, and each source/layer is added at most once for that generation.
14. After `A -> null` commits, a subsequent failing `B` selection recovers blank rather than reviving `A`; successful blank/no-basemap commit cleared `LastReadyBasemap`.
15. If a new basemap is selected while the current parsed generation is still reconciling a delayed overlay job, that generation never publishes `ReadyStyle` or commits ready state; the job stops at its next guard and the coordinator starts the new desired style.
16. A `change` listener that synchronously calls `setBasemap('C')` from `B`'s active event leaves `C` as the only desired/active target, resets `B` to inactive/idle, rejects `B` with `AbortError`, and never starts or commits `B` after the listener returns.

- [ ] **Step 3: Verify RED**

```bash
rtk pnpm exec vitest run src/map/maplibre-service-manager.test.ts --reporter=dot
```

- [ ] **Step 4: Implement the serialized style revision coordinator**

Use one desired revision and one actual in-flight revision; do not attach multiple indistinguishable `once('style.load')` callbacks:

```ts
interface StyleRequest {
  revision: number;
  basemapId: string | null;
  style: string | maplibregl.StyleSpecification;
  phase: 'initial' | 'switch' | 'recovery';
  resolve: () => void;
  reject: (error: Error) => void;
}

interface ReadyStyle {
  generation: number;
  requestRevision: number;
}

interface LastReadyBasemap {
  id: string;
  definitionRevision: number;
}
```

Required algorithm:

1. `_ensureMap(initialStyle)` registers the map constructor's initial style as an in-flight `initial` request and assigns its style generation before callers may start another style.
2. `setBasemap()` validates first, allocates the new revision/request, captures the previous request, and installs the new request as `_desiredRequest` before any callback can run. In the same synchronous mutation, set the old selected service—ready or loading—to inactive/idle with its error cleared, and set the new selected service active/loading. Reject the captured previous public promise with `AbortError` exactly once.
3. Emit the old inactive and new active snapshot events in order. Immediately after each synchronous `fire()`, compare the local revision/request identity with `_desiredRequest`; if a listener installed a newer request, stop emitting and do not start physical work. Apply this post-`fire()` guard to later status/error emissions as well.
4. Only while the local request is still desired, enter the serialized coordinator. If no style is actually loading, detach every currently owned overlay layer in reverse visual order and then every owned source. Verify removals as in Task 2, invalidate all overlay ownership handles regardless of MapLibre's later diff behavior, recheck the desired request again, call `setStyle()` inside `try/catch`, and record that applied revision. If one is loading—including the constructor's initial style—wait for its terminal event before detaching for the next actual request.
5. On `style.load`, ignore events when no request is awaiting style load. Then compare applied and desired revisions. If different, do not mark any service ready and start the latest request. If equal, mark that generation internally parsed, treat every pre-existing source/layer id as base-owned or unmanaged, and pass the parsed generation directly into the shared serialized per-service reconciliation runner. After every overlay job settles, compare applied and desired revisions again. If they now differ, publish/commit nothing and start the newest request. Only while they still match may the coordinator publish `ReadyStyle`, commit ready states, store the ready basemap as `{ id, definitionRevision }`, or clear `LastReadyBasemap` when the committed request is blank, and resolve all current-generation waiters. Public overlay paths may join those per-service jobs but may not make the internal runner wait on `ReadyStyle`. A no-basemap request that only hides an unused map also clears it when that request commits.
6. On a fatal style error, first mark only the physical applied request terminal and call public `map.setStyle(null)` to detach its failed MapLibre `Style` event parent; do not register this null detach as a style request or wait for a `style.load` from it. If `appliedRevision !== desiredRevision`, emit no manager error/change event, do not mutate any service state or enqueue recovery, and immediately start the newest desired request—the obsolete public promise was already rejected with `AbortError`.
7. Only when the failed applied revision is still desired, reject its matching public promise, put the failed basemap into `{ active: false, status: 'error', error }`, and emit its fatal `error`, `status`, and inactive `basemap` changes. That state is final when the failed target is a distinct service; an active-basemap update may later replace it only by restoring the retained old definition under the same id.
8. Recovery is a normal serialized style request. Resolve `LastReadyBasemap` only if the registry still contains that id with the same `definitionRevision`; otherwise recover blank. Restoring a valid record emits its active `basemap` change, transitions it through `loading` to `ready`, and then restores overlays. Blank recovery leaves every basemap inactive. In either case the original failed public promise remains rejected.

This makes “matching style.load” testable even though MapLibre's event carries no request id.

- [ ] **Step 5: Verify the style coordinator is GREEN**

```bash
rtk pnpm exec vitest run src/map/maplibre-service-manager.test.ts --reporter=dot
```

- [ ] **Step 6: Add failing mutation, recovery, and error tests**

Add the second behavior slice:

1. Hiding/removing/updating an overlay while a style is loading is honored by the eventual reconciliation.
2. Active overlay update removes old resources, installs the new definition, preserves its registry position, and preserves active state regardless of the replacement `visible` hint.
3. An overlay `addSource`/`addLayer` throw, or a synchronous MapLibre error event followed by a missing `getSource`/`getLayer` postcondition, rolls back only that attempt and restores the previous ready definition on update.
4. Before a basemap switch, the old managed overlay resources are absent from the fake's `setStyle` snapshot. If the newly loaded base style or an unmanaged raw resource supplies one of those ids, overlay reconciliation reports a transactional source/layer collision without corrupting a sibling overlay, in both full-rebuild and diff-preserving simulations.
5. Updating the active basemap follows the same style coordinator while retaining the old cloned definition until commit. If the replacement fails, the same service id emits the failure transition, restores its old definition, and then transitions back through active/loading to final ready; the update promise remains rejected.
6. A style failure while selecting a different service emits the failed target's fatal error, final `status`, and inactive `basemap` changes; restoring the last ready basemap then emits its active `basemap`, `loading`, and `ready` changes in order. Without a valid previous base, blank recovery leaves every basemap inactive and emits no synthetic blank-service change. For an active-basemap update, the same id emits the failure transition and then the restored old definition's active/loading/ready transition, so its final state is ready. The failed caller remains rejected in every case.
7. If last-ready `A` is removed while `B` loads and `B` fails, recovery uses blank and never resurrects `A`. If inactive `A` is updated to a new definition revision, or is removed and re-added with the same id, while `B` loads and `B` fails, recovery also uses blank and never loads the unproven replacement.
8. An active-overlay update failure emits its fatal error and rejected promise. Successful restoration of the old definition emits a compensating `update` plus loading/ready status and ends active/ready; failed restoration alone ends in error.
9. A fake event containing `tile` emits `{ phase: 'tile', fatal: false }` without changing service status; a non-tile `sourceId` owned by an overlay emits fatal `source` and marks that overlay errored; post-load sprite/glyph-like errors are non-fatal lifecycle events.
10. Fatal style/source/layer failures retain their original `Error` and set `fatal: true`.

- [ ] **Step 7: Verify the failure/recovery slice is RED**

```bash
rtk pnpm exec vitest run src/map/maplibre-service-manager.test.ts --reporter=dot
```

- [ ] **Step 8: Implement transactional active mutations**

For an active overlay update, retain the old cloned record until the new definition is fully installed. On failure:

1. Remove layers/sources added by the failed attempt in reverse dependency order.
2. Emit the fatal failure and error status, restore the old registry definition, and emit a compensating `update` change so controls reread the restored name/definition.
3. Reinstall old resources.
4. Emit loading/ready and finish `{ active: true, status: 'ready' }` if recovery succeeds; otherwise retain active intent with final error status and emit a fatal lifecycle error.

For an active basemap update, retain the old cloned definition while the replacement remains in loading state. On failure, emit the replacement's error/inactive transition, restore the old definition before enqueuing recovery, and let the same service id finish active/ready. Do not preserve the replacement error in the final state after the old definition is ready; the fatal `error` event and rejected promise are the durable failure signal.

- [ ] **Step 9: Classify MapLibre errors and recovery**

One permanent map `error` listener should classify events. An event with a tile object is non-fatal `tile`. Only an error received while the coordinator is specifically awaiting the pre-`style.load` terminal event is fatal `style`; sprite/glyph errors arriving after `style.load` must not retroactively fail the basemap. A non-tile `sourceId` that resolves through the manager's current-style ownership table is fatal `source` for that overlay. Synchronous `setStyle`, `addSource`, and `addLayer` failures are fatal `style`, `source`, and `layer`, respectively. Use `sourceId`, `tile`, scoped mutation context, and coordinator phase when present; unknown post-load runtime errors are non-fatal `lifecycle`. Never reduce these to `console.warn`.

When recovery starts, do not erase a distinct failed target's `error` state. Validate both the id and `definitionRevision` of the last-ready record before using it. If it is valid, set that previous service active/loading and emit its `basemap` change before its loading `status`; on successful `style.load`, emit its ready `status`. The active-update exception above first restores the retained old record/revision, so the same id becomes a valid recovery target and necessarily replaces its temporary error state. When the candidate is missing/revised or blank is otherwise the target, only overlay status changes follow. These events are the sole UI source of truth; controls never infer recovery from rejected promises.

- [ ] **Step 10: Verify GREEN and leak-free async completion**

```bash
rtk pnpm exec vitest run src/map/maplibre-service-manager.test.ts --reporter=dot
rtk pnpm run typecheck
```

Expected: no unhandled rejections after each test; all fake listeners are empty after `destroy()`.

- [ ] **Step 11: Review and commit style coordination**

Run GitNexus `detect_changes({ scope: "working" })`; confirm only expected manager state/lifecycle flows changed.

```bash
rtk git diff --check
rtk git add src/map/maplibre-service-manager.ts src/map/maplibre-service-manager.test.ts
rtk git commit -m "feat: coordinate MapLibre basemap styles"
```

## Task 4: Attach the Shared Manager to Emap and Export Its Types

**Files:**

- Modify: `src/map/types.ts:31-117`
- Modify: `src/map/map.ts:149-2416`
- Create: `src/map/maplibre-service.test-d.ts`
- Create: `src/map/maplibre-emap-integration.test.ts`
- Modify: `src/index.ts`
- Modify: `src/index.test.ts`

**Interfaces:**

- Consumes: `createMapLibreServiceManager`, `MapLibreIntegrationOptions`, `MapLibreServiceManager`.
- Produces: `MapOptions.mapLibre`, stable `Emap.mapLibreServices`, constructor-time configured activation, and sole-owner teardown.

- [ ] **Step 1: Run and report high-risk impacts before editing**

Run GitNexus upstream impact for:

```text
MapOptions
Emap
Emap.constructor
Emap.remove
```

Expected: `MapOptions` CRITICAL and `Emap` HIGH. Report the callers/processes and the planned containment (one optional field, one private owner, one getter, one teardown call) before editing. Do not modify `EventDispatcher`.

- [ ] **Step 2: Add failing public type assertions**

In `src/map/maplibre-service.test-d.ts`, import from `../index` and assert:

```ts
import type * as maplibregl from 'maplibre-gl';
import type {
  MapLibreBasemapService,
  MapLibreIntegrationOptions,
  MapLibreOverlayService,
  MapLibreServiceManager,
  MapOptions,
} from '../index';
import type { Emap } from './map';

declare const style: maplibregl.StyleSpecification;
declare const source: maplibregl.SourceSpecification;
declare const layer: maplibregl.LayerSpecification;
declare const map: Emap;

const basemap = { id: 'base', name: 'Base', role: 'basemap', style } satisfies MapLibreBasemapService;
const overlay = {
  id: 'overlay',
  name: 'Overlay',
  role: 'overlay',
  sources: { source },
  layers: [layer],
} satisfies MapLibreOverlayService;
const integration = {
  services: [basemap, overlay],
  mapOptions: { transformRequest: (url: string) => ({ url }) },
} satisfies MapLibreIntegrationOptions;
const options = { container: document.body, mapLibre: integration } satisfies MapOptions;
const manager: MapLibreServiceManager = map.mapLibreServices;
const raw: maplibregl.Map | null = manager.getMapLibreMap();
manager.on('change', (event) => {
  const id: string = event.serviceId;
  const reason: 'add' | 'update' | 'remove' | 'basemap' | 'visibility' | 'status' =
    event.reason;
  void id;
  void reason;
});
manager.on('error', (event) => {
  const phase: 'style' | 'source' | 'layer' | 'tile' | 'lifecycle' = event.phase;
  const fatal: boolean = event.fatal;
  void phase;
  void fatal;
});
void options;
void raw;
```

Add one `@ts-expect-error` assignment for each forbidden `mapOptions` key: `container`, `style`, `center`, `zoom`, and `interactive`, plus negative event assertions for an invalid change reason/error phase. Also retain a legacy `{ container, interactive: false } satisfies MapOptions` assertion.

- [ ] **Step 3: Add failing Emap ownership tests**

Use the existing real-Emap jsdom pattern (`HTMLCanvasElement.prototype.getContext` stub plus a detached container). Assert:

1. No `mapLibre` option creates no manager until the getter is read.
2. Repeated getter reads return the same object.
3. An inactive configured service is registered without importing MapLibre.
4. Invalid `defaultBasemap` throws during `new Emap(...)` before async work.
5. Configured `visible: true` overlays/default basemap call the internal `initialize()` exactly once.
6. `Emap.remove()` removes controls first and destroys the manager exactly once even when called twice.

- [ ] **Step 4: Verify RED**

```bash
rtk pnpm run typecheck
rtk pnpm exec vitest run src/map/maplibre-emap-integration.test.ts src/index.test.ts --reporter=dot
```

- [ ] **Step 5: Add the option, owner, getter, and initialization**

In `src/map/types.ts`, type-import `MapLibreIntegrationOptions` and add:

```ts
/** Native MapLibre basemap and online-overlay integration. */
mapLibre?: MapLibreIntegrationOptions;
```

In `Emap`, add private option/owner fields. If `options.mapLibre` exists, construct the manager after the canvas and event infrastructure are ready, then call its internal `initialize()` once at the end of the constructor. If no option exists, construct on first getter read with an empty registry.

```ts
public get mapLibreServices(): MapLibreServiceManager {
  return (this._mapLibreServices ??= createMapLibreServiceManager(
    this,
    this._mapLibreOptions,
  ));
}
```

Catch `initialize()` only to prevent an unhandled promise; the manager must already have emitted its typed error/state event. Do not duplicate logging in `Emap`.

- [ ] **Step 6: Make Emap the sole teardown owner**

In `remove()`, keep the existing control-removal loop first so controls can unsubscribe from a live manager. Immediately after clearing controls/control containers, call `this._mapLibreServices?.destroy()` and clear the private reference. MapLibre/container destruction must still happen before Emap removes `_canvasContainer`.

- [ ] **Step 7: Export only the intended public surface**

From `src/index.ts`, type-export `MapLibreService`, `MapLibreBasemapService`, `MapLibreOverlayService`, `MapLibreIntegrationOptions`, `MapLibreServiceState`, `MapLibreServiceChangeReason`, `MapLibreServiceChangeEvent`, `MapLibreServiceErrorEvent`, `MapLibreServiceEventMap`, and `MapLibreServiceManager` from `./map/maplibre-service`. Do not export `MapLibreServiceManagerImpl`, `MapLibreServiceHost`, the loader, or the factory. Keep existing `BasemapControl` exports unchanged. In `src/index.test.ts`, assert `BasemapControl` remains a runtime export; the manager is type-only and therefore should not create a runtime export assertion.

- [ ] **Step 8: Verify GREEN**

```bash
rtk pnpm run typecheck
rtk pnpm exec vitest run src/map/maplibre-emap-integration.test.ts src/index.test.ts --reporter=dot
rtk pnpm run build
```

- [ ] **Step 9: Review and commit Emap integration**

Run GitNexus `detect_changes({ scope: "working" })`; verify the high-risk blast radius is limited to the intended `MapOptions -> Emap construction -> remove` lifecycle and new public exports.

```bash
rtk git diff --check
rtk git add src/map/types.ts src/map/map.ts src/map/maplibre-service.test-d.ts src/map/maplibre-emap-integration.test.ts src/index.ts src/index.test.ts
rtk git commit -m "feat: attach MapLibre services to Emap"
```

## Task 5: Expose Effective Emap Layers and Typed Layer Changes

**Files:**

- Modify: `src/map/map.ts:1187-1466`
- Modify: `src/map/map.test.ts`
- Modify: `src/core/event-map.ts`
- Modify: `src/core/event-map.test-d.ts`
- Modify: `src/core/event-map.test.ts`
- Modify: `src/index.ts`

**Interfaces:**

- Produces: `getRenderedLayers()` and `layerchange` events consumed by `LayerControl`.
- Preserves: `getLayers()` explicit-only semantics and `_getEffectiveLayers()` render/query behavior.

- [ ] **Step 1: Run upstream impact and protect the render/query path**

Run impact for `_getEffectiveLayers`, `addLayer`, `removeLayer`, `setLayerVisibility`, `moveLayer`, `_handleSourceData`, and `removeSource`. Record that `_getEffectiveLayers` feeds rendering, visible-layer indexing, and feature queries even if GitNexus labels it LOW.

- [ ] **Step 2: Add failing layer behavior tests**

Extend the existing bare-map layer block in `src/map/map.test.ts` to assert:

1. `getRenderedLayers()` returns deep clones for explicit layers.
2. With no explicit layers, it returns generated defaults while `getLayers()` remains empty.
3. Mutating a returned rendered layer never mutates internal cache/rendering state.
4. Hiding one generated default materializes the complete current generated list, changes only the target, and makes `getLayers()` contain the full list.
5. Unknown ids and same-value visibility calls are no-ops: no materialization, render, or event.
6. `addLayer`, `removeLayer`, and a real visibility change each emit exactly one snapshot with the expected reason/id.
7. Source load/removal in generated-default mode emits one `effective` event after the source state is committed only when the before/after rendered-layer snapshots differ; unrelated source data emits none.
8. Source removal in explicit mode emits `effective` only if it removed rendered explicit layers.
9. `moveLayer()` emits `effective` so an open layer panel observes API-driven ordering changes.

Add type assertions:

```ts
map.on('layerchange', (event) => {
  const reason: 'add' | 'remove' | 'visibility' | 'effective' = event.reason;
  const layerId: string | undefined = event.layerId;
  const layers: readonly LayerSpecification[] = event.layers;
  void reason;
  void layerId;
  void layers;
});
```

Add an `@ts-expect-error` for an invalid reason. Add one real-Emap runtime test proving the keyed event listener receives the same cloned snapshot.

- [ ] **Step 3: Verify RED**

```bash
rtk pnpm exec vitest run src/map/map.test.ts src/core/event-map.test.ts --reporter=dot
rtk pnpm run typecheck
```

- [ ] **Step 4: Add the event type and snapshot helper**

In `src/core/event-map.ts`, export:

```ts
export type LayerChangeReason = 'add' | 'remove' | 'visibility' | 'effective';

export interface LayerChangeEvent {
  reason: LayerChangeReason;
  layerId?: string;
  layers: readonly LayerSpecification[];
}
```

Add `layerchange: LayerChangeEvent` to `EmapEventMap`. Type-import `LayerSpecification` to avoid a runtime cycle.

Export `LayerChangeReason` and `LayerChangeEvent` with the existing `EmapEventMap`/`CameraEvent` type exports in `src/index.ts`.

In `Emap`, add:

```ts
public getRenderedLayers(): readonly LayerSpecification[] {
  return this._getEffectiveLayers().map(cloneLayerSpecification);
}

private _fireLayerChange(reason: LayerChangeReason, layerId?: string): void {
  this.fire('layerchange', { reason, layerId, layers: this.getRenderedLayers() });
}
```

- [ ] **Step 5: Materialize generated defaults only on a real toggle**

When `_layers` is empty, locate the requested id in `_getEffectiveLayers()`. Return for unknown/same visibility. Otherwise clone the complete effective list into `_layers`, mutate the matching clone, schedule one render, and fire one `visibility` event. Explicit-layer toggles retain the same no-op rules.

Fire `add`, `remove`, or `effective` only after the corresponding mutation has committed. For source load/removal, compare stable layer identity/order/visibility fields from cloned before/after rendered snapshots and emit `effective` only when the user-visible list changed. Never expose `_effectiveLayersCache` directly.

- [ ] **Step 6: Verify GREEN**

```bash
rtk pnpm exec vitest run src/map/map.test.ts src/core/event-map.test.ts --reporter=dot
rtk pnpm run typecheck
```

- [ ] **Step 7: Review and commit layer presentation state**

Run GitNexus `detect_changes({ scope: "working" })` and verify the render/query consumers remain unchanged while their input state gains only the intended materialization/event behavior.

```bash
rtk git diff --check
rtk git add src/map/map.ts src/map/map.test.ts src/core/event-map.ts src/core/event-map.test-d.ts src/core/event-map.test.ts src/index.ts
rtk git commit -m "feat: expose effective Emap layer changes"
```

## Task 6: Migrate BasemapControl to the Shared Manager

**Files:**

- Modify: `src/ui/basemap-control.ts:1-259`
- Create: `src/ui/basemap-control.test.ts`

**Interfaces:**

- Consumes: `Emap.mapLibreServices`, manager change/error events, and legacy `BasemapOptions`.
- Produces: accessible basemap-only selection UI and legacy normalization without MapLibre ownership.

- [ ] **Step 1: Run impact and report the compatibility surface**

Run upstream impact for `BasemapControl`, `BasemapStyle`, `BasemapOptions`, `onAdd`, `onRemove`, and `isOn`. Expected direct consumers include `src/index.ts` and shared example runtime. Confirm no hidden caller depends on the old one-button-per-style DOM.

- [ ] **Step 2: Add failing legacy and UI tests**

Create a jsdom fake manager that implements the public interface with a tiny listener registry. Add tests for:

1. Empty registry plus `new BasemapControl()` registers the existing OSM/Carto Light/Carto Dark defaults exactly once.
2. Legacy ids are deterministic (`emap-legacy-basemap-0`, `-1`, ...).
3. Raster legacy input becomes a version-8 raster style with `tileSize: 512`, layer minzoom `0`, maxzoom `22`; non-raster URL remains a style URL.
4. `{ defaultStyle: 'CartoDB Dark' }` selects the first matching legacy name after registration.
5. Explicit legacy options (`styles` or `defaultStyle`) plus a non-empty map-level registry reject as a configuration conflict. `{ defaultStyle }` without `styles` uses the built-in legacy style list only when the registry is empty.
6. No legacy options plus a non-empty registry is a pure view and adds no services.
7. Only basemaps and the leading no-basemap choice render; overlays never appear.
8. Radio changes call `setBasemap(id)` or `setBasemap(null)` exactly once.
9. `isOn()` derives from active basemap states and ignores active overlays.
10. Manager `change`/`error` events rerender selection/loading/error without calling manager mutations again.
11. Trigger/panel expose `aria-haspopup`, `aria-expanded`, `aria-controls`, `radiogroup`, `aria-busy`, and a polite live status.
12. Arrow keys/Home/End move and select radios; Escape closes and returns focus; outside `mousedown` closes.
13. `onRemove()` detaches document and manager listeners/DOM but does not call remove/hide/destroy service methods.

- [ ] **Step 3: Verify RED**

```bash
rtk pnpm exec vitest run src/ui/basemap-control.test.ts --reporter=dot
```

- [ ] **Step 4: Move legacy conversion into a narrow adapter**

Retain public interfaces and the three default URLs. Replace the old MapLibre fields and methods with:

```ts
const MAPLIBRE_TILE_SIZE = 512;
const LEGACY_ID_PREFIX = 'emap-legacy-basemap-';

function toLegacyBasemapService(style: BasemapStyle, index: number): MapLibreBasemapService;
function isAbortError(error: unknown): boolean;
```

`toLegacyBasemapService()` must reproduce current raster-vs-style-URL behavior. Delete `_basemapContainer`, `_maplibre`, `_maplibreMap`, `_loadMapLibre`, `_initMapLibre`, `_syncBasemap`, `_setStyle`, `_turnOff`, and all control-owned camera/container teardown.

- [ ] **Step 5: Build the manager-driven accessible panel**

Use root class `emap-ctrl emap-panel-control emap-basemap-ctrl`. The trigger is a native button; the popup uses `hidden`, a uniquely named radio group, a first “No basemap” radio, and `role="status" aria-live="polite" aria-atomic="true"`.

On every manager event, reread `getServices()` and `getServiceState()`; never mirror registry/active state in a second model. Keep the radio group enabled while loading so rapid switches remain possible. Promise catches ignore only `AbortError`; manager state/error events drive visible status.

- [ ] **Step 6: Verify GREEN and shared-runtime compatibility**

```bash
rtk pnpm exec vitest run src/ui/basemap-control.test.ts test/docs/example-runtime.test.ts --reporter=dot
rtk pnpm run typecheck
```

- [ ] **Step 7: Review and commit the migration**

Run GitNexus `detect_changes({ scope: "working" })`; verify MapLibre construction/camera/teardown moved out of the control and no example runtime flow was lost.

```bash
rtk git diff --check
rtk git add src/ui/basemap-control.ts src/ui/basemap-control.test.ts
rtk git commit -m "feat: migrate basemap control to shared services"
```

## Task 7: Add the Unified LayerControl and Shared Panel Styling

**Files:**

- Create: `src/ui/layer-control.ts`
- Create: `src/ui/layer-control.test.ts`
- Modify: `src/ui/controls.css:1-130`
- Modify: `src/index.ts`
- Modify: `src/index.test.ts`

**Interfaces:**

- Consumes: `Emap.getRenderedLayers`, `Emap.layerchange`, manager service/state/change/error APIs.
- Produces: one user-facing layer panel with fixed business/online groups and a public runtime export.

- [ ] **Step 1: Run impact before editing shared styling/exports**

Run upstream impact for `Emap.getRenderedLayers`, `Emap.setLayerVisibility`, `MapLibreServiceManager.setOverlayVisibility`, and the root control export block. `LayerControl` itself is new. Inspect the `.emap-ctrl-group` styling but do not change navigation control behavior.

- [ ] **Step 2: Add failing LayerControl tests**

Use a jsdom fake Emap and fake manager with separate event listener registries. Assert:

1. Generated business layers render even when `getLayers()` would be empty.
2. `.emap-layer-group--business` is first and `.emap-layer-group--online` is second.
3. Business rows preserve `getRenderedLayers()` order; overlay rows preserve service registration order; basemaps never appear.
4. Business checkboxes call `setLayerVisibility(id, 'visible' | 'none')`.
5. Online checkboxes call `setOverlayVisibility(id, boolean)`.
6. `layerchange` and manager `change` rerender API-driven state without invoking either mutation API.
7. Dynamic add/remove and loading/error states update the panel and live status.
8. Trigger/panel/group labels, checkbox labels, focus-on-open, Escape/outside close, and `aria-expanded` are correct.
9. `onRemove()` detaches both event sources and document listeners, removes DOM, and leaves business/service state untouched.

- [ ] **Step 3: Verify RED**

```bash
rtk pnpm exec vitest run src/ui/layer-control.test.ts src/index.test.ts --reporter=dot
```

- [ ] **Step 4: Implement the fixed two-group control**

`LayerControl implements Control` and has no ordering or opacity options. On `onAdd`, subscribe to `map.layerchange` and manager `change/error`; on `onRemove`, symmetrically unsubscribe using the exact bound function identities.

Derive checked state as:

```ts
const businessVisible = layer.layout?.visibility !== 'none';
const overlayVisible = manager.getServiceState(service.id)?.active === true;
```

Use native checkboxes and labels. Async overlay calls catch `AbortError` only; all other errors are already represented by manager events.

- [ ] **Step 5: Add shared panel CSS without a new JS abstraction**

Add shared classes `.emap-panel-control`, `.emap-panel-trigger`, `.emap-control-panel`, `.emap-control-group`, `.emap-control-row`, and `.emap-control-status`, plus `.emap-layer-*`/updated `.emap-basemap-*` selectors. Requirements:

- control root is `position: relative` and `overflow: visible`;
- panel is absolute, uses existing surface/accent/font tokens, has a bounded scrollable height, and aligns inward for right/bottom control corners;
- rows for business layers and overlays share dimensions and checkbox alignment;
- loading/error use visible text plus `aria` state, not color alone;
- retain `.emap-basemap-ctrl` and `.emap-basemap` compatibility selectors;
- include the minimal managed-map layout rules `.emap-maplibre.maplibregl-map { overflow: hidden; }` and `.emap-maplibre .maplibregl-canvas { position: absolute; left: 0; top: 0; }`, so the non-interactive managed canvas works with Emap's stylesheet alone;
- do not modify `.emap-ctrl-group` navigation sizing/overflow.

- [ ] **Step 6: Export and verify**

Export `LayerControl` from `src/index.ts` and assert it is a runtime constructor in `src/index.test.ts`.

```bash
rtk pnpm exec vitest run src/ui/basemap-control.test.ts src/ui/layer-control.test.ts src/index.test.ts --reporter=dot
rtk pnpm run typecheck
rtk pnpm run format:check
```

- [ ] **Step 7: Review and commit LayerControl**

Run GitNexus `detect_changes({ scope: "working" })`; confirm the only new UI flow is `layerchange/manager change -> rerender` and checkbox input -> the correct visibility API.

```bash
rtk git diff --check
rtk git add src/ui/layer-control.ts src/ui/layer-control.test.ts src/ui/controls.css src/index.ts src/index.test.ts
rtk git commit -m "feat: add unified layer control"
```

## Task 8: Add the Canonical Online Map Services Example

**Files:**

- Create: `packages/examples/examples/online-map-services/index.html`
- Modify: `docs-meta/examples.ts`
- Modify: `packages/examples/vite.config.ts`
- Modify: `test/docs/example-catalog.test.ts`

**Interfaces:**

- Demonstrates: construction-time registry, two mutually exclusive basemaps, two simultaneous overlays, shared `BasemapControl`, new `LayerControl`, and one Emap business layer.

- [ ] **Step 1: Run impact for the example catalog**

Run upstream impact for `exampleDescriptions`, the example `recipe` registry, and Vite `routeIds`. Confirm the existing catalog/build/check scripts are the only consumers.

- [ ] **Step 2: Add failing catalog assertions**

Add `online-map-services` to the expected ids and assert its HTML contains:

- `mapLibre` with at least two `role: 'basemap'` and two `role: 'overlay'` definitions;
- `defaultBasemap`;
- two overlays with `visible: true`;
- a WMS `{bbox-epsg-3857}` template;
- `new emap.LayerControl()`;
- `installExampleMapUi(map, emap)` so the shared runtime supplies `BasemapControl`;
- one Emap `addLayer()` call and the standard `#file-input` fixture path.

```bash
rtk pnpm exec vitest run test/docs/example-catalog.test.ts --reporter=dot
```

Expected: missing example id/page/route assertions fail.

- [ ] **Step 3: Register the route and metadata**

Add `online-map-services` to `packages/examples/vite.config.ts`. In `docs-meta/examples.ts`, use category `platform`, docs `[docsControls]`, primary API `MapLibreServiceManager`, flags `['maplibre', 'basemap', 'overlay', 'controls']`, and the existing `task6Fixture`.

- [ ] **Step 4: Build the runnable page**

Use native MapLibre definitions. The service block must demonstrate this shape (provider URLs may be adjusted only if manual validation proves one unavailable):

```js
const services = [
  {
    id: 'osm',
    name: 'OpenStreetMap',
    role: 'basemap',
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
        },
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    },
  },
  {
    id: 'carto-light',
    name: 'Carto Light',
    role: 'basemap',
    style: {
      version: 8,
      sources: {
        carto: {
          type: 'raster',
          tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
          tileSize: 256,
        },
      },
      layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
    },
  },
  {
    id: 'states-wms',
    name: 'WMS states',
    role: 'overlay',
    visible: true,
    sources: {
      'states-wms': {
        type: 'raster',
        tiles: [
          'https://ahocevar.com/geoserver/wms?service=WMS&request=GetMap&layers=topp:states&styles=&format=image/png&transparent=true&version=1.1.1&srs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256',
        ],
        tileSize: 256,
      },
    },
    layers: [
      {
        id: 'states-wms-layer',
        type: 'raster',
        source: 'states-wms',
        paint: { 'raster-opacity': 0.45 },
      },
    ],
  },
  {
    id: 'usgs-imagery',
    name: 'USGS imagery',
    role: 'overlay',
    visible: true,
    sources: {
      'usgs-imagery': {
        type: 'raster',
        tiles: [
          'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
      },
    },
    layers: [
      {
        id: 'usgs-imagery-layer',
        type: 'raster',
        source: 'usgs-imagery',
        paint: { 'raster-opacity': 0.3 },
      },
    ],
  },
];
```

Construct `Emap` with `{ mapLibre: { services, defaultBasemap: 'osm' } }`, install shared UI once, add one `LayerControl`, and load the existing task-6 polygon fixture as an explicit Emap layer. Do not add a second `BasemapControl` in the page.

- [ ] **Step 5: Verify example contracts without network**

```bash
rtk pnpm exec vitest run test/docs/example-catalog.test.ts test/docs/example-runtime.test.ts test/docs/examples-build.test.ts --reporter=dot
rtk pnpm run examples:build
rtk pnpm run examples:check
```

- [ ] **Step 6: Review and commit the example**

Run GitNexus `detect_changes({ scope: "working" })` and confirm only catalog/example build flows changed.

```bash
rtk git diff --check
rtk git add packages/examples/examples/online-map-services/index.html docs-meta/examples.ts packages/examples/vite.config.ts test/docs/example-catalog.test.ts
rtk git commit -m "docs: add online map services example"
```

## Task 9: Document Native MapLibre Service Configuration

**Files:**

- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `packages/docs/docs/guides/controls.md`
- Modify: `packages/docs/i18n/en/docusaurus-plugin-content-docs/current/guides/controls.md`
- Generate: `packages/docs/static/api/**`

**Interfaces:**

- Documents: construction and runtime APIs, protocol templates, control responsibilities, Web Mercator behavior, error state, and raw-map caveat.

- [ ] **Step 1: Update README control tables and concise examples**

Change “MapLibre raster basemap toggle” to describe the basemap selector, add `LayerControl`, and include one concise `mapLibre.services` construction snippet in both languages. State explicitly that the MapLibre canvas is below all Emap layers and that only one basemap can be active.

- [ ] **Step 2: Synchronize guide metadata first**

The Chinese and English control-guide frontmatter must have identical `api` and `examples` arrays. Add:

```text
MapOptions
MapLibreService
MapLibreBasemapService
MapLibreOverlayService
MapLibreIntegrationOptions
MapLibreServiceState
MapLibreServiceManager
MapLibreServiceEventMap
MapLibreServiceChangeReason
MapLibreServiceChangeEvent
MapLibreServiceErrorEvent
LayerControl
LayerChangeReason
LayerChangeEvent
online-map-services
```

Set `verifiedVersion` to the current package version (`0.6.0` at plan creation) only if `package.json` still reports that version during implementation.

- [ ] **Step 3: Document each native MapLibre pattern**

Both guides must include compact, copyable examples for:

1. XYZ raster `tiles`.
2. TMS via `scheme: 'tms'`.
3. WMS with `{bbox-epsg-3857}`.
4. WMTS as a native tile URL template.
5. TileJSON via a source `url`.
6. Full MapLibre style URL and JSON basemaps.
7. `mapOptions.transformRequest` for provider tokens/headers/rewrites.
8. Runtime add/update/remove/show/hide and `setBasemap(null)`.
9. `getMapLibreMap()` with the warning that direct resources are unmanaged and may disappear on a style change.
10. The fixed `BasemapControl` versus `LayerControl` responsibilities and inability to interleave layers across canvases.
11. Managed basemaps/overlays include the minimal canvas layout in `@mapseekai/emap/style.css`; applications that add MapLibre controls, popups, or markers through the raw map must additionally import `maplibre-gl/dist/maplibre-gl.css`.

Do not claim GetCapabilities support, arbitrary CRS conversion, MapLibre interaction, opacity UI, or ordering UI.

- [ ] **Step 4: Generate, never hand-edit, API pages**

Ensure all new public contracts have JSDoc. Mark internal host/loader/factory/implementation symbols `@internal`. Then run:

```bash
rtk pnpm run api:build
```

Commit generated changes under `packages/docs/static/api`; do not commit `packages/docs/build`.

- [ ] **Step 5: Verify docs and metadata**

```bash
rtk pnpm exec vitest run test/docs/typedoc-config.test.ts test/docs/i18n-layout.test.ts test/docs/checkers.test.ts --reporter=dot
rtk pnpm run docs:check-api
rtk pnpm run docs:check-i18n
rtk pnpm run docs:build
```

- [ ] **Step 6: Review and commit documentation**

Run GitNexus `detect_changes({ scope: "working" })` and verify only documentation/API-generation surfaces changed.

```bash
rtk git diff --check
rtk git add README.md README.zh-CN.md packages/docs/docs/guides/controls.md packages/docs/i18n/en/docusaurus-plugin-content-docs/current/guides/controls.md packages/docs/static/api
rtk git commit -m "docs: document MapLibre online services"
```

## Task 10: Perform Final Regression and Browser Verification

**Files:**

- Verify only; fix failures in the task/commit that introduced them rather than creating an unrelated cleanup commit.

- [ ] **Step 1: Run focused behavior and type coverage**

```bash
rtk pnpm exec vitest run src/map/maplibre-service-manager.test.ts src/map/maplibre-emap-integration.test.ts src/map/map.test.ts src/core/event-map.test.ts src/ui/basemap-control.test.ts src/ui/layer-control.test.ts src/index.test.ts test/docs/example-runtime.test.ts test/docs/example-catalog.test.ts --reporter=dot
rtk pnpm run typecheck
```

- [ ] **Step 2: Run formatting, production build, and full unit suite**

```bash
rtk pnpm run format:check
rtk pnpm run build
rtk pnpm run test:run
```

- [ ] **Step 3: Run complete docs/example verification**

```bash
rtk pnpm run docs:verify
```

- [ ] **Step 4: Manually validate real services in a browser**

```bash
rtk pnpm run build
rtk pnpm run examples:dev
```

Open `/mapseekai/emap/examples/online-map-services/` and verify:

1. OSM and Carto are mutually exclusive and “No basemap” works.
2. Both overlays can be visible together.
3. WMS requests contain concrete Web Mercator bounding boxes after template expansion.
4. Switching basemaps preserves both selected overlays.
5. The Emap business layer remains above the full MapLibre canvas.
6. Emap pan/zoom/resize keeps MapLibre aligned without MapLibre accepting input.
7. Removing either control preserves service state.
8. `map.remove()` removes the MapLibre canvas/listeners and produces no late errors.

Also manually exercise one TMS, one WMTS, and one TileJSON source from the documentation snippets; they need not all be displayed in the canonical example.

- [ ] **Step 5: Audit the final graph and worktree**

Run GitNexus `detect_changes({ scope: "compare", base_ref: "master" })`. Confirm affected execution flows are limited to MapLibre service lifecycle, Emap ownership/layer events, controls, exports, examples, and docs.

```bash
rtk git status --short
rtk git log --oneline -10
```

Expected: clean worktree, the nine focused commits above, and no generated `packages/docs/build` files.

## Completion Criteria

- Construction-time and runtime registration accept native MapLibre basemap/overlay definitions.
- The single MapLibre canvas displays zero/one basemap and multiple overlays below every Emap layer.
- Overlay selection survives all basemap style switches, including full rebuilds and rapid changes.
- Registry, service state, errors, rollback, and teardown are deterministic and observable.
- `BasemapControl` is a basemap-only view; `LayerControl` shows business layers and online overlays in fixed groups.
- Generated Emap layers can be toggled without losing their siblings, and both controls track API-driven changes.
- Legacy basemap inputs remain compatible and `defaultStyle` works.
- No public-tile network dependency exists in automated tests.
- Public types, examples, English/Chinese docs, generated API, build, full tests, and browser checks all pass.
