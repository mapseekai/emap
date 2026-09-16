---
id: compatibility
slug: /reference/compatibility
title: Compatibility
api: ["ArcCollection", "ArcCutPoint", "ArcIterator", "ArcVertexData", "ArrowDotPathOptions", "bumpAttributeVersion", "bumpEditVersion", "CanvasPainter", "Coord2", "DataTable", "DefaultMapshaperAdapter", "EditOverlayRenderer", "ExportedFile", "FeatureShape", "GeometryType", "getDefaultMapshaperAdapter", "Handler", "HandlerManager", "HandlerResult", "isHandler", "isPathLayer", "isPointLayer", "LegacyPointShape", "MapshaperAdapter", "MapshaperBBox", "MapshaperDataset", "MapshaperLayer", "MapshaperWorkerPool", "MapshaperWorkerPoolOptions", "NormalizedPointerEvent", "PackedSession", "PathGeometryType", "PathLayer", "PathPart", "PathShape", "PointerModifiers", "PointerMoveEvent", "PointLayer", "PointShape", "PointStyle", "RunnerInputFiles", "SegmentIntersection", "setDefaultMapshaperAdapter", "SignedArcId", "StrokeStyle", "TopologySource.fromBytes", "Transform", "VertexDotStyle", "Emap", "MapOptions", "initParquetWasm", "setParquetWasm", "createDuckDbRuntimeFromJsDelivr"]
examples: ["geoparquet-viewer","web-worker"]
stability: stable
verifiedVersion: 0.12.0
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
| Canvas 2D (`canvas.getContext('2d')`) | Required by browser presets | `CanvasPainter` drawing. |
| `requestAnimationFrame` | Required by browser presets | Batches redraws. |
| Pointer Events, mouse, and wheel events | Interactive presets | Pointer normalization and interaction. |
| `fetch`, `Blob`, `ArrayBuffer`, `Uint8Array` | Data, import/export, snapshots | Fetches data and produces `Blob` values. |
| `DOMParser` | KML import | Parses KML. |
| `Worker` | `useWorker`, GeoPackage Worker, DuckDB | Moves work off the UI thread. |
| WebAssembly | GeoParquet, GeoPackage, DuckDB | Loads WASM runtimes. |

Core maps run on main-thread Canvas 2D; `useWorker` defaults to `false`. Deploy Worker and WASM assets when enabled.

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

Vite, webpack 5, and similar ESM bundlers resolve `parquet-wasm` binaries from module URLs. Node ESM uses matching `Node16` or `NodeNext` values; create browser maps client-side, while `headless` omits `container`.

## Optional peer dependencies

| Entry point or capability | Peer dependencies to install | Runtime assets |
| --- | --- | --- |
| Core `@mapseekai/emap` | None | Browser DOM and Canvas 2D |
| Arrow and GeoArrow from `@mapseekai/emap/arrow` | `apache-arrow` `^17.0.0` | ESM bundle |
| GeoParquet import and export from the Arrow entry point | `apache-arrow` `^17.0.0`, `parquet-wasm` `^0.7.1` | `parquet_wasm_bg.wasm` or explicit `wasmInput` |
| `@mapseekai/emap/duckdb` | `@duckdb/duckdb-wasm` `1.33.1-dev64.0`, `apache-arrow` `^17.0.0` | DuckDB-Wasm Worker, WASM bundle, and optional spatial extension |
| `@mapseekai/emap/maplibre` | `maplibre-gl` `^6.4.1` | Application MapLibre asset configuration |

Install peer dependencies for imported entry points. GeoParquet dynamically loads `parquet-wasm`; without import maps, provide it through `setParquetWasm()` or `window.parquetWasm`.

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
| `jobTimeoutMs` | `number` | `120000` | Request timeout; `0` is unlimited. |

`emap-worker.js` loads adjacent `mapshaper-vendor.js` through relative `importScripts()`.

### `initParquetWasm` and `setParquetWasm` parameters

| API | Parameter | Type | Default | Description |
| --- | --- | --- | --- | --- |
| `initParquetWasm` | `opts` | `InitParquetWasmOptions` | `{}` | Initializes or gets the cached module. |
| `initParquetWasm` | `opts.wasmInput` | `string \| URL \| Request \| Uint8Array \| ArrayBuffer \| WebAssembly.Module` | Module-relative `parquet_wasm_bg.wasm` | WASM input or compiled module. |
| `setParquetWasm` | `mod` | `ParquetWasmModule \| null` | Required | Injects a module; `null` clears the cache. |

## Deployment constraints

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
