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

### Local raster files

The optional [`/geotiff` integration](packages/docs/docs/data/geotiff.md) reads local GeoTIFF/BigTIFF windows in a Worker without copying original bytes into browser storage. Files strictly above 2GiB require valid internal or external pyramids before decoding. Use `rasterPlugin()` with `geoTIFFPlugin()`; deploy `emap-geotiff-worker.js`. Host projects store external references rather than raster pixels. High-depth values auto-stretch to display bytes without changing samples; navigation preserves existing coverage, then presents each ready tile with clipped old-resolution fallback for unfinished regions. Try the numeric TIFF fixtures and RGB/single-band channel selectors in `geotiff-viewer`. Current inputs must be north-up; the guide lists unsupported TIFF variants and unbenchmarked large-file limits.

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

const map = await Emap.create({
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
await map.dispose();
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
const map = await Emap.create({
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
await map.ctx.plugin(arrowFormatsPlugin);
// For optional-format input loaded before addSource:
const optionalSource = new TopologySource('upload', { formats: map.formats });
import { fromArrowTable, toArrowTable } from '@mapseekai/emap/arrow';
```

`parquet-wasm` loads on first GeoParquet use; applications that never import this entry point never execute the format module.

## Direct GeoPackage vector import

The optional `/geopackage` entry reads NGA SQLite WASM → GP Binary/WKB → TypedArrays without a GeoJSON intermediate. All feature tables remain layers in one dataset with shared arcs. Main-thread and Web Worker APIs are provided; raster/tile tables are excluded.

```ts
import { geoPackagePlugin } from '@mapseekai/emap/geopackage';
await map.ctx.plugin(geoPackagePlugin({
  workerUrl: '/assets/emap-geopackage-worker.js',
  wasmUrl: '/assets/sql-wasm.wasm',
}));
const source = new TopologySource('gpkg', { formats: map.formats });
await source.setData({ filename: file.name, content: new Uint8Array(await file.arrayBuffer()) });
await map.addSource('gpkg', source);
```

[Assets, CRS, multi-layer, Z/M and memory contracts](packages/docs/i18n/en/docusaurus-plugin-content-docs/current/data/geopackage.md).

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

const map = await Emap.create({
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
- [Quick start](packages/docs/docs/getting-started/quick-start.md)
- [Core concepts](packages/docs/docs/concepts/emap.md)
- [Architecture and source layout](packages/docs/docs/concepts/architecture.md)
- [Editing](packages/docs/docs/guides/editing.md)
- [Styling](packages/docs/docs/guides/styling.md)
- [Worker execution](packages/docs/docs/guides/worker.md)
- [DuckDB](packages/docs/docs/data/duckdb.md)
- [Compatibility](packages/docs/docs/reference/compatibility.md)
- [Runnable examples](packages/examples/examples)
- [llms.txt](https://mapseekai.github.io/mapseekai/emap/llms.txt) — docs site index for AI coding assistants

## Architecture

`Emap` is the public façade. Internally, the repository is organized into six first-level responsibility zones so runtime composition, engine hot paths, domain state, integrations, UI, and shared declarations are visually distinct:

```text
src/
├── domain/          # GIS source/geometry/edit/validation domain
├── engine/          # Map execution, interaction, rendering, worker, built-in providers
├── runtime/         # Native Cordis context/services/plugins/presets/AI capabilities
├── integrations/    # Mapshaper, MapLibre, Arrow, DuckDB, GeoPackage
├── ui/              # Controls, icons, CSS, theme
├── shared/          # Ambient declarations and cross-layer type boundaries
└── index.ts         # Explicit root public API
```

The runtime uses upstream `cordis@4.0.0-rc.10` directly. `map.ctx` is the native `Context`; services use Context declaration merging and `ctx.provide()`, features/providers use native `inject/apply/effect`, and lifecycle is represented by native `Fiber`. There is no custom PluginRuntime, service registry, or compatibility graph.

The main execution flow remains direct and GIS-oriented:

```text
DOM pointer input
  → engine/core handlers
  → validated edit plan or engine/map operation
  → domain EditCommand / operation runner
  → source version checks, history, transaction, selection
  → render invalidation
  → RenderScheduler
  → layer renderer / CanvasPainter
```

Important boundaries:

- `src/domain/source/` owns imported topology, CRS metadata, format-bound source state, and display-arc lifecycle.
- `src/domain/edit/commands/` owns reversible live data changes; `src/domain/geo/` owns coordinate/projection math.
- `src/engine/map/ops/` owns mapshaper-backed operation orchestration; `src/engine/core/handlers/` owns browser interaction; `src/engine/rendering/` owns Canvas rendering.
- `src/runtime/` owns Cordis composition only: service contracts, providers, feature plugins, presets, and AI capability registration.
- `src/integrations/mapshaper/adapter.ts` is the normal bridge to `mapshaper.internal.*`; MapLibre, Arrow, and DuckDB are explicit integration boundaries.
- Public package subpaths (`/context`, `/services`, `/providers`, `/plugins`, `/presets`, `/ai`, `/maplibre`, `/arrow`, `/duckdb`, `/geopackage`) are stable package entry points and do not mirror internal folders one-for-one.

Unit tests are colocated as `foo.ts` + `foo.test.ts`, with at most one unit test file per implementation. Cross-module regression/integration tests live under `test/integration/`; browser, package/build, type-contract, docs, examples, and security checks live in their dedicated `test/` subdirectories. `test-layout:check` and `typecheck:contracts` enforce this layout.

See [Current architecture and source layout](packages/docs/docs/concepts/architecture.md).

## Development

Requirements:

```text
Node.js 22.18–24
pnpm 11.15.1
```

Install dependencies, then select checks relevant to the change from this command
catalog. This is not a mandatory sequence for every task; see
[verification rules](AGENTS.md#verification). Release preparation requires the
complete gate in the [release checklist](docs/release-checklist.md).

```bash
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run typecheck
pnpm run typecheck:contracts
pnpm run typecheck:examples
pnpm run test-layout:check
pnpm run architecture:check
pnpm run capabilities:check
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

DuckDB integration suites run under `pnpm run test:duckdb`, which sets `DUCKDB_WASM_INTEGRATION=1` across `src/integrations/duckdb` and `test/integration/duckdb`.

For mapshaper-backed operation changes, follow [code conventions](AGENTS.md#hard-rules--code-conventions) and verify affected history, selection, worker, and stale-operation behavior.

## Security

Report vulnerabilities according to [SECURITY.md](SECURITY.md). Keep mapshaper expressions disabled for untrusted configuration, and apply conservative source-size limits when accepting uploads from the public internet.

## License

[MPL-2.0](LICENSE)
