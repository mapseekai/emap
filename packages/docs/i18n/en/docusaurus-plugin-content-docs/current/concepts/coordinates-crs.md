---
id: coordinates-crs
slug: /concepts/coordinates-crs
title: Coordinates and CRS
api: ["AffineTransform", "AnimationOptions", "Bounds", "CameraOptions", "DEFAULT_CRS", "Emap", "FitBoundsOptions", "FlyToOptions", "inferFromPrj", "normalizeCrsString", "Projection", "resolveDatasetCRS", "setDatasetCrsMetadata", "Viewport"]
examples: ["crs-switch","project","duckdb-buffer"]
stability: stable
verifiedVersion: 0.13.0
---

# Coordinates and CRS

Emap uses dataset/map coordinates for geometry and spatial operations, Canvas pixels for interaction and drawing, and CRS identifiers for coordinate meaning and units.

```ts
const map = await Emap.create({ container: '#map' }); // create the map instance
map.setCRS('EPSG:3857'); // establish CRS for an empty map
const source = await TopologySource.create('places', {
  // create an empty source with CRS
  name: 'places', // set the data-layer name
  geometryType: 'point', // set the geometry type
  crs: 'EPSG:3857', // set the input-coordinate CRS
});
await map.addSource('places', source); // register the source and align map CRS
```

## Core methods

| API | Parameters | Default | Description |
| --- | --- | --- | --- |
| `map.setCRS(crs)` | `crs: string` | Required | Set active CRS for a map without sources. |
| `map.getCRS()` / `source.getCRS()` | None | — | Read map / source CRS. |
| `map.project(x, y)` / `map.unproject(px, py)` | Two `number` values | Required | Convert current-CRS coordinates and Canvas-local pixels. |
| `map.reproject(targetCrs)` | `targetCrs: string` | Required | Reproject registered sources, metadata, indexes, and view in one undoable entry. |

| Space | Example | Used for |
| --- | --- | --- |
| Dataset/map coordinates | `[120, 30]`, `[13358338, 3503549]` | Geometry, extent, camera, and spatial operations. |
| Canvas pixels | `[320, 180]` | Pointer input, hit testing, and screen UI. |
| CRS identifier | `EPSG:4326`, `EPSG:3857` | Coordinate location and units. |

## More CRS setup

`Emap.create(options)` initializes a map. `TopologySource.create(id, options)` creates a detached empty layer; `map.addSource(id, source, answers)` establishes imported-source CRS.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `options` for `Emap.create(options)` | `EmapOptions` | `{}` | Map initialization options. |
| `id` / `options` for `TopologySource.create(id, options)` | `string` / `CreateLayerOptions` | Required | Source identifier / empty layer and CRS metadata. |
| `name` / `geometryType` | `string` / `'point' \| 'polyline' \| 'polygon'` | Required | Layer name / geometry type. |
| `crs` / `fields` | `string` / `readonly LayerFieldDefinition[]` | Required / `[]` | New-layer CRS / initial attribute fields. |
| `id` / `source` / `answers.sourceCrs` for `map.addSource` | `string` / `TopologySource` / `string` | Required / Required / source metadata | Registration name / source / imported-coordinate CRS override. |

`DEFAULT_CRS` is `EPSG:4326`. `resolveDatasetCRS(dataset)` defaults to it; `normalizeCrsString(str)` normalizes external labels; `inferFromPrj(prj)` extracts EPSG from `.prj`/WKT; `setDatasetCrsMetadata(dataset, crs)` writes CRS and clears `prj`/`wkt1`.

## More reprojection

```ts
await map.reproject('EPSG:3857'); // reproject the map and its registered sources
```

| API | Parameters | Default | Description |
| --- | --- | --- | --- |
| `source.reproject(targetCrs, targetCrsMetadata?)` | `string`, `string \| undefined` | `targetCrs` required, metadata `undefined` | Reproject a detached source and optionally write canonical CRS metadata. |
| `map.ops.projectLayer(options)` | `source`, `target`, `crs` | Required | Export a layer copy in another CRS without changing map state. |
| `options.init` / `densify` | `string` / `boolean` | Source metadata / `false` | Input-CRS override / intermediate vertices for projected curves. |
| `output.format` / `output.filename` | `ExportFormat` / `string` | `'geojson'` / `${target}.${format}` | Blob format / suggested filename. |

```ts
const result = await map.ops.projectLayer({
  // export a reprojected layer copy
  source: 'main', // select the source
  target: 'districts', // select the layer
  crs: 'EPSG:3857', // choose the output CRS
  output: { format: 'geojson', filename: 'districts-3857.geojson' }, // configure output
});

if (result.ok) {
  // read output only after success
  const { blob, filename } = result.value; // get the Blob and filename
  console.log(blob, filename); // use the export result
}
```

## More coordinate spaces

```ts
const [screenX, screenY] = map.project(120, 30); // convert to Canvas-local pixels
const [mapX, mapY] = map.unproject(screenX, screenY); // convert back to current-CRS coordinates
```

`project`/`unproject` apply the current view transform; use `reproject` or `projectLayer` for EPSG conversion. The underlying `AffineTransform` is `project(x, y) = [x * mx + bx, y * my + by]`.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `new AffineTransform(mx, my, bx, by)` | Four `number` values | `1`, `1`, `0`, `0` | X/Y scale and X/Y translation. |
| `projection.setCRS(crs)` | `string` | Required | Projection CRS label. |
| `projection.getCenter(cx, cy)` / `projection.getScale(zoom)` / `projection.getZoom(mx)` | `number` | Required | Center / zoom scale / X-scale zoom. |
| `viewport.setCRS(crs)` | `string` | Required | Viewport CRS hint. |
| `viewport.project(x, y)` / `viewport.unproject(px, py)` | Two `number` values | Required | Convert dataset/map and Viewport pixels. |

`Projection` starts with `EPSG:4326`; `Viewport` starts with identity transform.

## Extent, distance, and units

`Bounds` represents a dataset/map extent; `source.getExtent()` returns it. Buffers, simplification, snapping, and area thresholds use dataset coordinate units.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `new Bounds(xmin, ymin, xmax, ymax)` | Four `number` values | `Infinity`, `Infinity`, `-Infinity`, `-Infinity` | Minimum X/Y and maximum X/Y. |
| `map.fitBounds(bounds, options)` | `Bounds`, `FitBoundsOptions` | Bounds required | Display an extent. |
| `options.padding` / `maxScale` | `number` | `0` / Unlimited | Canvas-pixel inset / fitted maximum scale. |
| `options.duration` / `easing` / `animate` | `number` / `(t: number) => number` / `boolean` | `1000` / `Tween.sineInOut` / `true` | Animation duration, easing, and switch. |

```ts
const extent = source.getExtent(); // read the data extent
if (extent.hasBounds()) map.fitBounds(extent, { padding: 32, duration: 0 }); // fit a valid extent immediately
```

## Camera zoom and scale

`CameraOptions` serves `jumpTo`, `easeTo`, and `flyTo`. `Projection` handles Web Mercator zoom/scale; other CRSs use `scale`.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `options.center` / `zoom` / `scale` | `[number, number]` / `number` / `number` | Current center / current zoom / current scale | Target center / Web Mercator zoom / scale that overrides `zoom`. |
| `options.duration` / `easing` / `animate` | `number` / `(t: number) => number` / `boolean` | `1000` / `Tween.sineInOut` / `true` | Animation duration, easing, and switch. |
| `options.curve` / `speed` | `number` | `1.42` / Automatically calculated | `flyTo` van Wijk curvature / flight speed. |

```ts
map.jumpTo({
  // update the camera immediately
  center: [500000, 3400000], // set the center in projected coordinates
  scale: 0.002, // set scale for any CRS
});
```

## API

- [Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [Bounds](/mapseekai/emap/api/classes/emap.Bounds.html)
- [AffineTransform](/mapseekai/emap/api/classes/emap.AffineTransform.html)
- [Projection](/mapseekai/emap/api/classes/emap.Projection.html)
- [Viewport](/mapseekai/emap/api/classes/emap.Viewport.html)
- [CameraOptions](/mapseekai/emap/api/interfaces/emap.CameraOptions.html)
- [AnimationOptions](/mapseekai/emap/api/interfaces/emap.AnimationOptions.html)
- [FitBoundsOptions](/mapseekai/emap/api/interfaces/emap.FitBoundsOptions.html)
- [FlyToOptions](/mapseekai/emap/api/interfaces/emap.FlyToOptions.html)
- [DEFAULT_CRS](/mapseekai/emap/api/variables/emap.DEFAULT_CRS.html)
- [resolveDatasetCRS](/mapseekai/emap/api/functions/emap.resolveDatasetCRS.html)
- [normalizeCrsString](/mapseekai/emap/api/functions/emap.normalizeCrsString.html)
- [inferFromPrj](/mapseekai/emap/api/functions/emap.inferFromPrj.html)
- [setDatasetCrsMetadata](/mapseekai/emap/api/functions/emap.setDatasetCrsMetadata.html)

## Runnable examples

- [CRS switch](/mapseekai/emap/examples/crs-switch/)
- [Project](/mapseekai/emap/examples/project/)
- [DuckDB buffer](/mapseekai/emap/examples/duckdb-buffer/)
