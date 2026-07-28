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

Map coordinates come from the source CRS; screen coordinates come from the canvas viewport. Use `project`, `unproject`, `fitBounds`, and `setExtent` instead of ad-hoc transforms.

## Behavior notes

CRS metadata is read from imported files when available. Projection operations update dataset coordinates and history; geographic buffers should opt into explicit distance behavior.

## API

- [src.Emap](/emap/api/classes/index.Emap.html)
- [src.resolveDatasetCRS](/emap/api/functions/index.resolveDatasetCRS.html)

## Runnable examples

- [project](/emap/examples/project/)
- [crs-switch](/emap/examples/crs-switch/)
- [duckdb-buffer](/emap/examples/duckdb-buffer/)

## Minimal snippet

```ts
const point = map.project([120, 30])
await map.ops.projectLayer({ source: "main", targetCrs: "EPSG:3857" })
```
