---
id: fit-bounds
slug: /recipes/fit-bounds
title: Fit bounds
api: ["Emap", "Bounds", "FitBoundsOptions"]
examples: ["getting-started/geojson-viewer", "getting-started/polygon-fill"]
stability: stable
verifiedVersion: 0.12.0
---

# Fit bounds

After a source loads, use its `Bounds` to position the camera. An empty source, including one with no features after filtering, has empty bounds, so check `hasBounds()` before calling `fitBounds`.

## Fit loaded data

```ts
const extent = source.getExtent()
if (extent.hasBounds()) {
  map.fitBounds(extent, { padding: 48, duration: 0 })
}
```

`padding` reserves space around the data in pixels, and `duration` controls camera animation. `duration: 0` shows newly loaded data immediately; user-triggered view changes can use an animation duration.

## API

- `Emap`
- `Bounds`
- `FitBoundsOptions`

## Runnable examples

- [GeoJSON viewer](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [Polygon fill](/mapseekai/emap/examples/getting-started/polygon-fill/)
