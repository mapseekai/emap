---
id: camera
slug: /guides/camera
title: Camera
api: []
examples: []
stability: stable
verifiedVersion: 0.5.0
---

# Camera

Camera APIs move between dataset bounds, map coordinates, and canvas pixels. Prefer camera methods over changing viewport internals.

## Behavior notes

`fitBounds` accepts padding and duration; use `duration: 0` for deterministic tests or first paint. User gestures stop active animations.

## API

- [src.Emap](/emap/api/classes/index.Emap.html)
- [src.FitBoundsOptions](/emap/api/interfaces/index.FitBoundsOptions.html)
- [src.FlyToOptions](/emap/api/interfaces/index.FlyToOptions.html)

## Runnable examples

- [getting-started/geojson-viewer](/emap/examples/getting-started/geojson-viewer/)
- [crs-switch](/emap/examples/crs-switch/)

## Minimal snippet

```ts
map.fitBounds(source.getExtent(), { padding: 48, duration: 0 })
map.flyTo({ center: [120, 30], zoom: 7 })
```
