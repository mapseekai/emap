---
id: fit-bounds
slug: /recipes/fit-bounds
title: Fit bounds
api: ["Emap"]
examples: ["getting-started/geojson-viewer"]
stability: stable
verifiedVersion: 0.5.0
---

# Fit bounds

After loading a source, read its extent and fit the camera. Guard empty extents because user uploads or filtered layers can be empty.

## Behavior notes

Use `duration: 0` for first load, tests, and examples; use animated durations only after the first meaningful render.

## API

- [src.Emap](https://zwishing.github.io/emap/api/classes/index.Emap.html)
- [src.FitBoundsOptions](https://zwishing.github.io/emap/api/interfaces/index.FitBoundsOptions.html)

## Runnable examples

- [getting-started/geojson-viewer](https://zwishing.github.io/emap/examples/getting-started/geojson-viewer/)
- [getting-started/polygon-fill](https://zwishing.github.io/emap/examples/getting-started/polygon-fill/)

## Minimal snippet

```ts
const extent = source.getExtent()
if (extent.hasBounds()) map.fitBounds(extent, { padding: 48, duration: 0 })
```
