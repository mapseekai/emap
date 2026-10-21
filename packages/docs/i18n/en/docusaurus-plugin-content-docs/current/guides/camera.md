---
id: camera
slug: /guides/camera
title: Camera
api: ["Emap", "Bounds", "Viewport", "CameraOptions", "AnimationOptions", "FlyToOptions", "FitBoundsOptions"]
examples: ["getting-started/vector-file","crs-switch"]
stability: stable
verifiedVersion: 0.14.0
---

# Camera

The camera supports instant positioning, animated pan and zoom, flights, and fitting bounds. It manages the 2D view by center and scale in data/projected coordinates. WebMercator accepts `zoom`; any CRS accepts `scale`.

```ts
map.jumpTo({ center: [121.47, 31.23], zoom: 10 }); // position instantly
map.flyTo({ center: [121.47, 31.23], zoom: 11, speed: 1.2 }); // long-distance flight
map.fitBounds(source.getExtent(), { padding: 32 }); // fit the data extent
```

## Core methods

| Method | Parameters | Description |
| --- | --- | --- |
| `jumpTo(options)` | `CameraOptions` | Apply center and scale immediately. |
| `easeTo(options)` | `CameraOptions & AnimationOptions` | Smooth transition: linear center, logarithmic scale. |
| `flyTo(options)` | `FlyToOptions` | van Wijk curve over long distances, smooth transition nearby. |
| `fitBounds(bounds, options?)` | `Bounds`, `FitBoundsOptions` | Center the bounds and compute scale from container and padding. |

### `CameraOptions`

Shared by `jumpTo()`, `easeTo()`, and `flyTo()`:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `center` | `[number, number]` | Current center | Target center in data/projected coordinates. |
| `zoom` | `number` | Keeps scale | Target WebMercator zoom level. |
| `scale` | `number` | Keeps scale | Target pixel scale, finite and positive; wins over `zoom`. |

### `AnimationOptions`

Shared by `easeTo()`, `flyTo()`, `fitBounds()`, and other animated methods:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `duration` | `number` | `1000` (ms) | Animation duration in milliseconds, finite and non-negative. |
| `easing` | `(t: number) => number` | `Tween.sineInOut` | Progress easing function. |
| `animate` | `boolean` | `true` | `false` or `duration: 0` updates the view instantly. |

### `FitBoundsOptions`

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `padding` | `number` | `0` | Uniform padding on all sides (pixels). |
| `maxScale` | `number` | Unset | Maximum scale of the fitted view. |
| `duration`, `easing`, `animate` | — | — | Inherit all `AnimationOptions` parameters. |

## More view operations

```ts
map.panBy([80, 0], { duration: 250 }); // pan by pixels to make room for an overlay
map.zoomTo(12); // transition to a zoom level
map.stop(); // end the current animation
```

| Method | Parameters | Description |
| --- | --- | --- |
| `setCenter(center)` | `[number, number]` | Update the center immediately, keeping the scale. |
| `setZoom(zoom)` | `number` | Update the WebMercator zoom level immediately. |
| `panTo(center, options?)` | `[number, number]`, `AnimationOptions` | Pan smoothly to a target center. |
| `panBy(offset, options?)` | `[number, number]`, `AnimationOptions` | Convert a pixel offset to `[dx / scale, -dy / scale]`. |
| `zoomTo(zoom, options?)` | `number`, `AnimationOptions` | Transition smoothly to a WebMercator zoom level. |
| `stop()` | None | End the camera animation and emit a termination event. |
| `zoomIn()` / `zoomOut()` | None | Animated scale by `1.15` / `1 / 1.15`. |

`FlyToOptions` adds to `CameraOptions` and `AnimationOptions`:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `curve` | `number` | `1.42` | van Wijk flight curvature. |
| `speed` | `number` | Unset | Average flight speed (screen widths/second), finite and positive; overrides `duration`. |

## Reading the view and events

```ts
const center = map.getCenter(); // [longitude, latitude] in WebMercator
const extent = map.getExtent(); // Bounds copy of the current viewport

map.on('moveend', (event) => {
  const savedView = { center: event.center, zoom: event.zoom };
});
```

`getZoom()` returns the WebMercator zoom level (`0` for other CRS). Movement emits `movestart`, `move`, `moveend`; scale changes also emit `zoomstart`, `zoom`, `zoomend`. Event `center` uses data/projected coordinates and `zoom` is `log2(scale)`.

## Extent management

`Bounds` is an axis-aligned range in data/projected coordinates: `new Bounds(xmin, ymin, xmax, ymax)` (defaults to an empty `Infinity` range); `bounds.hasBounds()` reports validity.

| Method | Parameters | Description |
| --- | --- | --- |
| `setExtent(bounds)` | `Bounds` | Store a copy of the bounds and fit the viewport. |
| `reset()` | None | Fit the merged source extents, otherwise restore the initial view. |
| `resize()` | None | Update Canvas and viewport after the container resizes. |

## Runnable examples

- [Open a vector file](/mapseekai/emap/examples/getting-started/vector-file/)
- [CRS switch](/mapseekai/emap/examples/crs-switch/)
