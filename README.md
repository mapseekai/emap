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
- **Multiple renderers** — `CanvasPainter` (fast 2D, default) and `CanvasKitPainter` (Skia WASM, experimental)
- **Built-in controls** — navigation, status, basemap, vertex edit, feature draw, history, box / lasso selection

## Install

```bash
pnpm install emap
# or
npm install emap
```

## Hello map

```html
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="node_modules/emap/src/ui/controls.css" />
    <style>#map { width: 100vw; height: 100vh; margin: 0; }</style>
  </head>
  <body>
    <div id="map"></div>
    <script src="node_modules/emap/dist/mapshaper-vendor.js"></script>
    <script src="node_modules/emap/dist/emap.js"></script>
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

Live demos in `test/examples/*.html` cover every feature area below.

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
const source2 = await TopologySource.fromBytes('id', buf);  // ArrayBuffer / Uint8Array
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
  workerMode: 'auto',                // 'auto' | true | false
  workerThreshold: 200_000,          // vertex count
  workerPoolSize: 2,                 // multiple workers (PR-22a)
});

map.on('workerjobstart', (e) => console.log('start', e.label));
map.on('workerjobend',   (e) => console.log('end',   e.durationMs));
```

The router classifies each op as cheap / expensive and overrides the threshold accordingly. Override the decision globally with `MapOptions.workerRouting?: (info) => boolean`.

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
├── renderer/             # CanvasPainter (default), CanvasKitPainter (experimental)
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
