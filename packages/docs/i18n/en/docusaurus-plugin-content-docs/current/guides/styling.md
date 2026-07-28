---
id: styling
slug: /guides/styling
title: Styling layers
api: ["FillPaint","LayerSpecification","LinePaint"]
examples: ["getting-started/lines","getting-started/polygon-fill","getting-started/polygons"]
stability: stable
verifiedVersion: 0.5.0
---

# Styling layers

emap styling maps directly to canvas drawing primitives. It has three render
layer types: `fill`, `line`, and `circle`. It intentionally does not include a
large style-expression system; data calculation and presentation remain
separate concerns.

## Layer structure

```ts
map.addLayer({
  id: 'route',
  type: 'line',
  source: 'main',
  'source-layer': 'roads',
  layout: {
    visibility: 'visible',
  },
  paint: {
    'line-color': '#335c99',
    'line-width': 2,
  },
});
```

| Field | Meaning |
|---|---|
| `id` | Unique, stable render-layer ID |
| `type` | `fill`, `line`, or `circle` |
| `source` | A map source ID already registered through `addSource` |
| `source-layer` | Source-layer name inside a multi-layer dataset |
| `layout.visibility` | `'visible'` or `'none'` |
| `paint` | Draw properties for the selected layer type |

The source must be registered before `addLayer`; otherwise it throws “Source
not found.” A duplicate layer ID also throws.

## Polygon fills

Use `fill` with a polygon source layer:

```ts
map.addLayer({
  id: 'district-fill',
  type: 'fill',
  source: 'main',
  paint: {
    'fill-color': '#60a5fa',
    'fill-opacity': 0.55,
  },
});
```

| Property | Type | Meaning |
|---|---|---|
| `fill-color` | `string` | Any color string accepted by canvas |
| `fill-opacity` | `number` | Opacity, normally from `0` to `1` |

Add a separate `line` layer that references the same source layer when the
polygon boundary needs independent styling.

## Lines and polygon outlines

Use `line` for polylines or polygon outlines:

```ts
map.addLayer({
  id: 'district-outline',
  type: 'line',
  source: 'main',
  paint: {
    'line-color': '#1e3a8a',
    'line-width': 1.5,
  },
});
```

`line-width` defaults to `0.8` when omitted.

## Point layers

Use `circle` for point source layers:

```ts
map.addLayer({
  id: 'city',
  type: 'circle',
  source: 'main',
  'source-layer': 'cities',
  paint: {
    'circle-color': '#ef4444',
    'circle-radius': 5,
    'circle-fill': true,
  },
});
```

`circle-radius` defaults to `4`; `circle-fill` defaults to `true`. Set it to
`false` to draw only the circle outline.

## Layer order

Later layers draw above earlier layers. Supply a `before` ID when adding:

```ts
map.addLayer(labelLayer, 'district-outline');
```

Or move an existing layer:

```ts
map.moveLayer('district-fill', 'district-outline');
```

`addLayer` throws when its `before` target does not exist. `moveLayer` places
the layer last when its target does not exist.

## Runtime updates

Update one paint property:

```ts
map.setPaintProperty('district-fill', 'fill-opacity', 0.3);
map.setPaintProperty('district-outline', 'line-color', '#0f172a');
```

Toggle visibility:

```ts
map.setLayerVisibility('district-fill', 'none');
map.setLayerVisibility('district-fill', 'visible');
```

Remove a layer:

```ts
map.removeLayer('district-outline');
```

These methods schedule rendering. Do not mutate the object returned by
`map.getLayer(...)` as a way to refresh the map.

## Defaults and troubleshooting

The fallback color is `#1e88e5`. Production applications should set colors
explicitly so different geometry types are distinguishable.

For an invisible layer, check:

1. `layout.visibility` is not `'none'`.
2. `source` and `source-layer` resolve.
3. `type` is compatible with the geometry.
4. The camera is over the data extent.
5. An opaque layer above it is not covering it.

Paint values are layer-level constants. For attribute-driven categories,
prepare multiple source layers or use data operations to create classified
output, then assign separate paint to each render layer.

## API

- [FillPaint](/emap/api/interfaces/index.FillPaint.html)
- [LinePaint](/emap/api/interfaces/index.LinePaint.html)
- [CirclePaint](/emap/api/interfaces/index.CirclePaint.html)
- [LayerSpecification](/emap/api/interfaces/index.LayerSpecification.html)

## Runnable examples

- [Lines](/emap/examples/getting-started/lines/)
- [Polygons](/emap/examples/getting-started/polygons/)
- [Polygon fill](/emap/examples/getting-started/polygon-fill/)
