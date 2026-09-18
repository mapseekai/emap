---
id: intro
slug: /
title: Introduction
api: ["Emap", "LayerSpecification", "TopologySource"]
examples: ["china-editing","export-formats","getting-started/geojson-viewer"]
stability: stable
verifiedVersion: 0.13.0
---

# Emap

`@mapseekai/emap` is a browser TypeScript map engine for loading, rendering, editing, and analyzing vector data; data lives in undoable mapshaper topology datasets.

```ts
import { Emap, TopologySource } from '@mapseekai/emap'; // import the map and data source
import '@mapseekai/emap/style.css'; // import control and editing styles
const map = await Emap.create({ container: 'map' }); // create an interactive map
const source = await TopologySource.fromUrl('main', '/data/roads.geojson'); // load GeoJSON
await map.addSource('main', source); // register the data source
map.addLayer({ id: 'roads', type: 'line', source: 'main' }); // render the source
```

## Core methods

| Method | Parameters | Description |
| --- | --- | --- |
| `Emap.create(options)` | `EmapOptions` | Create the map and preset runtime. |
| `TopologySource.fromUrl(id, url, options?)` / `fromBytes(id, bytes, options?)` | Source ID, input | Import data. |
| `map.addSource(id, source)` / `map.addLayer(spec)` | Source ID, object | Register data and create a render layer. |

Applications own their UI; Emap provides the map, data, interaction, and plugin runtime.

## More data formats and sources

`TopologySource` imports and exports data; see [Data formats](./data/formats.md).

| Entry point / parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `TopologySource.fromUrl(id, url, options)` | `id: string`, `url: string` | Required | Imports from a URL; `id` identifies sources and render layers. |
| `TopologySource.fromBytes(id, bytes, options)` | `bytes: Uint8Array \| ArrayBuffer` | Required | Imports bytes; the `filename` extension selects the importer. |
| `options.formats` | `FormatRegistryContract` | Empty registry | Plugin format registry. |
| `options.resourceLimits` / `zipLimits` / `adapter` | `Partial<ImportResourceLimits>` / `ZipExtractionLimits` / `MapshaperAdapter` | 2 GiB input limit / see detail page / default adapter | Import and ZIP limits; execution adapter. |

The core package reads and writes GeoJSON, TopoJSON, Shapefile ZIP, and mapshaper snapshots (`.msx`), and imports KML. `/arrow` adds GeoArrow and GeoParquet, `/geopackage` imports GeoPackage vector tables, and plugins add FlatGeobuf. `source.export(options)` returns a `Blob`.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `format` | `ExportFormat` | Required | `geojson`, `topojson`, `shapefile`, `msx`; optional formats come from entry points or plugins. |
| `layer` | `number \| string` | `0` | GeoParquet / GeoArrow export layer index or name. |
| `encoding` | `'wkb' \| 'native'` | `'wkb'` for GeoParquet; `'native'` for GeoArrow | Columnar geometry encoding. |
| `quantization` | `boolean` | `false` | TopoJSON coordinate quantization. |

## More layers and styling

`map.addLayer(spec)` adds a `LayerSpecification`; `setPaintProperty`, `setFilter`, and `setLayerVisibility` update it. See [Styling](./guides/styling.md).

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `id` / `type` / `source` | `string` / `'fill' \| 'line' \| 'circle'` / `string` | Required | Unique layer ID, renderer, and source ID. |
| `'source-layer'` | `string` | First source layer | mapshaper layer in the source. |
| `layout.visibility` | `'visible' \| 'none'` | `'visible'` | Drawing, picking, and attribute-view switch. |
| `filter` / `styleSource` | `StyleExpression` / `'mapshaper'` | Unset | Feature filter or baked `fill` / `stroke`. |
| `pointLod` (circle only) | `false \| { cellSize?: number }` | `{ cellSize: 8 }` | CSS-pixel grid thinning; `cellSize` is `1–64`. |

| Layer | `paint` parameters | Type | Default |
| --- | --- | --- | --- |
| `fill` | `fill-color`, `fill-opacity` | `string \| StyleExpression`, `number` | Theme muted color, `1`. |
| `line` | `line-color`, `line-width`, `line-dasharray`, `line-dashstyle` | `string \| StyleExpression`, `number`, `readonly number[]`, `LineDashStyle \| StyleExpression` | Theme primary color, `0.8` CSS px, solid. |
| `line` | `line-arrow-spacing`, `line-arrow-size` | `number`, `number` | `32`, `6` CSS px. |
| `circle` | `circle-color`, `circle-radius`, `circle-fill`, `circle-shape` | `string \| StyleExpression`, `number`, `boolean`, `PointMarkerShape \| StyleExpression` | Theme primary color, `4` CSS px, `true`, `'circle'`. |

## More editing, history, and data operations

`drawFeature`, `vertexEdit`, `splitFeature`, `reshapeFeature`, `autoCompletePolygon`, `ringEdit`, `partEdit`, and `transformFeature` are enableable handlers. `setOptions()` sets drawing target and snapping; see [Editing](./guides/editing.md).

| Entry point / parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `undo()` / `redo()` / `canUndo()` / `canRedo()` | `() => boolean` | — | Undo, redo, and history state. |
| `beginTransaction()` | `() => Transaction` | — | Batch commands or restore data and selection. |
| `pushCommand(command)` | `EditCommand` | — | Undoable-history entry point. |

The 45 `map.ops` methods return `Promise<OpResult>` and synchronize history and selection. See [Data operations](./data/operations.md).

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `source` / `target` | `string` / `string` | Usually required | Source ID and target source layer. |
| `mask` / `bbox` for `clipLayer` / `eraseLayer` | `string` / `[number, number, number, number]` | Choose one | Polygon layer or source-coordinate extent. |
| `field` / `fields` for `dissolveLayer` | `string` / `string[]` | Ungrouped | One or more grouping fields. |
| `radius` for `bufferLayer` | `number \| string` | Required | Radius or mapshaper expression. |
| `percentage` / `interval` / `resolution` for `simplifyLayer` | `number` | Choose one | Retained percentage, threshold, or resolution. |
| `map.ops.withSignal(signal)` | `AbortSignal` | — | Long-operation cancellation scope. |

## More runtime and extensions

`Emap.create(options)` mounts a preset and returns after `map.ready`; `map.ctx` is the Cordis `Context`. See [Plugins](./guides/plugins.md) for plugins, Agent capabilities, and MapLibre.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `container` | `string \| HTMLElement` | Required by browser presets | Canvas container; omit for `headless`. |
| `preset` | `'editor' \| 'viewer' \| 'headless' \| 'empty'` | `'editor'` | Editing, viewing, DOM-free processing, or application-plugin start. |
| `interactive` | `boolean` | `true` | Built-in drag and scroll interaction. |
| `expressionPolicy` | `'disabled' \| 'trusted'` | `'disabled'` | mapshaper JavaScript-expression policy. |
| `useWorker` / `workerThreshold` / `workerUrl` | `boolean \| 'auto'` / `number` / `string` | `false` / `50000` / `'emap-worker.js'` | Main-thread, Worker, or threshold routing; URL resolves from `document.baseURI`. |
| `workerPoolSize` / `workerPool` / `workerRouting` | `number` / `MapshaperWorkerPool` / `WorkerRoutingFn` | `1` / unset / engine decision | Worker concurrency, dedicated pool, or per-call routing. |
| `plugins` / `excludePlugins` | `readonly Plugin[]` / `readonly string[]` | `[]` / `[]` | Replace or exclude preset plugins. |
| `authorizeCapability` / `mapLibre` | `CapabilityAuthorizer` / `MapLibreIntegrationOptions` | Unset | Agent authorization and MapLibre configuration. |

## Start here

1. [Install](./getting-started/installation.md).
2. [Your first map](./getting-started/quick-start.md).
3. [Concepts overview](./concepts/overview.md).
4. See [Styling](./guides/styling.md), [Selection](./guides/selection.md), [Editing](./guides/editing.md), and [Data operations](./data/operations.md).
5. [Architecture](./concepts/architecture.md).
6. AI coding-assistant index: [llms.txt](pathname:///llms.txt) ([view online](pathname:///llms.html)).

## Runnable examples

- [Examples](/mapseekai/emap/examples/)
