---
id: compatibility
slug: /reference/compatibility
title: Compatibility
api: ["RendererBackend", "Emap.getRenderer", "ArcCollection", "ArcCutPoint", "ArcIterator", "ArcVertexData", "ArrowDotPathOptions", "bumpAttributeVersion", "bumpEditVersion", "CanvasPainter", "Coord2", "DataTable", "DefaultMapshaperAdapter", "EditOverlayRenderer", "ExportedFile", "FeatureShape", "GeometryType", "getDefaultMapshaperAdapter", "Handler", "HandlerManager", "HandlerResult", "isHandler", "isPathLayer", "isPointLayer", "LegacyPointShape", "MapshaperAdapter", "MapshaperBBox", "MapshaperDataset", "MapshaperLayer", "MapshaperWorkerPool", "MapshaperWorkerPoolOptions", "NormalizedPointerEvent", "PackedSession", "PathGeometryType", "PathLayer", "PathPart", "PathShape", "PointerModifiers", "PointerMoveEvent", "PointLayer", "PointShape", "PointStyle", "RunnerInputFiles", "SegmentIntersection", "setDefaultMapshaperAdapter", "SignedArcId", "StrokeStyle", "TopologySource.fromBytes", "Transform", "VertexDotStyle", "Emap", "MapOptions", "initParquetWasm", "setParquetWasm", "createDuckDbRuntimeFromJsDelivr"]
examples: ["geoparquet-viewer","web-worker"]
stability: stable
verifiedVersion: 0.13.0
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

The main map defaults to luma WebGL2. `useWorker` still controls data-operation routing, defaults to false, and is not a GPU switch. The browserslist floors above do not guarantee GPU availability: WebGL2 may be disabled, and WebGPU requires an available adapter and a secure context.

## Choose a backend when creating a map

```ts
import { Emap, type RendererBackend } from '@mapseekai/emap';
const renderer: RendererBackend = 'webgl2';
const map = await Emap.create({ container: 'map', renderer });
console.log(map.getRenderer()); // 'webgl2'
```

Every example header offers Canvas2D / WebGL2 / WebGPU buttons. Switching reloads the current
example while preserving other URL parameters; local files must be selected again and unsaved
edits are not retained. Formal map examples support all three backends. The dedicated luma-25d
and luma-vertex-editing experiments are GPU-only and explicitly disable Canvas2D; the formal
vertex-editing example supports all three. Recovery buttons remain available if GPU creation fails.


`renderer` accepts canvas2d, webgl2, or webgpu and defaults to webgl2. Selection is creation-time,
not a hot-swap API. Unsupported or failed GPU initialization rejects Emap.create() and releases resources;
it never silently switches to Canvas2D. A host that needs fallback can catch the failure and explicitly
create a new map with renderer: 'canvas2d'. getRenderer() reports the actual main painter; headless,
empty, disposed maps, and unreported custom painters return null.

Points, paths, fills, icons, and labels draw directly on the selected GPU backend. Existing map services
continue to own selection, editing, filtering and history. Handles, drawing previews, and measurement
hints use the independent Canvas2D overlay, without another map or layer-tree node. The formal raster
service retains its existing read/colorize/reproject tiles and composites them through the selected painter.
Native integer textures, specialized chunk workers, and the 2.5D camera remain separate experimental
paths; choosing a backend does not imply that every experimental optimization has migrated.

GPU labels lazily load the MSDF Worker. Deploy dist/emap-msdf-worker.js with its sibling dist/msdf/
directory. Direct package deployment resolves the worker beside the module; bundlers that rearrange
assets should set msdfWorkerUrl: '/assets/emap-msdf-worker.js' and deploy msdf/ beside that worker.
Disabled labels start no font worker; font errors affect labels only, never silently change the backend.

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
| Core `@mapseekai/emap` | None | DOM, Canvas2D overlay, and the selected GPU backend |
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
