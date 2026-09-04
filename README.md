# emap

`@mapseekai/emap` is a browser-only TypeScript engine for rendering, querying, analysing, and editing topology-oriented vector data. It uses mapshaper data structures, renders editable business layers with Canvas2D, and can synchronize optional MapLibre basemaps and overlays.

> The project is pre-1.0 and evolves quickly. Pin the package version and validate upgrades before using it in production-critical editing workflows.

## Highlights

- Load GeoJSON, TopoJSON, Shapefile ZIP, KML, MSX snapshots, and optional GeoArrow or GeoParquet data.
- Render point, line, and polygon layers with Canvas2D, viewport culling, simplification-aware display arcs, and attribute-driven fill buckets.
- Select, draw, translate, rotate, scale, split, merge, reshape, and edit vertices, holes, and multipart geometry.
- Record reversible commands with undo, redo, transactions, validation, and source-aware selection restoration.
- Offload dataset operations to a Web Worker with stale-result protection.
- Run optional DuckDB-Wasm SQL and spatial operations through a restricted, typed API.
- Use optional MapLibre services for raster/vector basemaps and online overlays.

## Install

```bash
pnpm add @mapseekai/emap
```

Import the core module and stylesheet:

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import '@mapseekai/emap/style.css';
```

Use modern browser-oriented TypeScript resolution:

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

ZIP imports reject duplicate basenames instead of silently pairing files from different directories. Applications accepting public uploads should set limits appropriate for their deployment.

## Editing and History

Handlers provide interaction state; commands own reversible mutations:

```ts
map.vertexEdit.enable();

if (map.canUndo()) map.undo();
if (map.canRedo()) map.redo();
```

Group related operations in a transaction when they must commit or roll back together:

```ts
const transaction = map.beginTransaction();
try {
  await map.ops.cleanLayer({ source: 'districts' });
  await map.ops.simplifyLayer({ source: 'districts', percentage: 20 });
  await transaction.commit();
} catch (error) {
  await transaction.rollback();
  throw error;
}
```

String expressions forwarded to mapshaper are disabled by default. Only set `expressionPolicy: 'trusted'` when configuration and data are fully controlled by the application.

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

`fill-color` also accepts the documented restricted expression subset. It is validated without `eval` and cached against the dataset attribute version.

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

Importing the Arrow subpath registers GeoArrow and GeoParquet formats:

```ts
import '@mapseekai/emap/arrow';
import { fromArrowTable, toArrowTable } from '@mapseekai/emap/arrow';
```

GeoParquet support loads `parquet-wasm` only when needed. Applications that do not import this entry point do not execute the optional format module.

## Optional DuckDB-Wasm

```ts
import {
  createDuckDbRuntimeFromJsDelivr,
  queryDatasetWithDuckDb,
  setDuckDbRuntime,
} from '@mapseekai/emap/duckdb';

const runtime = await createDuckDbRuntimeFromJsDelivr();
setDuckDbRuntime(runtime);

const result = await queryDatasetWithDuckDb(source.getDataset()!, {
  sql: 'SELECT geometry, name FROM input WHERE active = true',
});
```

The query API accepts a restricted single-`SELECT` contract. Distance-like operations reject geographic CRS by default when their result would otherwise use degrees.

## Optional MapLibre Services

Register MapLibre services through `MapOptions.mapLibre` or `map.mapLibre` when online basemaps or overlays are needed:

```ts
const map = new Emap({
  container: 'map',
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

The integration owns MapLibre source/layer registration, revision cancellation, failure rollback, and camera synchronization. Canvas editing layers remain owned by emap.

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
- `src/map/maplibre-service-manager.ts` owns optional online-service resources and asynchronous rollback.

Geometry edits and attribute edits use separate monotonic version counters. Worker and asynchronous operations must compare both before committing.

## Development

Requirements:

```text
Node.js 24
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

Before changing a mapshaper-backed operation, update its effect classification in `src/map/ops/_runner.ts` and verify history, selection, worker, and stale-operation behavior. See [AGENTS.md](AGENTS.md) for repository rules.

## Security

Report vulnerabilities according to [SECURITY.md](SECURITY.md). Do not enable trusted mapshaper expressions for untrusted configuration, and apply conservative source-size limits when accepting uploads from the public internet.

## License

[MPL-2.0](LICENSE)
