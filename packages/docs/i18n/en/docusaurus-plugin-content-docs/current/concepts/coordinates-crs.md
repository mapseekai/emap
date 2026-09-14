---
id: coordinates-crs
slug: /concepts/coordinates-crs
title: Coordinates and CRS
api: ["AffineTransform", "AnimationOptions", "Bounds", "CameraOptions", "DEFAULT_CRS", "Emap", "FitBoundsOptions", "FlyToOptions", "inferFromPrj", "normalizeCrsString", "Projection", "resolveDatasetCRS", "setDatasetCrsMetadata", "Viewport"]
examples: ["crs-switch","project","duckdb-buffer"]
stability: stable
verifiedVersion: unreleased
---

# Coordinates and CRS

Emap distinguishes dataset/map coordinates, Canvas pixels, and CRS identifiers. Geometry, camera centers, and spatial operations use dataset/map coordinates; hit testing and screen overlays use Canvas-local pixels; a CRS defines the location and units represented by coordinate values.

| Space | Example | Used for |
| --- | --- | --- |
| Dataset/map coordinates | `[120, 30]`, `[13358338, 3503549]` | Geometry, extent, camera, operations |
| Canvas pixels | `[320, 180]` | Pointer input, hit testing, screen UI |
| CRS identifier | `EPSG:4326`, `EPSG:3857` | Interpreting coordinates and units |

Canvas pixels are not longitude/latitude, and dataset coordinates are not necessarily WGS84.

## Read and establish a CRS

`source.getCRS()` and `map.getCRS()` return CRS strings. `resolveDatasetCRS(dataset)` resolves a CRS from dataset metadata and returns `DEFAULT_CRS` (`EPSG:4326`) when no metadata is recognized. That fallback does not establish that the original coordinates are longitude/latitude; applications should obtain a CRS for data of unknown origin.

```ts
console.log(source.getCRS());
console.log(map.getCRS());
```

An empty map can establish a CRS with `map.setCRS('EPSG:3857')`. The first registered source establishes the active CRS when the map has no preset CRS. Later sources normalize to the map CRS before registration.

Before attaching an externally constructed dataset to a map, write explicit CRS metadata with `setDatasetCrsMetadata(dataset, crs)`: the given `crs` replaces any embedded prj/wkt1 hints, and `undefined` clears them.

## Reproject a map or export a layer

Change the CRS of a map with registered sources through `map.reproject(...)`:

```ts
await map.reproject('EPSG:3857');
```

This converts every registered source to the target CRS and updates CRS metadata, spatial indexes, and the view. If any source conversion fails, no source is committed. Registered data cannot use `setCRS` to change interpretation only; `setCRS` is for a map without sources.

Use `projectLayer` to export one layer in another CRS without changing the map:

```ts
const result = await map.ops.projectLayer({
  source: 'main',
  target: 'districts',
  crs: 'EPSG:3857',
  output: { format: 'geojson', filename: 'districts-3857.geojson' },
});

if (result.ok) {
  const { blob, filename } = result.value;
  console.log(blob, filename);
}
```

`projectLayer` processes an isolated copy and returns an export file without changing the map source, active CRS, or viewport.

## Map and screen coordinates

```ts
const [screenX, screenY] = map.project(120, 30);
const [mapX, mapY] = map.unproject(screenX, screenY);
```

`project` and `unproject` apply the viewport transform only; they do not convert EPSG coordinates. `queryFeatures` uses Canvas-local pixels, so browser event coordinates must first be converted to container-local pixels.

## Extent, distance, and units

`Bounds` represents an extent in dataset/map coordinates. Check it before moving the camera after loading:

```ts
const extent = source.getExtent();
if (extent.hasBounds()) map.fitBounds(extent, { padding: 32, duration: 0 });
```

Buffer radii, simplify tolerances, snap intervals, and area thresholds use dataset coordinate units. A projected CRS can use metres or feet; `EPSG:4326` uses degrees. Perform distance or area work in a projected CRS suitable for the area rather than treating longitude/latitude values as metres.

## Camera zoom and scale

`zoom` is a Web Mercator convenience. For another CRS, use `fitBounds` or CRS-independent `scale`:

```ts
map.jumpTo({
  center: [500000, 3400000],
  scale: 0.002,
});
```

When one camera call supplies both `scale` and `zoom`, `scale` takes precedence.

## API

- [Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [Bounds](/mapseekai/emap/api/classes/emap.Bounds.html)
- [resolveDatasetCRS](/mapseekai/emap/api/functions/emap.resolveDatasetCRS.html)
- [setDatasetCrsMetadata](/mapseekai/emap/api/functions/emap.setDatasetCrsMetadata.html)

## Runnable examples

- [CRS switch](/mapseekai/emap/examples/crs-switch/)
- [Project](/mapseekai/emap/examples/project/)
- [DuckDB buffer](/mapseekai/emap/examples/duckdb-buffer/)
