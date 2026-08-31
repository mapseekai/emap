---
id: camera
slug: /guides/camera
title: Camera
api: []
examples: []
stability: stable
verifiedVersion: 0.8.1
---

# Camera

The camera controls map center and scale. Emap is two-dimensional and does not
have bearing or pitch. Camera centers use current projected/data coordinates;
canvas pointers use container-local pixels.

## Instant movement

```ts
map.jumpTo({
  center: [120, 30],
  zoom: 7,
});
```

Set one component directly:

```ts
map.setCenter([120, 30]);
map.setZoom(7);
```

`zoom` is a WebMercator convenience. For another CRS, use CRS-independent
`scale` when an explicit scale is needed:

```ts
map.jumpTo({
  center: [500000, 3400000],
  scale: 0.002,
});
```

`scale` takes precedence when a call provides both `scale` and `zoom`.

## Fit data bounds

```ts
const extent = source.getExtent();

if (extent.hasBounds()) {
  map.fitBounds(extent, {
    padding: 48,
    duration: 0,
  });
}
```

`padding` is an equal pixel inset on every side. Use `duration: 0` or
`animate: false` for first paint, automation, or any immediate move.

`setExtent(extent)` directly replaces the viewport extent. `fitBounds` goes
through the camera lifecycle and supports padding, animation, and `maxScale`.

## Animation

```ts
map.easeTo({
  center: [121.47, 31.23],
  zoom: 9,
  duration: 800,
});
```

Pan or zoom individually:

```ts
map.panTo([121.47, 31.23], { duration: 500 });
map.panBy([80, 0], { duration: 300 });
map.zoomTo(10, { duration: 500 });
```

`panBy` accepts a canvas pixel offset.

Use van Wijk flight for a longer move:

```ts
map.flyTo({
  center: [116.4, 39.9],
  zoom: 8,
  speed: 1.2,
  curve: 1.42,
});
```

Only one camera animation is active. A later call ends the previous one.
Cancel explicitly with:

```ts
map.stop();
```

## Animation options

| Option | Meaning |
|---|---|
| `duration` | Milliseconds; ease/fly default is `1000` |
| `easing` | Function from progress `0..1` to eased progress |
| `animate` | `false` performs an immediate jump |
| `curve` | `flyTo` curvature, default `1.42` |
| `speed` | `flyTo` average screenfuls/second; overrides duration |

## Coordinate conversion

Map coordinates to canvas pixels:

```ts
const [x, y] = map.project(120, 30);
```

Canvas pixels to map coordinates:

```ts
const [mapX, mapY] = map.unproject(x, y);
```

`project` transforms between the current map coordinate space and the viewport;
it does not reproject between EPSG coordinate systems.

## Events and resize

```ts
map.on('movestart', ({ center, zoom }) => {
  console.log('start', center, zoom);
});

map.on('moveend', ({ center, zoom, originalEvent }) => {
  console.log('end', center, zoom, originalEvent);
});
```

Programmatic calls have `originalEvent: null`. The `move` event may not contain
all camera fields; use `moveend` for final state.

After an application panel or dialog changes the map container size:

```ts
map.resize();
```

The map listens to window resize, but application-only layout changes should
still notify it explicitly.

## Troubleshooting

- If loaded data is blank, verify its extent and call `setExtent` or
  `fitBounds`.
- For a non-WebMercator CRS, prefer data bounds, `fitBounds`, or `scale` over
  assuming zoom semantics.
- Call `map.stop()` when leaving a view that has an active animation.

## API

- [Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [CameraOptions](/mapseekai/emap/api/interfaces/emap.CameraOptions.html)
- [FitBoundsOptions](/mapseekai/emap/api/interfaces/emap.FitBoundsOptions.html)
- [FlyToOptions](/mapseekai/emap/api/interfaces/emap.FlyToOptions.html)

## Runnable examples

- [GeoJSON viewer](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [CRS switch](/mapseekai/emap/examples/crs-switch/)
- [Fit bounds recipe](../recipes/fit-bounds.md)
