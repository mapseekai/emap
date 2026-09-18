---
id: fit-bounds
slug: /recipes/fit-bounds
title: Fit bounds
api: ["Emap", "Bounds", "FitBoundsOptions"]
examples: ["getting-started/geojson-viewer", "getting-started/polygon-fill"]
stability: stable
verifiedVersion: 0.13.0
---

# Fit bounds

After a source loads, use its `Bounds` to fit the camera. Empty sources, including those empty after filtering, have empty bounds, so check `hasBounds()` before `fitBounds`.


```ts
const extent = source.getExtent(); // read the loaded data extent
if (extent.hasBounds()) {
  // empty sources cannot be fitted
  map.fitBounds(extent, { padding: 48, duration: 0 }); // fit the first view without animation
}
```

## Core parameters

`map.fitBounds(bounds, options?)` centers the camera on `bounds`, calculates a fit from the limiting viewport dimension, and returns the current `Emap`.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `bounds` | `Bounds` | Required | Data-coordinate extent to display |
| `options` | `FitBoundsOptions` | `{}` | Camera-fitting and animation configuration |

`FitBoundsOptions`:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `padding` | `number` | `0` | Pixel inset on every side, leaving space for sidebars, legends, or overlays |
| `duration` | `number` | `1000` | Animation duration in milliseconds; use `0` for first load |
| `animate` | `boolean` | `true` | Whether to animate; `false` or `duration: 0` positions synchronously |
| `easing` | `(t: number) => number` | `Tween.sineInOut` | Maps animation progress from `0` to `1` |
| `maxScale` | `number` | `undefined` | Camera scale ceiling for points, short lines, or tiny polygons |

## More Bounds operations

`Bounds` uses data coordinates ordered west, south, east, north:

```ts
const district = new Bounds(116.2, 39.7, 116.6, 40.1);
const districtFromArray = Bounds.fromArray([116.2, 39.7, 116.6, 40.1]);

if (district.hasBounds()) {
  map.fitBounds(district);
}
```

`new Bounds()` creates an empty extent; `Bounds.fromArray()` accepts `[xmin, ymin, xmax, ymax]`.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `xmin` | `number` | `Infinity` | Minimum x coordinate (west or left) |
| `ymin` | `number` | `Infinity` | Minimum y coordinate (south or bottom) |
| `xmax` | `number` | `-Infinity` | Maximum x coordinate (east or right) |
| `ymax` | `number` | `-Infinity` | Maximum y coordinate (north or top) |

`Bounds.fromArray()`:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `arr` | `[number, number, number, number]` | Required | Bounding box in `[xmin, ymin, xmax, ymax]` order |

`hasBounds(): boolean` returns `true` when `xmin <= xmax` and `ymin <= ymax`; a point's zero-size extent is valid.


## API

- `Emap`
- `Bounds`
- `FitBoundsOptions`

## Runnable examples

- [GeoJSON viewer](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [Polygon fill](/mapseekai/emap/examples/getting-started/polygon-fill/)
