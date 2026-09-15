---
id: source-layer
slug: /concepts/source-layer
title: Sources and layers
api: ["CirclePaint", "DatasetFormatPlugin", "Emap", "ExportedFormatFile", "ExportFormat", "ExportOptions", "FillPaint", "ITopologySource", "LayerLayout", "LayerPaint", "LayerSpecification", "LayerType", "LinePaint", "ReadySourceLoadPlan", "registerFormat", "ReplaceableTopologySource", "resolvePointStyle", "resolveStrokeStyle", "SourceLoadAnswers", "SourceLoadDiagnostic", "SourceLoadDiagnosticCode", "SourceLoadDraft", "SourceLoadError", "SourceLoadRequest", "SourceLoadRequirement", "SourceLoadSummary", "SourcePreflightResult", "TopologySource", "TopologySource.fromBytes", "TopologySource.fromUrl", "TopologySourceData", "TopologySourceFromBytesOptions", "TopologySourceInput", "TopologySourceOptions", "ImportResourceLimits", "ZipExtractionLimits"]
examples: ["getting-started/geojson-viewer","getting-started/lines","getting-started/points","merge-layers"]
stability: stable
verifiedVersion: unreleased
---

# Sources and layers

Emap separates geospatial data from presentation configuration. `TopologySource` holds an imported mapshaper dataset; the dataset's source layers hold geometry and attributes; a render layer is the `LayerSpecification` passed to `map.addLayer`, which declares how one source layer is drawn.

## Import a source

A `TopologySource` imports URLs, in-memory bytes, and file-picker data:

```ts
import { TopologySource } from '@mapseekai/emap';

const roads = await TopologySource.fromUrl('roads', '/data/roads.geojson');

const bytes = await file.arrayBuffer();
const upload = await TopologySource.fromBytes('upload', bytes, {
  filename: file.name,
});
```

The `filename` passed to `fromBytes` identifies the input format, so uploads should retain their original filename. You can also create a source and call `await source.setData(...)`. A source must finish its first import before it is passed to `map.addSource(...)`.

For untrusted or very large inputs, configure `resourceLimits.maxInputBytes` through `TopologySourceOptions`. The default `ImportResourceLimits` ceiling is 2 GiB per logical import request; ZIP-specific expansion limits remain available through `ZipExtractionLimits`.

## Four IDs

```ts
await map.addSource('main', source);
map.addLayer({
  id: 'district-fill',
  type: 'fill',
  source: 'main',
  'source-layer': 'districts',
});
```

| ID | Example | Scope |
| --- | --- | --- |
| Source object ID | `source.id` | `TopologySource` |
| Map source ID | `main` | `Emap` source registry |
| source-layer name | `districts` | A layer inside the dataset |
| Render layer ID | `district-fill` | `Emap` draw order, events, and visibility |

The map source ID must match the `source` used by render layers and `map.ops`. A single-source-layer dataset can omit `source-layer`; a multi-layer dataset should specify it explicitly.

## Declare how data draws

`LayerSpecification.type` supports `fill`, `line`, and `circle`. They draw polygons, lines or polygon boundaries, and points respectively.

```ts
map.addLayer({
  id: 'parcel-fill',
  type: 'fill',
  source: 'parcels',
  'source-layer': 'parcels',
  paint: { 'fill-color': '#bbf7d0', 'fill-opacity': 0.6 },
});

map.addLayer({
  id: 'parcel-outline',
  type: 'line',
  source: 'parcels',
  'source-layer': 'parcels',
  paint: { 'line-color': '#166534', 'line-width': 1 },
});
```

Several render layers can reference one source layer. Later layers draw above earlier ones, so this outline remains above the fill. Use `circle` for points, `line` for lines and polygon boundaries, and `fill` for polygon interiors.

## Confirm CRS while loading

`map.addSource` preflights a source. When an application needs to ask for a CRS, use `preflightSource` to receive a draft and requirements, then retry with answers; only a ready plan can go to `confirmSource`.

```ts
let result = await map.preflightSource({ id: 'main', source });
if (result.status === 'needs-input') {
  result = await map.preflightSource(result.draft, { sourceCrs: 'EPSG:3857' });
}
if (result.status === 'ready') await map.confirmSource(result.plan);
```

An explicit `sourceCrs` identifies the CRS of the imported coordinates. Once registered, the source's data stays aligned with the map's active CRS.

## Export and format plugins

`source.export({ format: 'geojson' })` returns a browser `Blob`. GeoJSON, TopoJSON, Shapefile, MSX, GeoParquet, GeoArrow, and FlatGeobuf are supported; GeoParquet and GeoArrow require importing `@mapseekai/emap/arrow`, while FlatGeobuf requires a format plugin registered through `registerFormat`.

GeoPackage vector tables are imported through `@mapseekai/emap/geopackage` (import only, no export). All feature tables in one file merge into a single dataset with shared arcs; see [GeoPackage](../data/geopackage.md).

## API

- [TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)
- [LayerSpecification](/mapseekai/emap/api/types/emap.LayerSpecification.html)
- [ExportOptions](/mapseekai/emap/api/interfaces/emap.ExportOptions.html)

## Runnable examples

- [GeoJSON viewer](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [Line layers](/mapseekai/emap/examples/getting-started/lines/)
- [Point layers](/mapseekai/emap/examples/getting-started/points/)
- [Merge layers](/mapseekai/emap/examples/merge-layers/)
