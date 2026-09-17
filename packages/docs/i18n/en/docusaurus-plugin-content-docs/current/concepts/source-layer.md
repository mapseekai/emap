---
id: source-layer
slug: /concepts/source-layer
title: Sources and layers
api: ["CirclePaint", "DatasetFormatPlugin", "Emap", "ExportedFormatFile", "ExportFormat", "ExportOptions", "FillPaint", "ITopologySource", "LayerLayout", "LayerPaint", "LayerSpecification", "LayerType", "LinePaint", "ReadySourceLoadPlan", "registerFormat", "ReplaceableTopologySource", "resolvePointStyle", "resolveStrokeStyle", "SourceLoadAnswers", "SourceLoadDiagnostic", "SourceLoadDiagnosticCode", "SourceLoadDraft", "SourceLoadError", "SourceLoadRequest", "SourceLoadRequirement", "SourceLoadSummary", "SourcePreflightResult", "TopologySource", "TopologySource.fromBytes", "TopologySource.fromUrl", "TopologySourceData", "TopologySourceFromBytesOptions", "TopologySourceInput", "TopologySourceOptions", "ImportResourceLimits", "ZipExtractionLimits"]
examples: ["getting-started/geojson-viewer","getting-started/lines","getting-started/points","merge-layers"]
stability: stable
verifiedVersion: 0.12.0
---

# Sources and layers

Emap separates geospatial data from presentation: `TopologySource` holds a mapshaper dataset, source layers hold geometry and attributes, and `LayerSpecification` declares rendering.

```ts
const source = await TopologySource.fromUrl('roads', '/data/roads.geojson'); // import data from a URL
await map.addSource('roads', source); // register it under a map source ID
map.addLayer({
  // declare a render layer for the data
  id: 'roads-line', // use a unique render layer ID
  type: 'line', // choose the line renderer
  source: 'roads', // reference the registered map source ID
  paint: { 'line-color': '#166534', 'line-width': 1 }, // set line styling
});
```

## Core methods

| API | Parameters | Default | Description |
| --- | --- | --- | --- |
| `TopologySource.fromUrl(id, url, options?)` | `id: string`, `url: string`, `options: Omit<TopologySourceOptions, 'data'>` | `{}` | Import a URL; extension or `Content-Type` selects the format. |
| `TopologySource.fromBytes(id, bytes, options?)` | `id: string`, `bytes: Uint8Array \| ArrayBuffer`, `options.filename: string` | `` `${id}.geojson` `` | Import raw bytes; filename extension selects the parser. |
| `map.addSource(id, source, answers?)` | `id: string`, `source: TopologySource`, `answers.sourceCrs?: string` | Unset | Register a source asynchronously and normalize to map CRS when needed. |
| `map.addLayer(layer, before?)` | `layer: LayerSpecification`, `before?: string` | `before` unset | Register a render layer synchronously; later layers draw above. |
| `source.setData(data)` | `data: TopologySourceInput` | Required | Reimport data; concurrent calls use the latest load. |

`new TopologySource(id, { data })` creates a source object ID and imports data. `{ filename, content }` imports one file; an array combines files into one dataset.

### `LayerSpecification`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` | Required | Unique render-layer ID. |
| `type` | `'fill' \| 'line' \| 'circle'` | Required | Renderer and `paint` set. |
| `source` / `source-layer` | `string` | `source` required; first source layer | Map source and target dataset layer. |
| `paint` | `FillLayerPaint \| LinePaint \| CirclePaint` | Type defaults | Color, width, opacity, and marker settings. |
| `layout.visibility` | `'visible' \| 'none'` | `'visible'` | Rendering and picking switch. |
| `filter` | `StyleExpression` | Unset | Per-feature boolean MapLibre-subset expression. |
| `styleSource` | `'mapshaper'` | Unset | Use baked `fill` / `stroke` color fields. |
| `pointLod` | `false \| { cellSize?: number }` | `{ cellSize: 8 }` | `circle` point-density thinning. |

## More source options

The constructor, `fromUrl`, and `fromBytes` share `TopologySourceOptions`; `setData` reuses the construction import strategy.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `formats` | `FormatRegistryContract` | Separate empty registry | Plugin format registry. |
| `resourceLimits.maxInputBytes` | `number` | 2 GiB | Raw-byte ceiling per logical import. |
| `zipLimits.maxCompressedBytes` / `zipLimits.maxBytes` | `number` | 2 GiB | ZIP compressed / total uncompressed-byte ceilings. |
| `zipLimits.maxEntries` / `zipLimits.maxRatio` | `number` | `5000` / `100` | ZIP entry-count / expansion-ratio ceilings. |
| `adapter` | `MapshaperAdapter` | Default mapshaper adapter | Import, export, transformation, and bounds calculations. |

## More source and layer IDs

```ts
await map.addSource('main', source); // register the source under a map source ID
map.addLayer({
  // reference a dataset source layer
  id: 'district-fill', // set the render layer ID
  type: 'fill', // choose the fill renderer
  source: 'main', // reference the map source ID
  'source-layer': 'districts', // select a dataset layer
});
```

| ID | Example | Scope |
| --- | --- | --- |
| Source object ID | `source.id` | `TopologySource`. |
| Map source ID | `main` | `Emap` source registry; render-layer and `map.ops` `source` must match. |
| source-layer name | `districts` | A dataset layer. |
| Render layer ID | `district-fill` | `Emap` draw order, events, and visibility. |

Omit `source-layer` for the first layer; a canonical ID matches `layer.name`, then `layer.id`, then positional `layer-N`, or use an exact `layer.name` or `layer.id`.

## More layer styling

```ts
map.addLayer({
  // draw the fill first
  id: 'parcel-fill', // set the fill layer ID
  type: 'fill', // choose the fill renderer
  source: 'parcels', // reference the map source
  'source-layer': 'parcels', // select the data layer
  paint: { 'fill-color': '#bbf7d0', 'fill-opacity': 0.6 }, // set the fill
});

map.addLayer({
  // draw the outline afterwards
  id: 'parcel-outline', // set the line layer ID
  type: 'line', // choose the line renderer
  source: 'parcels', // reference the same map source
  'source-layer': 'parcels', // select the same data layer
  paint: { 'line-color': '#166534', 'line-width': 1 }, // set the outline
});
```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `fill-color` / `fill-opacity` | `string \| StyleExpression` / `number` | Theme muted color / `1` | Polygon fill color / opacity. |
| `line-color` / `line-width` | `string \| StyleExpression` / `number` | Theme primary color / `0.8` | Line or polygon-boundary color / width. |
| `line-dasharray` / `line-dashstyle` | `readonly number[]` / `'solid' \| 'dash' \| 'dot' \| 'dash-dot' \| 'arrow-dot' \| StyleExpression` | Solid / `'solid'` when empty | Dash rhythm / named style; `'arrow-dot'` uses arrows. |
| `line-arrow-spacing` / `line-arrow-size` | `number` | `32` / `6` | `'arrow-dot'` arrow spacing / wing length in CSS pixels. |
| `circle-color` / `circle-radius` | `string \| StyleExpression` / `number` | Theme primary color / `4` | Point-marker color / radius. |
| `circle-fill` / `circle-shape` | `boolean` / `PointMarkerShape \| StyleExpression` | `true` / `'circle'` | Filled or outlined / marker shape. |

MapLibre service-layer `minzoom` / `maxzoom` configure zoom ranges.

## Confirm CRS while loading

```ts
let result = await map.preflightSource({ id: 'main', source }); // preflight the source
if (result.status === 'needs-input') {
  // provide CRS input when requested
  result = await map.preflightSource(result.draft, { sourceCrs: 'EPSG:3857' }); // retry with the draft
}
if (result.status === 'ready') await map.confirmSource(result.plan); // confirm the single-use ready plan
```

| API | Parameters | Default | Description |
| --- | --- | --- | --- |
| `preflightSource` | `request.id: string`, `request.source?: TopologySource`, `request.input?: TopologySourceInput` | `id` required; choose `source` or `input` | Preflight a source to register. |
| `preflightSource` | `request.sourceOptions`, `request.sourceCrs`, `draft`, `answers.sourceCrs` | `{}`, dataset CRS, required on retry, required when requested | Import options, explicit CRS, retry draft, and CRS answer. |
| `confirmSource` | `plan: ReadySourceLoadPlan` | Required | Confirm a single-use ready plan. |

`ready` provides a plan, summary, and diagnostics; `needs-input` provides a draft and requirements; `rejected` provides errors. The first source establishes map CRS; later sources are transformed to it.

## Export and format plugins

`source.export({ format: 'geojson' })` returns a browser `Blob`. GeoJSON, TopoJSON, Shapefile, MSX, GeoParquet, GeoArrow, and FlatGeobuf are supported; the latter formats need their plugins. GeoPackage imports through `@mapseekai/emap/geopackage` only; see [GeoPackage](../data/geopackage.md).

## API

- [TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)
- [LayerSpecification](/mapseekai/emap/api/types/emap.LayerSpecification.html)
- [ExportOptions](/mapseekai/emap/api/interfaces/emap.ExportOptions.html)

## Runnable examples

- [GeoJSON viewer](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [Line layers](/mapseekai/emap/examples/getting-started/lines/)
- [Point layers](/mapseekai/emap/examples/getting-started/points/)
- [Merge layers](/mapseekai/emap/examples/merge-layers/)
