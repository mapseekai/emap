# emap

<p align="center">
  <img src="packages/examples/public/emap.svg" alt="Emap logo" width="144" />
</p>

[简体中文](README.zh-CN.md)

`@mapseekai/emap` is a browser-only TypeScript engine for rendering, querying, analysing, and editing topology-oriented vector data. It stores data in mapshaper topology structures, renders editable layers with Canvas2D, and requires no backend map service.

## What emap supports

- **Data formats**: GeoJSON, TopoJSON, Shapefile ZIP, KML, and MSX snapshots out of the box; GeoArrow and GeoParquet through the optional `@mapseekai/emap/arrow` entry.
- **Layers**: `fill`, `line`, and `circle` layers rendered with Canvas2D, with viewport culling, simplification-aware display arcs, and attribute-driven fill buckets.
- **Editing**: select, draw, translate, rotate, scale, split, merge, reshape, auto-complete polygons, and edit vertices, rings, holes, and multipart geometry.
- **History**: every mutation is a reversible command with undo, redo, transactions, validation, and selection restoration.
- **Dataset operations**: `map.ops` exposes clip, erase, dissolve, buffer, filter, simplify, classify, join, projection, repair, and ring/part operations (see `MapshaperOps` in the API reference).
- **Execution**: dataset operations can run in a Web Worker with stale-result protection.
- **Analysis**: optional DuckDB-Wasm SQL and spatial operations through the restricted, typed `@mapseekai/emap/duckdb` entry.
- **Basemaps**: optional MapLibre services for raster/vector basemaps and online overlays; editable Canvas layers stay managed by emap.

## Install

```bash
pnpm add @mapseekai/emap
```

Import the core module and stylesheet:

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import '@mapseekai/emap/style.css';
```

emap targets modern browsers and bundler-based TypeScript resolution:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler"
  }
}
```

## Quick Start

Give the map container an explicit size:

```html
<div id="map" style="width: 100%; height: 480px"></div>
```

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import '@mapseekai/emap/style.css';

const map = new Emap({
  container: 'map',
  expressionPolicy: 'disabled',
});

const source = await TopologySource.fromUrl('districts', '/data/districts.geojson');
await map.addSource('districts', source);

map.addLayer({
  id: 'district-fill',
  type: 'fill',
  source: 'districts',
  paint: {
    'fill-color': '#60a5fa',
    'fill-opacity': 0.45,
  },
});

map.addLayer({
  id: 'district-outline',
  type: 'line',
  source: 'districts',
  paint: {
    'line-color': '#1e3a8a',
    'line-width': 1.5,
  },
});

map.setExtent(source.getExtent());
```

Dispose the instance when its host view is removed:

```ts
map.remove();
```

## Loading Local Data

Use `TopologySource.fromBytes()` for a file selected in the browser:

```ts
const file = input.files?.[0];
if (!file) throw new Error('Choose a file first');

const source = await TopologySource.fromBytes('upload', await file.arrayBuffer(), {
  filename: file.name,
  zipLimits: {
    maxCompressedBytes: 100 * 1024 * 1024,
    maxBytes: 500 * 1024 * 1024,
    maxEntries: 2_000,
    maxRatio: 100,
  },
});
```

ZIP imports accept up to 2 GiB compressed input and 2 GiB total uncompressed content by default; pass `zipLimits` to tighten them for public uploads. Archives with duplicate basenames are rejected with an explicit error.

## Editing and History

Handlers own interaction state; commands own reversible mutations:

```ts
map.vertexEdit.enable();

if (map.canUndo()) map.undo();
if (map.canRedo()) map.redo();
```

Group related operations in a transaction when they must commit or roll back together:

```ts
import type { Emap } from '@mapseekai/emap';

export async function cleanAndSimplify(map: Emap, source: string, target: string) {
  const transaction = map.beginTransaction();
  try {
    const cleaned = await map.ops.cleanLayer({ source, target });
    if (!cleaned.ok) {
      transaction.rollback();
      return cleaned;
    }
    const simplified = await map.ops.simplifyLayer({ source, target, percentage: 20 });
    if (!simplified.ok) {
      transaction.rollback();
      return simplified;
    }
    return await transaction.commit('Clean and simplify');
  } catch (error) {
    if (transaction.isOpen) transaction.rollback();
    throw error;
  }
}
```

Operations return `OpResult`; check `ok` rather than relying only on `try/catch`.
`source` is the registered source ID and `target` is its data layer name or ID.
While a transaction is open, undo/redo, history clearing, and external input
replacement are rejected. Replacing a dataset externally clears that source's
history, selection, and highlight; command undo/redo does not.

String expressions forwarded to mapshaper are disabled by default. Set `expressionPolicy: 'trusted'` only when configuration and data are fully controlled by the application.

## Attribute-Driven Fill Styling

Bake a classification into records and opt a fill layer into the baked field:

```ts
await map.ops.classifyFeatures({
  source: 'districts',
  target: 'districts',
  field: 'population',
  method: 'quantile',
  classes: 4,
  colors: ['#eff3ff', '#bdd7e7', '#6baed6', '#2171b5'],
});

map.addLayer({
  id: 'population-fill',
  type: 'fill',
  source: 'districts',
  styleSource: 'mapshaper',
});
```

`fill-color` accepts the restricted expression subset documented in the styling guide. Expressions are validated without `eval` and cached against the dataset attribute version.

## Worker Offloading

Copy the worker and vendor bundles to URLs reachable by the page, then enable worker routing:

```ts
const map = new Emap({
  container: 'map',
  useWorker: 'auto',
  workerUrl: '/assets/emap-worker.js',
});
```

Published worker assets:

```text
@mapseekai/emap/dist/emap-worker.js
@mapseekai/emap/dist/mapshaper-vendor.js
@mapseekai/emap/dist/mapshaper-vendor.mjs
```

The main thread validates source identity plus geometry and attribute versions before committing a worker result.

## Optional Arrow and GeoParquet

Install the peer used by the Arrow subpath; add `parquet-wasm` only for GeoParquet import or export:

```bash
pnpm add apache-arrow
pnpm add parquet-wasm # GeoParquet only
```

Mount the Arrow codec plugin on the workspace explicitly:

```ts
import { arrowFormatsPlugin } from '@mapseekai/emap/arrow';
map.use(arrowFormatsPlugin);
// For optional-format input loaded before addSource:
const optionalSource = new TopologySource('upload', { formats: map.formats });
import { fromArrowTable, toArrowTable } from '@mapseekai/emap/arrow';
```

`parquet-wasm` loads on first GeoParquet use; applications that never import this entry point never execute the format module.

## Optional DuckDB-Wasm

Install the runtime peers before importing the DuckDB subpath:

```bash
pnpm add @duckdb/duckdb-wasm apache-arrow
```

```ts
import {
  createDuckDbRuntimeFromJsDelivr,
  attributeFilter,
} from '@mapseekai/emap/duckdb';

const runtime = await createDuckDbRuntimeFromJsDelivr();

const result = await attributeFilter(source.getDataset()!, {
  sql: 'SELECT geometry, name FROM input WHERE active = true',
}, runtime);
```

The attribute-filter API accepts a restricted single-`SELECT` contract. The DuckDB processing toolbox exposes overlay, proximity, aggregate, join, geometry, transform, selection, and data-management operations. Distance-like operations reject geographic CRS by default so results are never measured in degrees.

## Optional MapLibre Services

Register MapLibre services by mounting `mapLibrePlugin`, then configuring `EmapOptions.mapLibre` or `map.mapLibreServices` when online basemaps or overlays are needed:

```ts
import { mapLibrePlugin } from '@mapseekai/emap/maplibre';

const map = new Emap({
  container: 'map',
  plugins: [mapLibrePlugin],
  mapLibre: {
    services: [
      {
        id: 'basemap',
        name: 'Basemap',
        role: 'basemap',
        style: '/styles/basemap.json',
      },
    ],
    defaultBasemap: 'basemap',
  },
});
```

The integration owns MapLibre source/layer registration, revision cancellation, failure rollback, and camera synchronization.

## Documentation

- [Installation](packages/docs/docs/getting-started/installation.md)
- [Core concepts](packages/docs/docs/concepts/emap.md)
- [Editing](packages/docs/docs/guides/editing.md)
- [Styling](packages/docs/docs/guides/styling.md)
- [Worker execution](packages/docs/docs/guides/worker.md)
- [DuckDB](packages/docs/docs/data/duckdb.md)
- [Compatibility](packages/docs/docs/reference/compatibility.md)
- [Runnable examples](packages/examples/examples)
- [Architecture decisions](docs/decisions/README.md)

## Architecture

The public `Emap` class is the façade. Internally, responsibilities are separated by durable state and failure semantics:

```text
DOM pointer input
  → HandlerManager and editing handlers
  → validated edit plan or dataset operation
  → EditCommand / operation runner
  → source version checks, history, transaction, selection
  → source data event
  → RenderScheduler
  → layer renderer and CanvasPainter
```

Key boundaries:

- `src/source/` owns import, export, ZIP limits, CRS metadata, and display-arc lifecycle.
- `src/adapter/mapshaper-adapter.ts` is the only normal runtime bridge to `mapshaper.internal.*`.
- `src/map/ops/` contains independently testable dataset and selection operations.
- `src/edit/commands/` owns reversible live mutations.
- `src/renderer/` owns Canvas drawing and edit overlays.
- `src/core/handlers/` owns browser interaction state.
- `src/arrow/` and `src/duckdb/` implement optional data and analysis entry points.
- `src/map/maplibre-service-manager.ts` owns online-service resources and asynchronous rollback.

Geometry edits and attribute edits use separate monotonic version counters. Worker and asynchronous operations compare both before committing.

## Development

Requirements:

```text
Node.js 22.18–24
pnpm 11.15.1
```

Install and run the main checks:

```bash
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run typecheck
pnpm run test:run
pnpm run test:duckdb
pnpm run build
pnpm run bundle:smoke
pnpm run docs:verify
pnpm run audit:prod
pnpm pack --dry-run
```

Start examples or documentation locally:

```bash
pnpm run examples:dev
pnpm run docs:dev
```

Generated TypeDoc files under `packages/docs/static/api/` are intentionally ignored. `api:build`, `docs:build`, and `docs:verify` regenerate them.

DuckDB integration suites run under `pnpm run test:duckdb`, which sets `DUCKDB_WASM_INTEGRATION=1` across `src/duckdb`.

Before changing a mapshaper-backed operation, update its effect classification in `src/map/ops/_runner.ts` and verify history, selection, worker, and stale-operation behavior. See [AGENTS.md](AGENTS.md) for repository rules.

## Security

Report vulnerabilities according to [SECURITY.md](SECURITY.md). Keep mapshaper expressions disabled for untrusted configuration, and apply conservative source-size limits when accepting uploads from the public internet.

## License

[MPL-2.0](LICENSE)
