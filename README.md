# emap

<p align="center">
  <img src="packages/examples/public/emap.svg" alt="Emap logo" width="144" />
</p>

[简体中文](README.zh-CN.md)

`@mapseekai/emap` is a browser-based TypeScript engine for rendering, querying, analysing, and editing topology-oriented vector data. It stores data in mapshaper topology structures, renders editable layers with Canvas2D, WebGL2, or WebGPU (default WebGL2), and runs data processing and map interaction locally in the browser.

## What emap supports

- **Data formats**: GeoJSON, TopoJSON, Shapefile ZIP, KML, and MSX snapshots out of the box; GeoArrow and GeoParquet through the optional `@mapseekai/emap/arrow` entry.
- **Layers**: `fill`, `line`, and `circle` layers with selectable rendering backends, with viewport culling, simplification-aware display arcs, and attribute-driven fill buckets.
- **Styling and symbols**: attribute expressions, classified colors, dashed and arrowed lines, point markers, labels, and image symbols.
- **Local raster**: Worker-based GeoTIFF/BigTIFF window reads, pyramids, band selection, and progressive display through `/geotiff`.
- **GeoPackage**: multi-layer vector import through `/geopackage`, with shared topology and main-thread or Worker execution.
- **Editing**: select, draw, translate, rotate, scale, split, merge, reshape, auto-complete polygons, and edit vertices, rings, holes, and multipart geometry.
- **History**: editing commands and dataset operations support undo, redo, transactions, validation, and selection restoration.
- **Dataset operations**: `map.ops` exposes clip, erase, dissolve, buffer, filter, simplify, classify, join, projection, repair, and ring/part operations (see `MapshaperOps` in the API reference).
- **Execution**: dataset operations can run in a Web Worker with stale-result protection.
- **Analysis**: optional DuckDB-Wasm SQL and spatial operations through the typed `@mapseekai/emap/duckdb` entry.
- **Basemaps**: optional MapLibre services for raster/vector basemaps and online overlays; editable data layers stay managed by emap.

### Local raster files

The optional [`/geotiff` integration](https://mapseekai.github.io/mapseekai/emap/en/data/geotiff) reads local GeoTIFF/BigTIFF windows in a Worker directly from file references. Files strictly above 2GiB require valid internal or external pyramids before decoding. Use `rasterPlugin()` with `geoTIFFPlugin()`; deploy `emap-geotiff-worker.js`. Host projects store external file references and display settings. High-depth values auto-stretch to display bytes while preserving original samples; navigation preserves existing coverage, then presents each ready tile with clipped old-resolution fallback for unfinished regions. Try the numeric TIFF fixtures and RGB/single-band channel selectors in `geotiff-viewer`. Use north-up grids and select input files according to the supported encodings, pyramid requirements, and resource budgets in the guide.

## What you can build

| Workflow | Capabilities to combine |
| --- | --- |
| Local data viewer | File import, multiple sources/layers, automatic extent fitting, attribute inspection, and format export |
| Interactive map editor | Selection, snapping, drawing, vertex editing, validation, undo/redo, and transactions |
| Thematic map | Attribute classification, expression-based styles, labels, symbols, and visibility filters |
| Browser GIS analysis | Typed dataset operations, projection, joins, and the DuckDB spatial toolbox |
| Mixed vector/raster workspace | Editable vector layers, GeoTIFF windows and bands, and MapLibre basemaps |
| Extensible application | Cordis services/plugins, configurable presets, controls, events, and typed AI capability registration |

Select a renderer when creating the map. The three renderers share sources,
styles, selection, editing, and history services. The
[renderer guide](docs/renderer-backends.md) covers deployment assets and browser
adapter requirements; the [examples](packages/examples/examples) provide runnable workflows.

## Install

```bash
pnpm add @mapseekai/emap
```

The package declares `maplibre-gl` as a required peer for its public types. npm and pnpm normally install it automatically; enable online basemaps by registering `mapLibrePlugin`.

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
  renderer: 'webgl2', // Default; also accepts 'canvas2d' and 'webgpu'
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

ZIP imports accept up to 2 GiB compressed input and 2 GiB total uncompressed content by default; pass `zipLimits` to tighten them for public uploads. Give each archive entry a unique basename; import validation reports naming conflicts explicitly.

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

Operations return `OpResult`; inspect `ok` for success and handle thrown exceptions with `try/catch`.
`source` is the registered source ID and `target` is its data layer name or ID.
Commit or roll back an open transaction before invoking undo/redo, clearing history,
or replacing external input. External dataset replacement starts a fresh history,
selection, and highlight state for that source; command undo/redo restores the
state associated with the edit.

The default `expressionPolicy: 'disabled'` keeps JavaScript expression execution under application control. Use `expressionPolicy: 'trusted'` for first-party, reviewed expressions whose configuration and data are fully controlled by the application.

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

`fill-color` accepts the operators listed in the styling guide. The dedicated expression evaluator validates them and caches results against the dataset attribute version.

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

Mounting `arrowFormatsPlugin` registers the formats in the workspace; `parquet-wasm` loads on first GeoParquet use.

## Direct GeoPackage vector import

The optional `/geopackage` entry converts vector feature tables directly through NGA SQLite WASM → GP Binary/WKB → TypedArrays. All feature tables remain layers in one dataset with shared arcs. Both main-thread and Web Worker APIs support this vector workflow.

```ts
import { geoPackagePlugin } from '@mapseekai/emap/geopackage';
await map.ctx.plugin(
  geoPackagePlugin({
    workerUrl: '/assets/emap-geopackage-worker.js',
    wasmUrl: '/assets/sql-wasm.wasm',
  }),
);
const source = new TopologySource('gpkg', { formats: map.formats });
await source.setData({ filename: file.name, content: new Uint8Array(await file.arrayBuffer()) });
await map.addSource('gpkg', source);
```

[Assets, CRS, multi-layer, Z/M and memory contracts](https://mapseekai.github.io/mapseekai/emap/en/data/geopackage).

## Optional DuckDB-Wasm

Install the runtime peers before importing the DuckDB subpath:

```bash
pnpm add @duckdb/duckdb-wasm apache-arrow
```

```ts
import { createDuckDbRuntimeFromJsDelivr, attributeFilter } from '@mapseekai/emap/duckdb';

const runtime = await createDuckDbRuntimeFromJsDelivr();

const result = await attributeFilter(
  source.getDataset()!,
  {
    sql: 'SELECT geometry, name FROM input WHERE active = true',
  },
  runtime,
);
```

The attribute-filter API accepts one validated `SELECT` statement using its documented tables, columns, and functions. The DuckDB processing toolbox exposes overlay, proximity, aggregate, join, geometry, transform, selection, and data-management operations. Use a projected CRS for distance-like operations so the results use the projection’s linear units; CRS validation checks this prerequisite.

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

- [Installation](https://mapseekai.github.io/mapseekai/emap/en/getting-started/installation)
- [Quick start](https://mapseekai.github.io/mapseekai/emap/en/getting-started/quick-start)
- [Core concepts](https://mapseekai.github.io/mapseekai/emap/en/concepts/emap)
- [Architecture and source layout](https://mapseekai.github.io/mapseekai/emap/en/concepts/architecture)
- [Editing](https://mapseekai.github.io/mapseekai/emap/en/guides/editing)
- [Styling](https://mapseekai.github.io/mapseekai/emap/en/guides/styling)
- [Worker execution](https://mapseekai.github.io/mapseekai/emap/en/guides/worker)
- [DuckDB](https://mapseekai.github.io/mapseekai/emap/en/data/duckdb)
- [Compatibility](https://mapseekai.github.io/mapseekai/emap/en/reference/compatibility)
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

The runtime uses upstream `cordis@4.0.0-rc.10` directly. `map.ctx` is the native `Context`; services use Context declaration merging and `ctx.provide()`, features/providers use native `inject/apply/effect`, and lifecycle is represented by native `Fiber`. Cordis owns plugin dependencies, service availability, effects, and disposal.

The main execution flow remains direct and GIS-oriented:

```text
DOM pointer input
  → engine/core handlers
  → validated edit plan or engine/map operation
  → domain EditCommand / operation runner
  → source version checks, history, transaction, selection
  → render invalidation
  → RenderScheduler
  → layer renderer / CanvasPainter or LumaPainter
```

Responsibilities:

- `src/domain/source/` owns imported topology, CRS metadata, format-bound source state, and display-arc lifecycle.
- `src/domain/edit/commands/` owns reversible live data changes; `src/domain/geo/` owns coordinate/projection math.
- `src/engine/map/ops/` owns mapshaper-backed operation orchestration; `src/engine/core/handlers/` owns browser interaction; `src/engine/rendering/` owns rendering orchestration and painter contracts.
- `src/runtime/` owns Cordis composition only: service contracts, providers, feature plugins, presets, and AI capability registration.
- `src/integrations/mapshaper/adapter.ts` is the normal bridge to `mapshaper.internal.*`; MapLibre, Arrow, and DuckDB are explicit integration boundaries.
- Public package subpaths (`/context`, `/services`, `/providers`, `/plugins`, `/presets`, `/ai`, `/maplibre`, `/arrow`, `/duckdb`, `/geopackage`) provide stable package entry points organized by capability.

Unit tests are colocated as `foo.ts` + `foo.test.ts`, with at most one unit test file per implementation. Cross-module regression/integration tests live under `test/integration/`; browser, package/build, type-contract, docs, examples, and security checks live in their dedicated `test/` subdirectories. `test-layout:check` and `typecheck:contracts` enforce this layout.

See [Current architecture and source layout](https://mapseekai.github.io/mapseekai/emap/en/concepts/architecture).

## Development

Requirements:

```text
Node.js 22.18–24
pnpm 11.15.1
```

Install dependencies, then select checks relevant to the change from this command
catalog. Choose the scope using the
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
pnpm run examples:verify
pnpm run audit:prod
pnpm pack --dry-run
```

Start or build examples locally:

```bash
pnpm run examples:dev
pnpm run examples:build
```

Generated TypeDoc files under `dist/api/` are ignored and regenerated by `api:build`. Website source, translations, themes, and deployment belong to the separate `emap-web` project.

DuckDB integration suites run under `pnpm run test:duckdb`, which sets `DUCKDB_WASM_INTEGRATION=1` across `src/integrations/duckdb` and `test/integration/duckdb`.

For mapshaper-backed operation changes, follow [code conventions](AGENTS.md#hard-rules--code-conventions) and verify affected history, selection, worker, and stale-operation behavior.

## Security

Report vulnerabilities according to [SECURITY.md](SECURITY.md). Use `expressionPolicy: 'disabled'` for externally supplied configuration and set upload-size budgets appropriate to your application.

## License

[MPL-2.0](LICENSE)
