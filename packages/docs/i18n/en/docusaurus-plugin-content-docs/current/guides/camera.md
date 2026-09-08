---
id: camera
slug: /guides/camera
title: Camera
api: ["Emap","Bounds","Viewport","CameraOptions","AnimationOptions","FlyToOptions","FitBoundsOptions"]
examples: ["getting-started/geojson-viewer","crs-switch"]
stability: stable
verifiedVersion: 0.9.0
---

# Camera

The camera controls a two-dimensional map's center and scale. Centers use projected/data coordinates; `zoom` is a WebMercator convenience, while `scale` works with any CRS.

## Move the view immediately or smoothly

```ts
map.jumpTo({ center: [121.47, 31.23], zoom: 10 });
map.easeTo({ center: [121.5, 31.2], scale: 4, duration: 600 });
map.panBy([80, 0], { duration: 250 });
map.zoomTo(12, { duration: 250 });
map.flyTo({ center: [121.47, 31.23], zoom: 11, speed: 1.2 });
```

`jumpTo()` moves immediately. `easeTo()`, `panTo()`, `panBy()`, `zoomTo()`, and `flyTo()` accept `duration`, `easing`, or `animate: false`. Each new animation replaces a running camera animation; `map.stop()` cancels it.

## Fit data bounds

Fit known bounds with `Bounds`, or read bounds from a source:

```ts
const bounds = new Bounds(121.2, 31.1, 121.8, 31.5);
map.fitBounds(bounds, { padding: 32, duration: 400 });

const extent = source.getExtent();
if (extent.hasBounds()) map.fitBounds(extent);
```

`fitBounds()` uses data coordinates and accepts `padding` and `maxScale`. Call `map.resize()` after the container changes size to update the canvas and viewport.

## Read and observe the view

```ts
const center = map.getCenter();
const zoom = map.getZoom();
const extent = map.getExtent();

map.on('moveend', (event) => {
  const savedView = { center: event.center, zoom: event.zoom };
});
```

Emap has no bearing or pitch. For data whose CRS gives zoom no meaning, use center, bounds, and scale rather than treating zoom as a business coordinate.

## Runnable examples

- [GeoJSON viewer](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [CRS switch](/mapseekai/emap/examples/crs-switch/)
