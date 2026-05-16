# emap

A topology-oriented geographic map rendering and editing engine built around [Mapshaper](https://github.com/mbloch/mapshaper) data structures and HTML5 Canvas. Browser-only, framework-agnostic TypeScript.

## What you get

- **Topology rendering** — draws shared-arc datasets directly without re-tessellating per layer
- **Loaders** — GeoJSON, TopoJSON, ZIP Shapefile (with per-archive resource limits)
- **Editing** — pan / wheel-zoom / hover, plus vertex, feature, and topology-aware editing
- **30+ data ops** under `emap.ops.*` — clip, erase, dissolve, buffer, simplify, project, snap, clean, mosaic, union, divide, points / lines / polygons conversions, join-table, filter, sort, uniq, split, merge, rename, …
- **Worker pool** — expensive ops dispatch to off-thread workers automatically based on dataset size + command family
- **Undo / redo** with command coalescing, dataset-replace barriers, and structured `OpResult` errors
- **Selection model** — single / multi / box / lasso, with attribute-only ops preserving feature ids
- **Snapshots** — pack / unpack a full session (datasets + history) to a compact binary blob
- **HTML5 Canvas 2D rendering** — `CanvasPainter` with batched-stroke optimization for large topology datasets
- **Built-in controls** — navigation, status, basemap, vertex edit, feature draw, history, box / lasso selection

## Install

```bash
pnpm add @zwishing/emap
# or
npm install @zwishing/emap
```

## Hello map

```html
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="node_modules/@zwishing/emap/dist/emap.css" />
    <style>#map { width: 100vw; height: 100vh; margin: 0; }</style>
  </head>
  <body>
    <div id="map"></div>
    <script src="node_modules/@zwishing/emap/dist/mapshaper-vendor.js"></script>
    <script src="node_modules/@zwishing/emap/dist/emap.js"></script>
    <script>
      const { Emap, TopologySource, NavigationControl, EditToolbar } = emap;

      const map = new Emap({ container: 'map' });
      map.addControl(new NavigationControl(), 'top-left');
      map.addControl(new EditToolbar(), 'top-left');

      (async () => {
        const source = await TopologySource.fromUrl(
          'china',
          'https://geojson.cn/api/china/1.6.3/china.topo.json',
        );
        map.addSource('china', source);
        map.setExtent(source.getExtent());
      })();
    </script>
  </body>
</html>
```

### Bundlers

```ts
import { Emap, TopologySource, type MapOptions } from '@zwishing/emap';
import '@zwishing/emap/style.css';

const options: MapOptions = { container: 'map' };
const map = new Emap(options);
```

The ESM build is browser-ready and bundles the mapshaper runtime it needs, so
Vite/Webpack/Bun consumers should not need to add a `Buffer` polyfill.

`BasemapControl` loads MapLibre only when a basemap is first enabled. If you use
that control, also include MapLibre's stylesheet in your app:

```ts
import 'maplibre-gl/dist/maplibre-gl.css';
```

Live demos in `test/examples/*.html` cover every feature area below.

## Browser bundlers (Vite / webpack / esbuild / Bun)

`import "@zwishing/emap"` works out of the box — no `resolve.alias`, no
`Buffer` polyfill, no bundler config. mapshaper is shipped as a sibling ES
module (`dist/mapshaper-vendor.mjs`) that `dist/emap.mjs` imports by relative
path; your bundler resolves it automatically from
`node_modules/@zwishing/emap/dist/`.

```ts
import { Emap, TopologySource } from "@zwishing/emap";
import "@zwishing/emap/style.css";
```

The Web Worker is only needed if you opt into off-thread ops via `workerUrl`;
deploy `dist/emap-worker.js` and `dist/mapshaper-vendor.js` as same-directory
static assets then.

## API tour

### Core map

```ts
const map = new Emap({ container: 'map' });

map.addSource(id, source);
map.addLayer({ id, source: 'china', type: 'fill', paint: { 'fill-color': '#eee' } });
map.setExtent(source.getExtent());

map.queryFeatures(point, { layers: ['borders'] });
map.on('click', (e) => { /* … */ });
```

### Sources

```ts
const source = await TopologySource.fromUrl('id', url);     // GeoJSON / TopoJSON / ZIP
const source2 = await TopologySource.fromBytes('id', buf, {
  filename: 'local.geojson',
});  // ArrayBuffer / Uint8Array
source.getExtent();
source.getLayers();
```

### Editing operations (`emap.ops`)

All ops return `Promise<OpResult>` — a discriminated `{ ok: true, value? } | { ok: false, error: OpError }`. Errors are typed (`not-found`, `validation`, `expression-disabled`, `mapshaper`, `host-removed`).

```ts
// Whole-dataset CLI ops
await map.ops.clipLayer({ source: 'roads', target: 'streets', mask: 'park' });
await map.ops.dissolveLayer({ source: 'us', target: 'counties', field: 'STATE' });
await map.ops.bufferLayer({ source: 'roads', target: 'streets', radius: 50 });
await map.ops.simplifyLayer({ source: 'world', percentage: 10 });
await map.ops.projectLayer({ source: 'world', crs: 'EPSG:3857' });

// Layer management
await map.ops.renameLayer({ source: 's', target: 'old', name: 'new' });
await map.ops.mergeLayers({ source: 's', targets: ['a', 'b'], name: 'combined' });
await map.ops.splitLayer({ source: 's', target: 'us', expression: 'STATE' });
await map.ops.dropLayer({ source: 's', target: 'tmp' });

// Attribute / data
await map.ops.applyExpression({ source: 's', target: 'l', expression: 'this.area = $.area' });
await map.ops.filterFeatures({ source: 's', target: 'l', expression: 'this.pop > 1e6' });
await map.ops.joinTable({
  source: 's', target: 'states',
  data: { csv: csvBytes }, keys: ['STATE_FIPS', 'fips'],
});

// Topology repair / inspection
await map.ops.cleanLayer({ source: 's', target: 'l' });
await map.ops.snapLayer({ source: 's', target: 'l', interval: 0.001 });
const report = await map.ops.checkGeometry({ source: 's' });
//  → { ok: true, value: { ok, intersections: [...], intersectionCount } }

// Selection-driven
await map.ops.mergeSelected();
```

A full list of ops + their option types lives in `src/index.ts` (search for `*Options`).

### Transactions

Stage multiple ops as one atomic edit — commit collapses them into a single undo entry, rollback restores every touched source's dataset (and the selection) to the pre-transaction state.

```ts
const tx = map.beginTransaction();
const r1 = await map.ops.clipLayer({ source, target, mask });
if (!r1.ok)        { tx.rollback(); return; }
const r2 = await map.ops.dissolveLayer({ source, target, field: 'STATE' });
if (!r2.ok)        { tx.rollback(); return; }
await tx.commit('Process boundaries');
```

Nesting is not supported — opening a transaction while one is active throws.

### Undo / redo

```ts
map.undo();
map.redo();
map.clearHistory();

map.on('historychange', (e) => {
  console.log(e.canUndo, e.canRedo, e.label);
});
```

Vertex drags / feature translates within a session merge into one undo step. Dataset-replace ops (clip, dissolve, …) keep prior commands in the stack but flag them as `stale` for the UI to render appropriately — there's no destructive `clear`.

### Validation hooks

Register validators that run after every committed edit. Failures fire `validationfailed` — the engine doesn't auto-undo, the app decides.

```ts
import { topologyValidator } from '@zwishing/emap';

const unregister = map.validators.register(topologyValidator({
  sources: ['china'],
}));

map.on('validationfailed', (e) => {
  console.warn(e.results);    // [{ validator, report }, ...]
  // Optionally: map.undo();
});
```

Custom validators implement `Validator { name, phase: 'after-commit', run(host, change) }` and return `{ ok, issues: [{ severity, message, ref? }] }`.

### Feature accessor

Read one feature (or iterate a layer) without indexing into raw `layer.shapes` / `layer.data.getRecords()`:

```ts
const f = map.features.get({ source: 'us', layer: 'states', id: 12 });
if (f) console.log(f.properties.NAME, f.geometry);

for (const f of map.features.iter('us', 'states')) {
  /* … */
}

map.features.count('us', 'states'); // O(1)
```

`f.properties` is `Object.freeze`d so accidental mutation can't leak back into the dataset.

### Selection

```ts
map.selection.add({ source: 'us', layer: 'counties', id: 42 });
map.selection.toggle(ref);
map.selection.clear();

map.on('selectionchange', (e) => {
  console.log(e.added, e.removed, e.current);
});
```

Attribute-only ops (each / join / rename-fields / sort) preserve the selection across the operation. Shape-changing or topology-rebuilding ops clear it.

### Worker offloading

```ts
const map = new Emap({
  container: 'map',
  workerUrl: '/emap-worker.js',     // built alongside dist/emap.js
  useWorker: 'auto',                // 'auto' | true | false
  workerThreshold: 200_000,          // vertex count
  workerPoolSize: 2,                 // multiple workers (PR-22a)
});

map.on('workerjobstart', (e) => console.log('start', e.label));
map.on('workerjobend',   (e) => console.log('end',   e.durationMs));
```

The router classifies each op as cheap / expensive and overrides the threshold accordingly. Override the decision globally with `MapOptions.workerRouting?: (info) => boolean`.

When worker offloading is enabled, serve both `emap-worker.js` and
`mapshaper-vendor.js` from the same directory. The worker loads the vendor file
with `importScripts('mapshaper-vendor.js')`.

```ts
const map = new Emap({
  container: 'map',
  useWorker: 'auto',
  workerUrl: '/vendor/emap/emap-worker.js',
});
```

For bundler projects, copy these package files to that served directory during
your app build:

```text
node_modules/@zwishing/emap/dist/emap-worker.js
node_modules/@zwishing/emap/dist/mapshaper-vendor.js
```

### Snapshots

```ts
const blob = await map.exportSnapshot();           // → Uint8Array
await map.loadSnapshot(blob);                       // restore datasets + history
```

The export is a mapshaper-pack with magic-byte validation on load.

### Controls

| Control | Purpose |
|---|---|
| `NavigationControl` | Zoom in/out + reset |
| `StatusControl` | Cursor coordinates + EPSG |
| `BasemapControl` | MapLibre raster basemap toggle |
| `EditToolbar` | Mode switcher (vertex / feature / draw) |
| `VertexEditControl` | Topology-aware vertex dragging |
| `DrawFeatureControl` | Polygon / polyline / point drawing with edge snapping |
| `HistoryControl` | Visual undo/redo stack with stale-entry markers |
| `BoxSelectControl` | Drag-to-select bounding box |
| `LassoSelectControl` | Free-form selection lasso |

All controls implement `onAdd(map)` / `onRemove()` and accept `'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'`.

## Architecture

```
src/
├── map/                  # Emap orchestrator, ops facade, selection, history
│   └── ops/              # one file per data op (clip, dissolve, buffer, …)
├── adapter/              # MapshaperAdapter — sole bridge to mapshaper.internal.*
├── source/               # TopologySource, DisplayArcs (LOD)
├── core/                 # EventDispatcher, MapshaperWorkerPool, drag/wheel
├── geo/                  # Viewport, Projection, Bounds, AffineTransform, CRS resolver
├── renderer/             # CanvasPainter (HTML5 Canvas 2D)
├── edit/                 # EditHistory + per-command memento classes
├── ui/                   # Control implementations + controls.css
├── worker/               # off-thread mapshaper entry
└── types/                # central mapshaper type definitions
```

Design pillars:

- **One adapter, no leaks.** `MapshaperAdapter` is the only place `mapshaper.internal.*` is touched. Tests stub it; future mapshaper upgrades reroute through it.
- **Structured commands, no string-build.** Ops emit `ParsedCommand[]` directly — there is no CLI string between the op and mapshaper, on either thread.
- **Memento commands.** Every edit captures enough state to round-trip do/undo without referencing live dataset internals.
- **Effect-aware dataset replace.** Each op declares whether it changes shape / topology / attributes / CRS; selection is preserved or cleared accordingly.
- **Affine coordinate math everywhere.** All viewport conversions pass through `AffineTransform`, never ad-hoc matrix math.
- **Batch rendering.** `CanvasPainter` groups 25 paths per `stroke()` — measured optimization for large topology datasets.

## Development

```bash
pnpm install
npm run dev          # watch + sourcemaps
npm run dev-build    # one-shot dev build
npm run build        # production (minified) + .d.ts
npm test             # vitest, ~760 unit tests
npm run typecheck    # strict tsc
```

Build outputs in `dist/`:

- `emap.js` — production IIFE bundle
- `emap.mjs` — ES module
- `emap-dev.js` — dev bundle with sourcemaps
- `emap-worker.js` — worker entry
- `mapshaper-vendor.js` — mapshaper vendor bundle (load before `emap.js` in IIFE mode)
- `index.d.ts` — TypeScript declarations

Manual testing: open any `test/examples/*.html` after building.

## License

[MPL-2.0](LICENSE)
