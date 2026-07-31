---
id: coordinates-crs
slug: /concepts/coordinates-crs
title: Coordinates and CRS
api: ["AffineTransform","AnimationOptions","Bounds","CameraOptions","DEFAULT_CRS","Emap","FitBoundsOptions","FlyToOptions","inferFromPrj","normalizeCrsString","Projection","resolveDatasetCRS","Viewport"]
examples: ["crs-switch","project"]
stability: stable
verifiedVersion: 0.5.0
---

# Coordinates and CRS

Emap works with three coordinate spaces:

| Space | Example | Purpose |
|---|---|---|
| Dataset/map | `[120, 30]` or `[13358338, 3503549]` | Geometry, camera center, operations |
| Canvas pixels | `[320, 180]` | Hit testing, controls, screen overlays |
| CRS identifier | `EPSG:4326`, `EPSG:3857` | Meaning of dataset coordinates |

Do not treat canvas pixels as longitude/latitude or assume every dataset is
WGS84.

## CRS detection

`TopologySource.getCRS()` resolves metadata in this order:

1. `crs_string`
2. `.prj` / WKT
3. mapshaper's parsed CRS
4. `EPSG:4326` fallback

```ts
console.log(source.getCRS());
console.log(map.getCRS());
```

A fallback does not prove the data is geographic. Let users confirm or override
the CRS for files of unknown origin.

## Set a map CRS or reproject

An empty map can establish its CRS with `setCRS`:

```ts
map.setCRS('EPSG:3857');
```

Emap maintains one active CRS for all loaded data:

- Without a preset CRS, the first loaded source establishes the map CRS.
- `await map.addSource(...)` reprojects a loaded source before registration when its CRS differs.
- A later `setData(...)` on a registered source performs the same normalization before commit and before its `data` event.
- `map.ops`, DuckDB helpers, editing, and export read datasets in the active map CRS.

After a source is registered, `setCRS` rejects a display-only interpretation
change. Transform every registered source instead:

```ts
await map.reproject('EPSG:3857');
```

`reproject` atomically converts every source, updates CRS metadata, clears
spatial indexes, fits the new extent, and fires `crschange` and `data`. If any
source conversion fails, no source is committed.

For one target layer:

```ts
const result = await map.ops.projectLayer({
  source: 'main',
  target: 'districts',
  crs: 'EPSG:3857',
});
```

The `ProjectOptions` field is `crs`, not `targetCrs`.

## Map and screen coordinates

```ts
const [screenX, screenY] = map.project(120, 30);
const [mapX, mapY] = map.unproject(screenX, screenY);
```

`project(x, y)` applies the current viewport transform. It does not reproject
between EPSG systems.

## Bounds

```ts
const extent = source.getExtent();

if (extent.hasBounds()) {
  map.fitBounds(extent, {
    padding: 32,
    duration: 0,
  });
}
```

An empty layer may have empty bounds; check before moving the camera.

## Distance and area units

Operation distance, tolerance, and area thresholds normally use dataset units:

- A projected CRS may use metres or feet.
- `EPSG:4326` uses degrees, not metres.
- Buffer radius, simplify tolerance, and snap interval are not implicitly
  metres.

Prefer reprojecting geographic data into an appropriate local projected CRS
before distance work. Some DuckDB helpers reject geographic CRS by default.

## Camera zoom and scale

`zoom` is a WebMercator convenience. For another CRS, prefer bounds or
CRS-independent `scale`:

```ts
map.jumpTo({
  center: [500000, 3400000],
  scale: 0.002,
});
```

`scale` wins when both it and `zoom` are supplied.

## Troubleshooting

- If reprojected data is misplaced, verify the original CRS before conversion.
- A buffer over longitude/latitude uses degrees unless data is reprojected.
- `queryFeatures` expects canvas-local pixels, not page coordinates.

## API

- [Emap](/mapseekai/emap/api/classes/index.Emap.html)
- [Bounds](/mapseekai/emap/api/classes/index.Bounds.html)
- [Projection](/mapseekai/emap/api/classes/index.Projection.html)
- [resolveDatasetCRS](/mapseekai/emap/api/functions/index.resolveDatasetCRS.html)
- [ProjectOptions](/mapseekai/emap/api/interfaces/index.ProjectOptions.html)

## Runnable examples

- [Project](/mapseekai/emap/examples/project/)
- [CRS switch](/mapseekai/emap/examples/crs-switch/)
- [DuckDB buffer](/mapseekai/emap/examples/duckdb-buffer/)
