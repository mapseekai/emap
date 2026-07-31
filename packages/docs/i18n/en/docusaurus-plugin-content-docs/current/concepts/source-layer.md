---
id: source-layer
slug: /concepts/source-layer
title: Sources and layers
api: ["CirclePaint","DatasetFormatPlugin","Emap","ExportedFormatFile","ExportFormat","ExportOptions","FillPaint","ITopologySource","LayerLayout","LayerPaint","LayerSpecification","LayerType","LinePaint","registerFormat","resolvePointStyle","resolveStrokeStyle","TopologySource","TopologySource.fromBytes","TopologySourceData","TopologySourceFromBytesOptions","TopologySourceInput","TopologySourceOptions","ZipExtractionLimits"]
examples: ["getting-started/geojson-viewer","getting-started/lines","getting-started/points","merge-layers","rename-layer","split-layer"]
stability: stable
verifiedVersion: 0.5.0
---

# Sources and layers

Emap separates data ownership from data presentation:

- `TopologySource` stores an imported mapshaper dataset.
- Source layers inside the dataset store geometry and attribute records.
- `LayerSpecification` references a source layer and describes canvas
  rendering.

This separation lets one geometry layer appear with several styles and keeps
data operations independent from application presentation.

## Create a source

### From a URL

```ts
const source = await TopologySource.fromUrl(
  'roads',
  '/data/roads.geojson',
);
```

### From bytes

```ts
const bytes = await file.arrayBuffer();
const source = await TopologySource.fromBytes('upload', bytes, {
  filename: file.name,
});
```

### Construct first, load later

```ts
const source = new TopologySource('live');
await map.addSource('live', source);

await source.setData({
  filename: 'districts.geojson',
  content,
});
```

`map.addSource()` is independent of load order, but should always be awaited.
A loaded source is normalized to the map's active CRS before registration; for
a source loaded later, `setData()` normalizes before commit and before its
`data` event. A registered `TopologySource.reproject()` cannot change CRS
independently; use `map.reproject()`.

## Do not mix up the IDs

Suppose an uploaded dataset has a source layer named `districts`:

```ts
await map.addSource('main', source);

map.addLayer({
  id: 'district-fill',
  type: 'fill',
  source: 'main',
  'source-layer': 'districts',
});
```

This code contains distinct identifiers:

| Identifier | Value | Scope |
|---|---|---|
| `TopologySource` name | Passed to its constructor | Source object |
| Map source ID | `main` | `Emap`; used by layers and operations |
| Source-layer name | `districts` | mapshaper dataset |
| Render-layer ID | `district-fill` | `Emap`; used by order, events, and filters |

An application may use the same value for the first two to reduce cognitive
load, but they still belong to different levels.

## Select a source layer

A single-layer dataset can usually omit `source-layer`; Emap selects the first
layer compatible with the render type:

```ts
map.addLayer({
  id: 'road-line',
  type: 'line',
  source: 'roads',
});
```

Specify it for a multi-layer dataset:

```ts
map.addLayer({
  id: 'primary-roads',
  type: 'line',
  source: 'transport',
  'source-layer': 'primary',
});
```

An explicit name also prevents a file that changes layer order from rendering
the wrong content.

## Render types

`LayerSpecification.type` has three values:

| Type | Typical geometry | Main paint properties |
|---|---|---|
| `fill` | polygon | `fill-color`, `fill-opacity` |
| `line` | polyline or polygon boundary | `line-color`, `line-width` |
| `circle` | point | `circle-color`, `circle-radius` |

Example:

```ts
map.addLayer({
  id: 'cities',
  type: 'circle',
  source: 'main',
  'source-layer': 'cities',
  paint: {
    'circle-color': '#ef4444',
    'circle-radius': 5,
  },
});
```

The render type must be compatible with source geometry. Point data cannot be
displayed with `fill`; use a `line` layer for polygon outlines.

## One source layer, several presentations

```ts
map.addLayer({
  id: 'parcel-fill',
  type: 'fill',
  source: 'parcels',
  paint: {
    'fill-color': '#bbf7d0',
    'fill-opacity': 0.6,
  },
});

map.addLayer({
  id: 'parcel-outline',
  type: 'line',
  source: 'parcels',
  paint: {
    'line-color': '#166534',
    'line-width': 1,
  },
});
```

Later layers draw above earlier layers, so the outline remains visible above
the fill. Selection and feature events can filter on either render layer, while
both reference the same source geometry.

## Data operations target sources

`map.ops` locates data through a map source ID and optional source-layer name,
not a render-layer ID:

```ts
const result = await map.ops.simplifyLayer({
  source: 'parcels',
  percentage: 0.25,
});

if (!result.ok) {
  console.error(result.error);
}
```

After a successful operation, render layers that reference the source redraw
from the updated dataset.

## Troubleshooting

### The source loaded but is not visible

- Confirm the map has called `addSource`.
- Confirm a render layer `source` matches the map source ID.
- For multi-layer files, check `source-layer` spelling and case.
- Confirm the render `type` is compatible with geometry.
- Set the camera from the source extent.

### The filename extension was lost

Always preserve the original `filename` when loading bytes or an upload. The
parser needs the extension to select an importer.

### A direct dataset change is not reflected

`getDataset()`, `getLayers()`, and `getArcs()` return zero-copy, deeply
read-only TypeScript views. Apply changes through edit commands, edit sessions,
or `map.ops` so render caches, selection, and history update together. The
guard is type-level; JavaScript, `any`, and explicit assertions can bypass it.

## API

- [TopologySource](/mapseekai/emap/api/classes/index.TopologySource.html)
- [ITopologySource](/mapseekai/emap/api/interfaces/index.ITopologySource.html)
- [LayerSpecification](/mapseekai/emap/api/interfaces/index.LayerSpecification.html)
- [ExportOptions](/mapseekai/emap/api/interfaces/index.ExportOptions.html)

## Runnable examples

- [GeoJSON viewer](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [Point layers](/mapseekai/emap/examples/getting-started/points/)
- [Merge layers](/mapseekai/emap/examples/merge-layers/)
- [Rename a layer](/mapseekai/emap/examples/rename-layer/)
- [Split a layer](/mapseekai/emap/examples/split-layer/)
