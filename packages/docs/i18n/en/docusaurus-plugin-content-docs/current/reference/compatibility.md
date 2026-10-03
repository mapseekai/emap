---
id: compatibility
slug: /reference/compatibility
title: Compatibility
api: ["RendererBackend", "Emap.getRenderer", "ArcCollection", "ArcCutPoint", "ArcIterator", "ArcVertexData", "ArrowDotPathOptions", "bumpAttributeVersion", "bumpEditVersion", "CanvasPainter", "Coord2", "DataTable", "DefaultMapshaperAdapter", "EditOverlayRenderer", "ExportedFile", "FeatureShape", "GeometryType", "getDefaultMapshaperAdapter", "Handler", "HandlerManager", "HandlerResult", "isHandler", "isPathLayer", "isPointLayer", "LegacyPointShape", "MapshaperAdapter", "MapshaperBBox", "MapshaperDataset", "MapshaperLayer", "MapshaperWorkerPool", "MapshaperWorkerPoolOptions", "NormalizedPointerEvent", "PackedSession", "PathGeometryType", "PathLayer", "PathPart", "PathShape", "PointerModifiers", "PointerMoveEvent", "PointLayer", "PointShape", "PointStyle", "RunnerInputFiles", "SegmentIntersection", "setDefaultMapshaperAdapter", "SignedArcId", "StrokeStyle", "TopologySource.fromBytes", "Transform", "VertexDotStyle", "Emap", "MapOptions", "initParquetWasm", "setParquetWasm", "createDuckDbRuntimeFromJsDelivr"]
examples: ["geoparquet-viewer","web-worker"]
stability: stable
verifiedVersion: 0.14.0
---

# Compatibility

Browser rendering requires a sized DOM container, Canvas 2D, and ES modules; published code and TypeScript target ES2022.

## Core environment requirements

### Browser version floors

Version floors come from the root `package.json` `browserslist`:

| Environment | Minimum version | Basis and use case |
| --- | --- | --- |
| Chrome | 109 | Canvas, ES modules, and optional Workers. |
| Edge | 109 | Canvas, ES modules, and optional Workers. |
| Firefox | 115 | Canvas, ES modules, and optional Workers. |
| Safari | 16.4 | Canvas, ES modules, and optional Workers. |
| Node.js | `>=22.18 <25` | Development, builds, and releases. |
| TypeScript | ES2022 + DOM + DOM.Iterable, `strict: true` | Types and package exports. |

### Core browser APIs

| API or capability | Scope | Emap use and scenario |
| --- | --- | --- |
| `document`, `HTMLElement`, `HTMLCanvasElement` | Required by browser presets | Creates canvases, controls, and overlays. |
| Canvas 2D (`canvas.getContext('2d')`) | Required by browser presets | Canvas2D mode, editing/measurement affordances, and color parsing. |
| `requestAnimationFrame` | Required by browser presets | Batches redraws. |
| Pointer Events, mouse, and wheel events | Interactive presets | Pointer normalization and interaction. |
| `fetch`, `Blob`, `ArrayBuffer`, `Uint8Array` | Data, import/export, snapshots | Fetches data and produces `Blob` values. |
| `DOMParser` | KML import | Parses KML. |
| `Worker` | `useWorker`, GeoPackage Worker, DuckDB | Moves work off the UI thread. |
| WebAssembly | GeoParquet, GeoPackage, DuckDB | Loads WASM runtimes. |

The main map defaults to luma WebGL2. Configure `renderer` for drawing and `useWorker` for data-operation routing; `useWorker` defaults to `false`. GPU rendering requires browser and device support: WebGL2 must be enabled, and WebGPU requires an available adapter and a secure context.

## Choose a backend when creating a map

```ts
import { Emap, type RendererBackend } from '@mapseekai/emap';
const renderer: RendererBackend = 'webgl2';
const map = await Emap.create({ container: 'map', renderer });
console.log(map.getRenderer()); // 'webgl2'
```

Example headers provide Canvas2D / WebGL2 / WebGPU buttons. Switching reloads the example
and preserves other URL parameters. Save edits before switching and select local files again
after the reload. Formal map examples support all three backends. The luma-25d and
luma-vertex-editing experiments offer GPU backends; use the formal vertex-editing example
to compare all three. Recovery buttons remain available if GPU creation fails.

`renderer` accepts `canvas2d`, `webgl2`, or `webgpu` and defaults to `webgl2`.
Set it when creating a map; changing the backend requires a new map instance.
If GPU initialization fails, `Emap.create()` rejects and releases resources.
The host controls fallback: catch the failure and explicitly create a map with
`renderer: 'canvas2d'`. `getRenderer()` reports the actual main painter; headless,
empty, disposed maps, and custom painters with an unspecified backend return `null`.

Points, paths, fills, icons, and labels draw directly on the selected GPU backend.
Map services manage selection, editing, filtering, and history. Handles, drawing
previews, and measurement hints share an independent Canvas2D overlay on the map.
The raster service reads, colorizes, and reprojects tiles for the selected painter
to composite. Native integer textures, specialized chunk workers, and the 2.5D
camera are available through their separate experimental paths.

GPU labels load the MSDF Worker when enabled. Deploy `dist/emap-msdf-worker.js`
with its sibling `dist/msdf/` directory. Direct package deployment resolves the
worker beside the module; bundlers that rearrange assets should set
`msdfWorkerUrl: '/assets/emap-msdf-worker.js'` and deploy `msdf/` beside that worker.
Font errors are scoped to labels; the selected renderer continues to handle the map.

## Bundlers and TypeScript

The root and feature entry points publish through package `exports`; browser bundlers should resolve ESM and subpaths:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

Vite, webpack 5, and similar ESM bundlers resolve `parquet-wasm` binaries from module URLs. Public declarations use extensionless relative imports; use the verified browser configuration above. Create maps client-side; `headless` provides a browser data workspace with an optional `container`.

## Peer dependency configuration

| Entry point or capability | Peer dependencies to install | Runtime assets |
| --- | --- | --- |
| Core `@mapseekai/emap` | `maplibre-gl` `^6.4.1` for public types | DOM, Canvas2D overlay, and the selected GPU backend |
| Arrow and GeoArrow from `@mapseekai/emap/arrow` | `apache-arrow` `^17.0.0` | ESM bundle |
| GeoParquet import and export from the Arrow entry point | `apache-arrow` `^17.0.0`, `parquet-wasm` `^0.7.1` | `parquet_wasm_bg.wasm` or explicit `wasmInput` |
| `@mapseekai/emap/duckdb` | `@duckdb/duckdb-wasm` `1.33.1-dev64.0`, `apache-arrow` `^17.0.0` | DuckDB-Wasm Worker, WASM bundle, and optional spatial extension |
| `@mapseekai/emap/maplibre` | `maplibre-gl` `^6.4.1` | Application MapLibre asset configuration |

The core MapLibre peer supplies public types; register the MapLibre plugin to enable basemaps. Install additional peers for imported feature entry points. GeoParquet dynamically loads `parquet-wasm`; provide it through import maps, `setParquetWasm()`, or `window.parquetWasm`.

## Worker and WASM assets

### Worker parameters in `MapOptions`

Browser-map compatibility parameters:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `container` | `string \| HTMLElement` | Required | Browser host with actual dimensions. |
| `interactive` | `boolean` | `true` | Enables built-in pan and scroll zoom. |
| `useWorker` | `boolean \| 'auto'` | `false` | dataset-replace Worker routing. |
| `workerThreshold` | `number` | `50000` | `'auto'` vertex threshold. |
| `workerUrl` | `string` | `'emap-worker.js'` | Worker bundle URL. |
| `workerPoolSize` | `number` | `1` | Maximum Worker count. |
| `workerPool` | `MapshaperWorkerPool` | `undefined` | Prebuilt Worker pool. |
| `workerRouting` | `WorkerRoutingFn` | `undefined` | Custom `'auto'` routing. |

`'auto'` routes from `workerThreshold`; pools create Workers lazily.

### `MapshaperWorkerPool` parameters

Manage mapshaper threads directly with `new MapshaperWorkerPool(options)`.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `workerUrl` | `string` | Required | `emap-worker.js` URL. |
| `WorkerCtor` | `typeof Worker` | Global `Worker` | Custom Worker constructor. |
| `poolSize` | `number` | `1` | Maximum threads, at least one. |
| `jobTimeoutMs` | `number` | `120000` | Request timeout in milliseconds; integer from `1` to `2147483647`. |

`emap-worker.js` loads adjacent `mapshaper-vendor.js` through relative `importScripts()`.

### `initParquetWasm` and `setParquetWasm` parameters

| API | Parameter | Type | Default | Description |
| --- | --- | --- | --- | --- |
| `initParquetWasm` | `opts` | `InitParquetWasmOptions` | `{}` | Initializes or gets the cached module. |
| `initParquetWasm` | `opts.wasmInput` | `string \| URL \| Request \| Uint8Array \| ArrayBuffer \| WebAssembly.Module` | Module-relative `parquet_wasm_bg.wasm` | WASM input or compiled module. |
| `setParquetWasm` | `mod` | `ParquetWasmModule \| null` | Required | Injects a module; `null` clears the cache. |

## Deployment configuration

| Item | Applies to | Note |
| --- | --- | --- |
| Static asset paths | mapshaper Worker | Publish `emap-worker.js` and adjacent `mapshaper-vendor.js`. |
| Static asset paths and MIME | GeoPackage | Publish Worker, vendor, and WASM; serve WASM as `application/wasm`. |
| CSP Worker policy | mapshaper, GeoPackage, DuckDB | Allow Worker scripts and DuckDB `blob:` URLs. |
| CSP network policy | URL data, WASM, DuckDB spatial extension | Allow asset origins. |
| Asset origin | Every Worker/WASM path | Deploy browser-loadable URLs. |
| Memory and threads | Large data, GeoPackage, DuckDB | Workers, WASM, and input copies use memory. |

Call version functions after direct dataset mutation to refresh caches:

| API | Parameter | Type | Default | Description |
| --- | --- | --- | --- | --- |
| `bumpEditVersion` | `dataset` | `MapshaperDataset \| null \| undefined` | Required | Updates geometry version and spatial-index cache. |
| `bumpAttributeVersion` | `dataset` | `MapshaperDataset \| null \| undefined` | Required | Updates attribute version and style cache. |

## API

- [src.MapOptions](/mapseekai/emap/api/interfaces/emap.MapOptions.html)
- [src.MapshaperWorkerPool](/mapseekai/emap/api/classes/emap.MapshaperWorkerPool.html)
- [src_arrow.initParquetWasm](/mapseekai/emap/api/functions/arrow.initParquetWasm.html)

## Runnable examples

- [geoparquet-viewer](/mapseekai/emap/examples/geoparquet-viewer/)
- [web-worker](/mapseekai/emap/examples/web-worker/)
