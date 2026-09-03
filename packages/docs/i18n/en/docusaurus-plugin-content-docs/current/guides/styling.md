---
id: styling
slug: /guides/styling
title: Styling layers
api: ["ClassificationResult","ClassifyFeaturesOptions","Emap.setPaintProperty","FillPaint","LayerSpecification","LineDashStyle","LinePaint","PointMarkerShape","StyleExpression"]
examples: ["getting-started/lines","getting-started/point-style","getting-started/polygon-fill","getting-started/polygons"]
stability: stable
verifiedVersion: 0.8.1
---

# Styling layers

Emap styling maps directly to canvas drawing primitives. It has three render
layer types: `fill`, `line`, and `circle`. `fill-color` accepts the documented
restricted `StyleExpression` subset, but Emap does not attempt to implement the
complete MapLibre expression system; data calculation and presentation remain
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
| `fill-color` | `string \| StyleExpression` | A canvas color string or supported data expression |
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
    'line-dasharray': [8, 4],
  },
});
```

| Property | Type | Description |
|---|---|---|
| `line-color` | `string` | Any Canvas-compatible color string; defaults to `#1e88e5` |
| `line-width` | `number` | Stroke width; defaults to `0.8`; use `0` to disable the stroke |
| `line-dasharray` | `number[]` | Alternating dash and gap lengths such as `[8, 4]`; omit it or use an empty array for a solid line |
| `line-dashstyle` | `solid \| dash \| dot \| dash-dot \| arrow-dot` | Named line style; `arrow-dot` replaces the dots in a dash-dot line with repeated directional arrows |
| `line-arrow-spacing` | `number` | Arrow spacing for `arrow-dot` in CSS pixels; defaults to `32` |
| `line-arrow-size` | `number` | Arrow size for `arrow-dot` in CSS pixels; defaults to `6` |

Line widths and dash lengths use CSS pixels and are adjusted for the current Canvas render transform.

Directional arrows follow coordinate order by default. A polyline points from its first vertex to
its last vertex; polygon outer and inner rings each follow their own coordinate order. The current
style model has no direction-reversal field.

```ts
map.addLayer({
  id: 'direction-flow',
  type: 'line',
  source: 'main',
  paint: {
    'line-color': 'rgba(37, 99, 235, 0.85)',
    'line-width': 2,
    'line-dashstyle': 'arrow-dot',
    'line-arrow-spacing': 32,
    'line-arrow-size': 6,
  },
});
```

Arrows are sampled in screen pixels for the current visible viewport, so their size stays stable
across zoom and high-DPI displays. Numeric `line-dasharray` values continue to use the existing
Canvas dash batching path.

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
    'circle-shape': 'star',
    'circle-fill': true,
  },
});
```

`circle-radius` defaults to `4`; `circle-shape` defaults to `circle` and also accepts
`square`, `triangle`, `triangle-down`, `diamond`, `pentagon`, `star`, `cross`, `x`,
`hexagon`, and `octagon`. `circle-fill` defaults to `true`; set it to `false` to
draw only the marker outline.

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

## Attribute-driven styling

Since 0.9.0, fill layers support two attribute-driven fill paths. Both are
**explicit opt-ins** and never change the behavior of layers that do not
declare them.

### classifyFeatures: classified baking

`classifyFeatures` computes breaks for a field with a method (`quantile` /
`equal-interval` / `nice` / `categorical`, among others) and **bakes** the
color into each record's `fill` field:

```ts
const result = await map.ops.classifyFeatures({
  source: 'cities',
  target: 'cities',
  field: 'pop',
  method: 'equal-interval',
  classes: 4,
  colors: ['#eff3ff', '#bdd7e7', '#6baed6', '#2171b5'],
  nullValue: '#eeeeee', // optional: fill color for null/missing records
});
if (result.ok) {
  // Discriminated union: explicit-break and automatic-method calls return
  // different shapes; counts and class counts satisfy
  // classes === colors.length === breaks.length + 1.
  console.log(result.value.breaks, result.value.counts);
}
```

Field names are mapshaper-compatible (`fill` / `stroke` / `stroke-width` /
`r`). Baking is an ordinary undoable op: undo restores every record's
previous value.

### styleSource opt-in: render baked fields

When a fill layer declares `styleSource: 'mapshaper'`, the renderer reads
each record's baked `fill` color and fills per bucket; layers without
`styleSource` never read record fields:

```ts
map.addLayer({
  id: 'cities-fill',
  type: 'fill',
  source: 'cities',
  'source-layer': 'cities',
  styleSource: 'mapshaper',
});
```

Precedence: an explicit scalar `fill-color` paint always wins (a layer with a
declared static color is never hijacked by `styleSource`); baked fields are
read only when no scalar paint is present.

### Paint expression subset

`fill-color` also accepts an expression subset (no baking required):

```ts
map.addLayer({
  id: 'cities-choropleth',
  type: 'fill',
  source: 'cities',
  paint: {
    'fill-color': ['match', ['get', 'level'], 'a', '#111111', '#999999'],
    // or continuous: ['interpolate', 'linear', ['get', 'pop'], 0, '#000000', 100, '#ffffff']
    // or stepped:   ['step', ['get', 'pop'], '#eff3ff', 25, '#bdd7e7', 50, '#6baed6']
  },
});
```

Supported operators: `get`, `match`, `step`, `interpolate` (`linear`).
Expressions are validated synchronously by `addLayer` / `setPaintProperty`
and invalid ones throw immediately; a per-record evaluation error is isolated
into the theme-colored null bucket without affecting other features. More
than 256 classes still render and fire a `warning` event.

Performance: expression results are cached by (expression, dataset reference,
attributeVersion); vertex-level geometry edits do not trigger recomputation.
Measured: cold build for 100k records is about 4ms; cache hits are
effectively free.

## Defaults and troubleshooting

The fallback color is `#1e88e5`. Production applications should set colors
explicitly so different geometry types are distinguishable.

For an invisible layer, check:

1. `layout.visibility` is not `'none'`.
2. `source` and `source-layer` resolve.
3. `type` is compatible with the geometry.
4. The camera is over the data extent.
5. An opaque layer above it is not covering it.

For fill layers, `fill-color` already supports the expression subset and the
baked-field opt-in; see "Attribute-driven styling" above. Line and circle
paint values are still layer-level constants — for attribute-driven
categories, prepare multiple source layers or classify first, then assign
separate paint to each render layer.

## API

- [FillPaint](/mapseekai/emap/api/interfaces/emap.FillPaint.html)
- [LinePaint](/mapseekai/emap/api/interfaces/emap.LinePaint.html)
- [CirclePaint](/mapseekai/emap/api/interfaces/emap.CirclePaint.html)
- [LayerSpecification](/mapseekai/emap/api/interfaces/emap.LayerSpecification.html)

## Runnable examples

- [Line layer styling (color, width, and dashes)](/mapseekai/emap/examples/getting-started/lines/)
- [Polygons](/mapseekai/emap/examples/getting-started/polygons/)
- [Polygon fill](/mapseekai/emap/examples/getting-started/polygon-fill/)
