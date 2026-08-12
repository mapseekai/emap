# Emap

<p align="center">
  <img src="packages/examples/public/emap.svg" alt="Emap logo" width="160" />
</p>

[简体中文](README.zh-CN.md)

`Emap` is a browser-only TypeScript map rendering and editing engine built on
Mapshaper topology data structures and HTML5 Canvas 2D. It is designed for
framework-agnostic GIS applications that need client-side loading, rendering,
selection, topology-aware editing, data operations, undo/redo, and custom UI
integration without a backend service.

## Project Status

`Emap` is an AI-driven development project and is still evolving quickly. The
API, behavior, and implementation details may change without the compatibility
guarantees expected from a mature GIS engine. It is not recommended for
production environments yet; evaluate it in prototypes, demos, research tools,
or controlled internal workflows first.

## Highlights

- Topology-first rendering for Mapshaper datasets, with shared-arc reuse and LOD.
- GeoJSON, TopoJSON, ZIP Shapefile, and Mapshaper snapshot loading.
- MapLibre-style layer specs: `fill`, `line`, and `circle`.
- Named interaction handlers: `dragPan`, `scrollZoom`, `clickSelect`,
  `boxSelect`, `lassoSelect`, `vertexEdit`, `drawFeature`, and
  `transformFeature`.
- Handler-driven customization: use built-in interactions without the bundled UI
  controls, or build your own toolbar around the same handlers.
- Delegated feature events: `feature:click`, `feature:hover`, `feature:enter`,
  and `feature:leave`.
- MapLibre-parity camera methods: `jumpTo`, `easeTo`, `flyTo`, `fitBounds`,
  `panBy`, `panTo`, `zoomTo`, and `stop`.
- 30+ `map.ops.*` data operations backed by Mapshaper commands.
- Undo/redo, transactions, validators, feature accessors, highlighting, and
  full-session snapshots.
- Optional Web Worker offloading for expensive dataset-replace operations.
- Optional `@mapseekai/emap/duckdb` module for DuckDB-Wasm spatial processing and GeoParquet queries.
- CSS design tokens for theming built-in UI surfaces.

See the documentation and generated API reference below for the complete public
surface.

## Documentation

- Simplified Chinese documentation entry: <https://mapseekai.github.io/mapseekai/emap/>
- English documentation entry: <https://mapseekai.github.io/mapseekai/emap/en/>
- Generated API reference: <https://mapseekai.github.io/mapseekai/emap/api/>
- Runnable examples catalog: <https://mapseekai.github.io/mapseekai/emap/examples/>
- Release verification checklist: [docs/release-checklist.md](docs/release-checklist.md)

## Install

```bash
npm install @mapseekai/emap
# or
pnpm add @mapseekai/emap
```

## Quick Start

### Bundlers

```ts
import {
  Emap,
  TopologySource,
  NavigationControl,
  HistoryControl,
  ScaleControl,
} from '@mapseekai/emap';
import '@mapseekai/emap/style.css';

const map = new Emap({ container: 'map' });
map.addControl(new NavigationControl(), 'top-left');
map.addControl(new HistoryControl(), 'top-left');
map.addControl(new ScaleControl(), 'bottom-left');

const source = await TopologySource.fromUrl(
  'china',
  'https://geojson.cn/api/china/1.6.3/china.topo.json',
);

await map.addSource('china', source);
map.setExtent(source.getExtent());
```

The ESM build is browser-ready. Mapshaper is shipped as a sibling ES module
resolved from `node_modules/@mapseekai/emap/dist/`, so Vite, webpack, esbuild,
and Bun consumers should not need a `Buffer` polyfill or a custom alias.

### Static Assets

Some runtime files are loaded by URL instead of being inlined into your
application bundle:

| Asset | When it is needed |
|---|---|
| `dist/emap.css` | Built-in controls, context menus, and default UI styling |
| `dist/mapshaper-vendor.js` | IIFE script usage and worker bootstrapping |
| `dist/emap-worker.js` | `useWorker: true` or `useWorker: 'auto'` |

For bundlers, prefer:

```ts
import '@mapseekai/emap/style.css';
```

TypeScript resolves this CSS import to the bundled declaration file under both modern conditional exports and legacy Node-style module resolution.

For script-tag or static-host deployments, copy the files from
`node_modules/@mapseekai/emap/dist/` into your public assets directory. When
using the worker, keep `emap-worker.js` and `mapshaper-vendor.js` in the same
directory unless you build your own worker bundle; the worker imports the vendor
file with a relative `importScripts('mapshaper-vendor.js')` call.

### IIFE Script

```html
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="node_modules/@mapseekai/emap/dist/emap.css" />
    <style>
      html, body, #map { width: 100%; height: 100%; margin: 0; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script src="node_modules/@mapseekai/emap/dist/mapshaper-vendor.js"></script>
    <script src="node_modules/@mapseekai/emap/dist/emap.js"></script>
    <script>
      const { Emap, TopologySource, NavigationControl } = emap;
      const map = new Emap({ container: 'map' });
      map.addControl(new NavigationControl(), 'top-left');

      (async () => {
        const source = await TopologySource.fromUrl(
          'china',
          'https://geojson.cn/api/china/1.6.3/china.topo.json',
        );
        await map.addSource('china', source);
        map.setExtent(source.getExtent());
      })();
    </script>
  </body>
</html>
```

## Loading Data

```ts
const source = await TopologySource.fromUrl('roads', '/data/roads.geojson');
await map.addSource('roads', source);
map.setExtent(source.getExtent());

const local = new TopologySource('local');
await local.setData({ filename: 'upload.zip', content: bytes });
await map.addSource('local', local);
```

`TopologySource.setData()` resolves after the dataset is populated and its
`data` event fires. Load the source before registration, then always await
`map.addSource()`; it is a convenience wrapper around source preflight and
confirmation, and may reproject the detached dataset before registration. If
the dataset has no CRS metadata, supply its CRS explicitly:

```ts
await map.addSource('local', local, { sourceCrs: 'EPSG:3857' });
```

For UI-driven imports, use the two-phase API so missing or invalid CRS can be
resolved without reading the input again:

```ts
let result = await map.preflightSource({ id: 'local', source: local });
if (result.status === 'needs-input') {
  result = await map.preflightSource(result.draft, { sourceCrs: selectedCrs });
}
if (result.status === 'ready') {
  await map.confirmSource(result.plan);
}
```

An explicit `sourceCrs` overrides dataset metadata; without either, preflight
returns `needs-input` instead of guessing. Empty sources cannot be registered:
load them first, then call `addSource()` or `preflightSource()`.

Supported inputs:

- GeoJSON and TopoJSON.
- ZIP Shapefile archives containing `.shp`, `.dbf`, `.shx`, and optional `.prj`.
- Mapshaper `.msx` snapshots via `map.loadSnapshot()`.
- GeoParquet and GeoArrow, with the optional Arrow module (below).

### GeoParquet / GeoArrow (optional module)

`@mapseekai/emap/arrow` adds GeoParquet (`.parquet`) and GeoArrow
(`.arrow` / `.arrows` / `.feather`) support as a separate bundle so the core
stays small. Conversion is direct (coordinate buffers ↔ mapshaper arcs, no
GeoJSON intermediate); importing the module registers the formats with
`setData` / `export` as a side effect:

```ts
import '@mapseekai/emap/arrow';

await source.setData({ filename: 'parcels.parquet', content: bytes });
const blob = await source.export({ format: 'geoparquet' }); // WKB encoding default
const arrow = await source.export({ format: 'geoarrow' }); // native encoding default
```

In-memory Arrow tables work without files — this is the duckdb-wasm bridge
(query results with an `ST_AsWKB(geometry)` column convert directly):

```ts
import { setArrowTable, toArrowTableFromSource } from '@mapseekai/emap/arrow';

await setArrowTable(source, duckdbResultTable); // replace a source's dataset
const table = toArrowTableFromSource(source); // source dataset → Arrow table
```

Notes:

- GeoParquet uses [parquet-wasm](https://github.com/kylebarron/parquet-wasm)
  (~1.2 MB wasm), loaded lazily on first use via dynamic `import()`. Bundlers
  that emit wasm assets (Vite, webpack 5) need no configuration. Script-tag /
  IIFE setups must initialize parquet-wasm themselves and inject it with
  `setParquetWasm(module)`. GeoArrow needs no wasm at all.
- GeoParquet export writes spec 1.1 `geo` metadata; geometry encoding is WKB
  by default (DuckDB / GeoPandas / GDAL compatible), switchable with
  `{ encoding: 'native' }`. Non-EPSG CRSs export without PROJJSON details.
- Exports cover one layer per file (`{ layer }` option selects which).

### DuckDB-Wasm Spatial Processing (opt mod)

`@mapseekai/emap/duckdb` adds an optional DuckDB-Wasm processing surface. It is
kept out of the core and Arrow bundles; import it only where spatial
processing is needed.

```ts
import {
  areaDatasetWithDuckDb,
  bufferDatasetWithDuckDb,
  centroidDatasetWithDuckDb,
  centroidXDatasetWithDuckDb,
  createDuckDbRuntimeFromJsDelivr,
  duckDbAttributeLayer,
  duckDbBufferLayer,
  duckDbGeoParquetQueryLayer,
  duckDbGeometryLayer,
  duckDbOverlayLayer,
  duckDbRelationLayer,
  differenceDatasetWithDuckDb,
  envelopeDatasetWithDuckDb,
  geometryTypeDatasetWithDuckDb,
  distanceDatasetWithDuckDb,
  intersectsAttributeDatasetWithDuckDb,
  intersectsDatasetWithDuckDb,
  intersectionDatasetWithDuckDb,
  simplifyPreserveTopologyDatasetWithDuckDb,
  setDuckDbRuntime,
} from '@mapseekai/emap/duckdb';
```

The package declares `@duckdb/duckdb-wasm` as an optional dependency. If your
package manager does not install optional dependencies by default, install it
next to `@mapseekai/emap`.

```bash
npm install @duckdb/duckdb-wasm
```

Use an injected runtime when your app already owns DuckDB-Wasm lifecycle:

```ts
setDuckDbRuntime({
  async ensureSpatial() {
    const conn = await db.connect();
    try {
      await conn.query('INSTALL spatial; LOAD spatial;');
    } finally {
      await conn.close();
    }
  },
  async connect() {
    const conn = await db.connect();
    return {
      insertArrowTable: (table, opts) => conn.insertArrowTable(table, { ...opts, create: true }),
      query: (sql) => conn.query(sql),
      close: () => conn.close(),
    };
  },
  async registerFileBuffer(name, buffer) {
    await db.registerFileBuffer(name, buffer);
  },
  async dropFile(name) {
    await db.dropFile?.(name);
  },
});
```

`registerFileBuffer` is required for GeoParquet byte queries. `dropFile` is
optional cleanup and is called only when the injected runtime exposes it.

Or create the browser runtime from DuckDB's jsDelivr bundles:

```ts
const runtime = await createDuckDbRuntimeFromJsDelivr();
setDuckDbRuntime(runtime);
```

Run a dataset-level buffer and display the returned dataset however your app
manages sources:

```ts
const buffered = await bufferDatasetWithDuckDb(dataset, {
  layer: 'parcels',
  distance: 25,
  outputLayer: 'parcels_buffer',
});
```

Unary geometry-to-geometry helpers share the same DuckDB-Wasm path:

```ts
const centroids = await centroidDatasetWithDuckDb(dataset, {
  layer: 'parcels',
  outputLayer: 'parcel_centroids',
});

const envelopes = await envelopeDatasetWithDuckDb(dataset, {
  layer: 'parcels',
  outputLayer: 'parcel_envelopes',
});

const simplified = await simplifyPreserveTopologyDatasetWithDuckDb(dataset, {
  layer: 'parcels',
  tolerance: 5,
  outputLayer: 'parcels_simplified',
});
```

Supported unary geometry helpers are centroid, envelope, convex hull, boundary,
simplify, simplify-preserve-topology, and make-valid. Simplify tolerance uses
dataset coordinate units and rejects geographic CRS by default; pass
`failOnGeographicCrs: false` only when degree-based simplification is intentional.

Geometry-to-attribute helpers preserve the input geometry and append scalar
record columns:

```ts
const withArea = await areaDatasetWithDuckDb(dataset, {
  layer: 'parcels',
  outputColumn: 'area_m2',
});

const withGeometryType = await geometryTypeDatasetWithDuckDb(dataset, {
  layer: 'parcels',
  outputColumn: 'geom_type',
});

const withCentroidX = await centroidXDatasetWithDuckDb(dataset, {
  layer: 'parcels',
  outputColumn: 'centroid_x',
});
```

Supported attribute helpers are area, length, perimeter, geometry type, validity,
empty/simple predicates, point x/y, and centroid x/y. Area, length, and
perimeter use dataset coordinate units and reject geographic CRS by default.

Relation helpers compare an input dataset against a mask dataset. Topological
predicates can run on geographic CRS; distance and distanceWithin reject
geographic CRS by default unless `failOnGeographicCrs: false` is passed.

```ts
const inFloodplain = await intersectsDatasetWithDuckDb(parcels, floodplain, {
  inputLayer: 'parcels',
  maskLayer: 'floodplain',
  outputLayer: 'parcels_in_floodplain',
});

const withIntersectFlag = await intersectsAttributeDatasetWithDuckDb(
  parcels,
  floodplain,
  {
    inputLayer: 'parcels',
    maskLayer: 'floodplain',
    outputColumn: 'in_floodplain',
  },
);

const withDistance = await distanceDatasetWithDuckDb(parcels, hospitals, {
  inputLayer: 'parcels',
  maskLayer: 'hospitals',
  outputColumn: 'nearest_hospital_m',
});
```

Overlay helpers create new input-derived geometries from a mask dataset:

```ts
const clipped = await intersectionDatasetWithDuckDb(parcels, floodplain, {
  inputLayer: 'parcels',
  maskLayer: 'floodplain',
  outputLayer: 'parcels_clipped',
});

const erased = await differenceDatasetWithDuckDb(parcels, floodplain, {
  outputLayer: 'parcels_erased',
});
```

Mask geometries are unioned before overlay. Output keeps input attributes only;
mask attributes are not copied. Output CRS metadata inherits from the input
dataset, so input and mask datasets must already use the same CRS.

#### Restricted SELECT queries

For scalar attribute queries, `queryDatasetWithDuckDb` registers one logical
table named `input` for the selected layer:

```ts
import { queryDatasetWithDuckDb } from '@mapseekai/emap/duckdb';

const filtered = await queryDatasetWithDuckDb(dataset, {
  sql: 'SELECT name, population FROM input WHERE population > 100000 ORDER BY population DESC LIMIT 50',
  outputLayer: 'large_places',
});
```

The first batch supports scalar attribute projection, simple scalar `WHERE`
comparisons joined by `AND`/`OR`, scalar `ORDER BY`, and integer `LIMIT`.
Joins, multiple statements, mutating SQL, and calculated output geometry are
rejected before DuckDB execution. `validateDuckDbSelectSql` is also exported for
callers that need to preflight the same restricted SQL contract; it is
intentionally conservative and evolves with this first-batch query surface.

##### Query GeoParquet bytes with DuckDB

`@mapseekai/emap/duckdb` can run the same restricted `SELECT ... FROM input ...`
contract against GeoParquet bytes. The helper registers the bytes with
DuckDB-Wasm, exposes them as the logical `input` table, and converts the
geometry-bearing Arrow result to a `MapshaperDataset`.

```ts
import { queryGeoParquetWithDuckDb } from '@mapseekai/emap/duckdb';

const result = await queryGeoParquetWithDuckDb(bytes, {
  layerName: 'active_points',
  sql: 'SELECT geometry, name FROM input WHERE active = true',
});
```

The first batch requires the projection to include a detectable geometry column,
for example `SELECT geometry, name FROM input`. Direct `read_parquet(...)` calls,
joins, mutations, and multiple statements are rejected by the validator.

For map-like integrations, use the adapter form with a minimal source context.
`duckDbGeoParquetQueryLayer` reads `ctx.getSource(src).getBytes()`; the
dataset-backed adapters read `getDataset()`.

```ts
await duckDbBufferLayer(ctx, {
  src: 'parcels',
  layer: 'parcels',
  distance: 25,
  output: { sourceId: 'parcels-buffer' },
});

await duckDbGeometryLayer(ctx, {
  src: 'parcels',
  operation: 'centroid',
  layer: 'parcels',
  output: { sourceId: 'parcel-centroids' },
});

await duckDbAttributeLayer(ctx, {
  src: 'parcels',
  operation: 'area',
  layer: 'parcels',
  outputColumn: 'area_m2',
  output: { sourceId: 'parcels-with-area' },
});

await duckDbRelationLayer(ctx, {
  src: 'parcels',
  mask: 'floodplain',
  mode: 'filter',
  operation: 'intersects',
  inputLayer: 'parcels',
  maskLayer: 'floodplain',
  output: { sourceId: 'parcels-in-floodplain' },
});

await duckDbOverlayLayer(ctx, {
  src: 'parcels',
  mask: 'floodplain',
  operation: 'intersection',
  inputLayer: 'parcels',
  maskLayer: 'floodplain',
  outputLayer: 'parcels_clipped',
  output: { sourceId: 'parcels-clipped' },
});

await duckDbGeoParquetQueryLayer(ctx, {
  src: 'uploaded-parcels',
  sql: 'SELECT geometry, name FROM input WHERE active = true',
  output: { sourceId: 'active-parcels' },
});
```

Buffer distance uses the dataset coordinate units. `EPSG:4326` and `OGC:CRS84`
are rejected by default; reproject to a projected CRS before buffering, or pass
`failOnGeographicCrs: false` only when degree-based buffering is intentional.

#### Security and deployment

The DuckDB surface is **injection-first** by design: `setDuckDbRuntime(...)` lets
your app own the DuckDB-Wasm lifecycle, and every helper accepts an explicit
runtime argument. `createDuckDbRuntimeFromJsDelivr()` is a convenience loader for
demos and prototypes — **prefer an injected, self-hosted runtime in production**.

- **Remote code / supply chain.** `createDuckDbRuntimeFromJsDelivr()` fetches and
  executes the DuckDB-Wasm worker and `.wasm` from the jsDelivr CDN at runtime,
  and `INSTALL spatial; LOAD spatial;` downloads the spatial extension from
  DuckDB's extension repository. For production, self-host the bundles, pin
  versions / add Subresource Integrity, and point `customExtensionRepository` at
  a repository you control.
- **Content-Security-Policy.** The CDN loader needs `script-src` to allow the
  bundle origin, `worker-src blob:` (the worker is created from a `Blob`), and a
  WASM-capable policy (`wasm-unsafe-eval` on modern browsers). Self-hosted
  bundles can use a strict same-origin CSP instead.
- **Cross-origin isolation.** The multithreaded bundle uses `SharedArrayBuffer`,
  which requires the page to be cross-origin isolated via `COOP`
  (`same-origin`) + `COEP` (`require-corp`) response headers. Without these,
  DuckDB-Wasm silently falls back to the slower single-threaded bundle.
- **SQL safety.** Helpers parameterize all user-supplied inputs: identifiers are
  quoted, numeric arguments are validated, and spatial function names are
  restricted to the `ST_*` namespace. Do not bypass the named helpers by feeding
  untrusted strings into the low-level `process*`/SQL-builder exports.

## Layers and Rendering

```ts
map.addLayer({
  id: 'roads-line',
  source: 'roads',
  type: 'line',
  paint: {
    'line-color': '#4a5568',
    'line-width': 1,
    'line-dashstyle': 'dash',
  },
});

map.addLayer({
  id: 'district-fill',
  source: 'districts',
  type: 'fill',
  paint: {
    'fill-color': 'rgba(66, 153, 225, 0.25)',
    'line-width': 0,
  },
});

### Line style options

For `line` (and `fill` outlines), `line` paint can also use:

- `'line-dashstyle': 'solid' | 'dash' | 'dot' | 'dash-dot' | 'arrow-dot'`
- `'line-arrow-spacing'`: spacing in screen pixels between arrow heads, used by `arrow-dot`
- `'line-arrow-size'`: arrow tip-to-tail size in screen pixels, used by `arrow-dot`

The existing `line-dasharray` keeps working as before; when both `line-dasharray` and `line-dashstyle` are set, `line-dashstyle` takes precedence.

`arrow-dot` draws short dashes and directional arrow wings in one batched Canvas path. It follows
each visible polyline/ring coordinate order and caches the screen-space commands until geometry,
view, pixel ratio, or arrow placement style changes.
```

When no user layers are added, `Emap` creates default display layers from the
source geometry type. Polygon defaults are outline-only for large-data browsing;
add an explicit `fill` layer when you want area fills.

## Interactions Without Built-In Controls

Most editing and selection tools are exposed as named handlers. You can use
them directly from your own UI instead of adding `BoxSelectControl`,
`DrawFeatureControl`, `VertexEditControl`, or `EditToolbar`.

```ts
map.boxSelect.setOptions({
  layers: ['district-fill'],
  dragThreshold: 4,
});
map.boxSelect.enable();

map.lassoSelect.setOptions({ layers: ['district-fill'] });
map.lassoSelect.enable();

map.drawFeature.setOptions({
  source: 'editing',
  sourceLayer: 'areas',
  type: 'polygon',
  snapSources: ['editing', 'reference'],
});
map.drawFeature.enable();

map.vertexEdit.enable();

map.clickSelect.enable();
map.transformFeature.setOptions({ mode: 'translate' });
map.transformFeature.enable();
```

All handlers expose the same basic surface:

```ts
handler.enable();
handler.disable();
handler.isEnabled();
handler.setOptions({...});
handler.getOptions();
```

Available named handlers:

| Handler | Purpose |
|---|---|
| `map.dragPan` | Pointer drag map panning |
| `map.scrollZoom` | Wheel zoom |
| `map.clickSelect` | Click selection |
| `map.boxSelect` | Active-tool rectangular selection |
| `map.lassoSelect` | Free-form lasso selection |
| `map.vertexEdit` | Topology-aware vertex editing |
| `map.drawFeature` | Point, polyline, and polygon drawing |
| `map.transformFeature` | Translate, rotate, or scale selected features |

## Building Your Own UI

Built-in controls are optional. A custom toolbar can call the public map API and
handlers directly:

```ts
toolbar.querySelector('[data-tool="box"]').onclick = () => {
  map.lassoSelect.disable();
  map.boxSelect.enable();
};

toolbar.querySelector('[data-tool="undo"]').onclick = () => map.undo();
toolbar.querySelector('[data-tool="redo"]').onclick = () => map.redo();

map.on('historychange', (e) => {
  undoButton.disabled = !e.canUndo;
  redoButton.disabled = !e.canRedo;
});
```

For a custom control that still plugs into the corner layout, implement:

```ts
const control = {
  onAdd(map) {
    const el = document.createElement('div');
    el.textContent = 'My tool';
    return el;
  },
  onRemove() {},
};

map.addControl(control, 'top-right');
```

### Custom Box Selection

If you want your own rectangular selection UI instead of `BoxSelectControl`, use
the built-in handler as the gesture engine and keep your buttons outside
`Emap`:

```ts
const boxButton = document.querySelector<HTMLButtonElement>('[data-tool="box"]')!;
const clearButton = document.querySelector<HTMLButtonElement>('[data-tool="clear"]')!;

map.boxSelect.setOptions({
  layers: ['district-fill'],
  dragThreshold: 4,
});

// Plain drag replaces the current selection. Shift+drag adds to it;
// Shift+Alt+drag toggles matching features.

function activateBoxSelect() {
  map.lassoSelect.disable();
  map.vertexEdit.disable();
  map.drawFeature.disable();
  map.transformFeature.disable();
  map.boxSelect.enable();
  boxButton.dataset.active = 'true';
}

function deactivateBoxSelect() {
  map.boxSelect.disable();
  delete boxButton.dataset.active;
}

boxButton.onclick = () => {
  if (map.boxSelect.isEnabled()) deactivateBoxSelect();
  else activateBoxSelect();
};

clearButton.onclick = () => map.clearSelection();

map.on('selectionchange', (e) => {
  selectionCount.textContent = String(e.selected.length);
});
```

The handler owns pointer capture, hit testing, selection mode resolution, and
its overlay drawing. Your application owns toolbar state, mode switching, and
whether selection is allowed for the current workflow.

## Feature Events and Highlighting

```ts
map.on('feature:click', { layers: ['district-fill'] }, (e) => {
  console.log(e.ref, e.feature.properties);
  map.select([e.ref]);
});

map.on('feature:enter', { layers: ['district-fill'] }, (e) => {
  map.setHighlightedFeatures([e.ref], { color: '#1677ff', width: 2, fill: true });
});

map.on('feature:leave', () => {
  map.clearHighlightedFeatures();
});

map.on('mousemove', (e) => {
  status.textContent = `${e.mapCoord[0].toFixed(4)}, ${e.mapCoord[1].toFixed(4)}`;
});
```

Feature and pointer events are delegated through the same pointer arbiter as the
handlers. The pointer sink is installed lazily, so there is no hit-test overhead
when no listener is registered.

## Data Operations

All operations return `Promise<OpResult<T>>`:

```ts
const result = await map.ops.bufferLayer({
  source: 'roads',
  target: 'roads',
  radius: 50,
});

if (!result.ok) {
  console.error(result.error.kind, result.error.message);
}
```

Common operation groups:

- Geometry operations: `clipLayer`, `eraseLayer`, `dissolveLayer`,
  `bufferLayer`, `simplifyLayer`, `projectLayer`, `cleanLayer`, `snapLayer`.
- Conversion operations: `pointsLayer`, `linesLayer`, `polygonsLayer`,
  `innerlinesLayer`, `explodeLayer`.
- Layer operations: `renameLayer`, `mergeLayers`, `splitLayer`, `dropLayer`.
- Attribute operations: `applyExpression`, `filterFeatures`, `joinTable`,
  `sortFeatures`, `uniqueFeatures`, `filterFields`, `renameFields`,
  `dataFill`.
- Inspection and repair: `checkGeometry`, `rebuildTopology`,
  `intersectionPointsLayer`.
- Selection-driven operation: `mergeSelected`.

Expression-bearing APIs are disabled by default for safety:

```ts
const map = new Emap({ container: 'map', expressionPolicy: 'trusted' });
```

Use `'trusted'` only for application-owned expressions and trusted data.

## Transactions, Undo, and Validation

```ts
const tx = map.beginTransaction();

const clipped = await map.ops.clipLayer({ source: 's', target: 'parcels', mask: 'clip' });
if (!clipped.ok) {
  tx.rollback();
} else {
  await tx.commit('Clip parcels');
}

map.undo();
map.redo();

map.on('selectionchange', (e) => {
  console.log(e.selected, e.added, e.removed);
});
```

Register validators for post-commit checks:

```ts
import { topologyValidator } from '@mapseekai/emap';

const unregister = map.validators.register(topologyValidator({
  sources: ['editing'],
}));

map.on('validationfailed', (e) => {
  console.warn(e.results);
});
```

The engine reports validation failures; it does not auto-undo. The application
decides whether to warn, block save, or call `map.undo()`.

## Camera

```ts
map.jumpTo({ center: [120, 30], zoom: 6 });
map.easeTo({ center: [120, 30], zoom: 8, duration: 600 });
map.flyTo({ center: [120, 30], zoom: 10, duration: 1500 });
map.fitBounds(source.getExtent(), { padding: 40, duration: 600 });
map.panBy([120, 0]);
map.stop();
```

Camera methods are chainable and fire `movestart`, `move`, `moveend`,
`zoomstart`, `zoom`, and `zoomend` events.

## Worker Offloading

```ts
const map = new Emap({
  container: 'map',
  useWorker: 'auto',
  workerThreshold: 200_000,
  workerUrl: '/vendor/emap/emap-worker.js',
  workerPoolSize: 2,
});
```

When workers are enabled, serve these files from the same directory:

```text
node_modules/@mapseekai/emap/dist/emap-worker.js
node_modules/@mapseekai/emap/dist/mapshaper-vendor.js
```

`workerRouting` can override the built-in cheap/expensive operation routing.

Workers only cover dataset-replace style operations such as clip, dissolve,
union, simplify, project, and similar `map.ops.*` commands. Pointer
interactions, selection transforms, vertex edits, and drawing sessions stay on
the main thread because their per-frame state is UI-bound and usually cheaper
than worker round trips.

## Theming

Import the default CSS once:

```ts
import '@mapseekai/emap/style.css';
```

Override CSS tokens at `:root` or an app-specific container:

```css
:root {
  --emap-accent: #1677ff;
  --emap-accent-soft: rgba(22, 119, 255, 0.12);
  --emap-surface-bg: #fff;
  --emap-surface-border: #d9d9d9;
  --emap-surface-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
  --emap-radius: 4px;
  --emap-hover-bg: #f5f5f5;
  --emap-danger: #d32f2f;
  --emap-font: 13px/1.5 system-ui, sans-serif;
}
```

## Built-In Controls

Native MapLibre basemaps and online overlays can be registered with the map:

```ts
const map = new Emap({
  container: 'map',
  mapLibre: {
    services: [
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
    ],
    defaultBasemap: 'osm',
  },
});
```

The MapLibre canvas always sits below every Emap layer. Only one registered
basemap can be active at a time; online overlays share that lower canvas.

| Control | Purpose |
|---|---|
| `NavigationControl` | Zoom in, zoom out, reset |
| `StatusControl` | Pointer coordinates and CRS |
| `ScaleControl` | Local ellipsoidal distance bar, nominal `1:N`, and Web Mercator zoom |
| `BasemapControl` | Select one registered MapLibre basemap |
| `LayerControl` | Toggle Emap business layers and MapLibre online overlays |
| `HistoryControl` | Undo/redo buttons |
| `EditToolbar` | Combined edit toolbar |
| `VertexEditControl` | Button shell over `map.vertexEdit` |
| `DrawFeatureControl` | Button shell over `map.drawFeature` |
| `BoxSelectControl` | Thin shell over `map.boxSelect` |
| `LassoSelectControl` | Thin shell over `map.lassoSelect` |
| `SimplifyControl` | Simplification UI |

Configure the scale display with local measurement options:

```ts
map.addControl(new ScaleControl({
  units: 'dual',
  calculationMethod: 'average',
  dpi: 144,
}), 'bottom-left');
```

Unsupported or non-Earth CRSs hide measurements rather than guessing.

## Known Limitations

- The project is AI-driven and still moving quickly; avoid depending on
  undocumented internals in production applications.
- `fill` rendering is heavier than `line` rendering for large polygon datasets
  because area fills require full polygon path materialization and fill rules.
  For large-data browsing, keep polygon layers outline-first and enable fills
  only at suitable scales or for filtered subsets.
- Emap business layers render with Canvas 2D. Native MapLibre services use a
  separate lower canvas; Emap itself does not provide a WebGL renderer, symbol
  placement engine, tiled vector source, or server-side tile pipeline.
- CRS support follows the bundled Mapshaper/projection path and common browser
  data workflows. Validate project-specific CRS definitions before building
  user-facing editing workflows around them.
- Expression-bearing operations are disabled by default. Set
  `expressionPolicy: 'trusted'` only for first-party expressions and trusted
  data.
- Worker offloading requires the host app to deploy worker/vendor assets
  correctly and does not make every interaction asynchronous.

## Architecture

### Repository Layout

```text
src/
├── index.ts                 # Public entry point, explicit named exports
├── map/                     # Emap orchestrator, ops, selection, history
│   ├── map.ts               # Main Emap class
│   ├── mapshaper-ops.ts     # map.ops facade
│   ├── ops/                 # One file per data op
│   ├── op-result.ts         # OpResult and OpError helpers
│   ├── selection.ts         # Selection model
│   ├── feature-query.ts     # Hit testing and Flatbush indexes
│   ├── feature-accessor.ts  # Read-side feature lookup API
│   ├── highlight-manager.ts # Highlight state and rendering
│   ├── layer.ts             # LayerSpecification and paint resolution
│   ├── layer-registry.ts    # Layer resolution surface
│   ├── edit-sessions.ts     # Translate/affine edit sessions
│   ├── edit-state-store.ts  # Edit mode state
│   ├── attribute-ops.ts     # Attribute and field commands
│   ├── worker-routing.ts    # Worker decision tree
│   └── types.ts             # Public map option and op option types
├── adapter/mapshaper-adapter.ts  # Sole runtime bridge to mapshaper internals
├── core/                    # EventDispatcher, handlers, worker pool, tween
│   └── handlers/            # Built-in interaction handlers
├── edit/                    # EditHistory, commands, Transaction
├── source/                  # TopologySource, DisplayArcs (LOD)
├── geo/                     # Viewport, Camera, Projection, CRS resolver
├── renderer/                # Painter, CanvasPainter, EditOverlayRenderer
├── ui/                      # Controls + CSS
├── validation/, worker/, vendor/, types/
packages/examples/examples/ # Canonical runnable HTML examples
```

### Key Patterns

- **MapshaperAdapter** (`src/adapter/mapshaper-adapter.ts`) is the only runtime bridge to `mapshaper.internal.*`. Ops, commands, and sources go through `getDefaultMapshaperAdapter()`; tests stub via `setDefaultMapshaperAdapter(mock)`. Do not import `mapshaper` directly outside the adapter, worker entry, vendor modules, and type/shim boundaries.
- **ParsedCommand[]** — ops emit `[{ name: 'buffer', options: { radius: 50 } }]` and call the parsed-command runner. Avoid shell-style command strings for new code.
- **OpResult** — every op returns `{ ok: true, value? } | { ok: false, error: OpError }`. Use `Err.*`, `OK`, `okValue` from `src/map/op-result.ts`.
- **Effect-aware dataset replace** — each dataset op must classify its effect in `COMMAND_EFFECTS` (`src/map/ops/_runner.ts`) as `shape-count` / `topology-only` / `attribute-only` / `crs-only` / `unknown`. Selection preservation depends on this table.
- **Memento commands + EditHistory** — every edit command captures enough state to `do()` and `undo()` without depending on later live dataset state. Dataset-replace commands mark older commands as stale barriers rather than clearing history.
- **Transaction** (`src/edit/transaction.ts`) — `commit(label)` collapses staged commands into one `CompositeCommand`; `rollback()` restores first-touch snapshots and selection. Nesting is not supported.
- **Handler architecture** — all interactions (`dragPan`, `scrollZoom`, `clickSelect`, `boxSelect`, `lassoSelect`, `vertexEdit`, `drawFeature`, `transformFeature`) implement the `Handler` contract. `HandlerManager` owns pointer normalization, priority, exclusive gesture locking, pointer sinks, and cursor arbitration. UI controls forward to handlers rather than duplicating pointer logic.
- **EventDispatcher** — `on()` / `fire()` for engine-level signals. Raw DOM events live only at browser input boundaries, control DOM, and the handler manager.
- **Rendering loop** — `Emap.render()` is the driver; defer DOM updates / state changes via `requestAnimationFrame`, event callbacks, or tween callbacks.
- **AffineTransform** — all coordinate math goes through `AffineTransform` and viewport projection helpers; no ad-hoc matrices.
- **LayerRegistry** — resolve source/layer pairs via `LayerRegistry.resolve(...)`; do not inline `layers.find(...)` in new code.
- **LOD + batch rendering** — `DisplayArcs` manages zoom-dependent arc simplification; `CanvasPainter` batches stroke rendering. Do not bypass for large topology rendering without profiling.
- **Validation** — `ValidatorRegistry` runs after committed history changes; failures fire `validationfailed` (no auto-undo).

### Where to Make Changes

| Task | Files |
|---|---|
| New mapshaper op | `src/map/ops/<op>.ts`, `src/map/mapshaper-ops.ts`, `src/map/types.ts`, `_runner.COMMAND_EFFECTS` |
| New edit command | `src/edit/commands/<cmd>.ts` (use `vertex-move.ts` as template) |
| New handler | `src/core/handlers/<name>.ts`, `src/core/handler-manager.ts` if priority changes, `src/index.ts` |
| New UI control | `src/ui/<control>.ts`, `src/ui/controls.css`, `src/index.ts` |
| Source loading/export | `src/source/topology-source.ts` |
| CRS/projection | `src/geo/crs-resolver.ts`, `src/geo/projection.ts`, `src/geo/viewport.ts` |
| Rendering | `src/renderer/canvas-painter.ts`, `src/map/map.ts` |
| Hit testing | `src/map/feature-query.ts` |
| Worker routing | `src/map/worker-routing.ts`, `src/map/ops/_runner.ts` |
| Mapshaper internals | `src/adapter/mapshaper-adapter.ts` only |
| Public API | `src/index.ts` |
| User docs | `README.md`, `README.zh-CN.md`, `CHANGELOG.md` |

### Code Conventions

- Private members `_camelCase`; public API `camelCase`; interfaces/types `PascalCase`; constants `UPPER_CASE`.
- Tests colocated as `*.test.ts`. Use `Reflect` for private-member access in tests rather than widening visibility.
- Explicit named exports in `src/index.ts`; no `export *`.
- TypeScript strict-mode compatible. Centralize mapshaper runtime types in `src/types/mapshaper-types.ts`.

### Important Constraints

- Browser-only runtime; no Node.js runtime APIs in shipped code.
- No backend server requirement.
- Expression evaluation defaults to disabled. Expression-bearing APIs require `expressionPolicy: 'trusted'`.
- Worker offloading requires the host app to serve `emap-worker.js` and `mapshaper-vendor.js`.
- Mapshaper internals must remain isolated behind `MapshaperAdapter`.

## Development

Enable Corepack before installing:

```bash
corepack enable
corepack prepare pnpm@11.15.1 --activate
pnpm install
```

On Windows, if PowerShell blocks command shims, run the same commands through
Command Prompt (for example, `cmd /c pnpm install`) instead of switching package
managers.

Common tasks (prepend `cmd /c` on Windows):

```bash
pnpm run dev            # rollup watch for the library
pnpm run dev-build      # one-off dev build (sourcemaps, no minify)
pnpm run examples:dev   # canonical examples at /mapseekai/emap/examples/
pnpm run docs:dev       # fast documentation-only authoring server
pnpm run docs:preview   # full one-origin docs, API, and examples preview
pnpm run format:check   # Biome formatting check
pnpm run format         # Biome formatting write
pnpm run typecheck      # tsc --noEmit
pnpm run test:run       # vitest run
pnpm run build          # production build → dist/
```

Targeted test runs:

```bash
pnpm exec vitest run src/geo/crs-resolver.test.ts --reporter=dot
pnpm exec vitest run src/map/map.test.ts src/source/topology-source.test.ts
```

Runnable examples live in `packages/examples/examples/<id>/index.html`. Run
`pnpm run build` and `pnpm run examples:dev` to work on those pages against the
current workspace runtime. `pnpm run docs:dev` is intentionally documentation
only; use `pnpm run docs:preview` when links between docs, API pages, examples,
fixtures, vendors, and the worker must be tested on one origin.

`pnpm run examples:build:cdn` is reserved for an exact package version that is
already published and passes the CDN integrity check. Local development and
`docs:preview` always use workspace-built runtime assets.

Build outputs:

- `dist/emap.js` — IIFE bundle.
- `dist/emap.mjs` — ES module.
- `dist/emap-worker.js` — worker bundle.
- `dist/mapshaper-vendor.js` / `dist/mapshaper-vendor.mjs` — Mapshaper vendor bundles.
- `dist/emap.css` — control styles.
- `dist/index.d.ts` — TypeScript declarations.

## Release Checklist

Before publishing a version:

```bash
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run typecheck
pnpm run test:run
pnpm run build
pnpm pack --dry-run
```

Then check:

- `package.json` version matches the release section in `CHANGELOG.md`.
- `README.md`, `SECURITY.md`, and `CHANGELOG.md` describe the
  same public API.
- The dry-run package contains only current `dist` files, docs, license, and
  package metadata.
- A fresh consumer project can import `@mapseekai/emap`, import
  `@mapseekai/emap/style.css`, and resolve `dist/emap-worker.js` if worker
  mode is documented for the release.

## License

[MPL-2.0](LICENSE)
