---
id: styling
slug: /guides/styling
title: Styling layers
api: ["ClassificationResult", "ClassifyFeaturesOptions", "Emap.setPaintProperty", "FillPaint", "LayerSpecification", "LineDashStyle", "LinePaint", "PointMarkerShape", "StyleExpression", "Emap", "CirclePaint"]
examples: ["getting-started/lines","getting-started/point-style","getting-started/polygon-fill","getting-started/polygons","attribute-styling"]
stability: stable
verifiedVersion: 0.12.0
---

# Styling layers

Emap renders `fill`, `line`, and `circle` layers. Layers reference a source and optional `source-layer`; later layers draw above earlier ones.


```ts
map.addLayer({
  // add a polygon fill layer
  id: 'parcel-fill', // unique layer ID
  type: 'fill', // render polygons
  source: 'parcels', // added source ID
  'source-layer': 'lots', // data layer to render
  paint: { 'fill-color': '#4c956c', 'fill-opacity': 0.35 }, // fill appearance
});

map.addLayer({
  // add a polygon outline layer
  id: 'parcel-outline', // unique layer ID
  type: 'line', // render paths and outlines
  source: 'parcels', // added source ID
  'source-layer': 'lots', // data layer to render
  paint: { 'line-color': '#1d3557', 'line-width': 2, 'line-dasharray': [6, 3] }, // line appearance
});

map.addLayer({
  // add a point marker layer
  id: 'stations', // unique layer ID
  type: 'circle', // render point markers
  source: 'stations', // added source ID
  paint: { 'circle-color': '#e76f51', 'circle-radius': 6, 'circle-fill': true }, // marker appearance
});
```

## Core parameters

`LayerSpecification` combines fields by layer type:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` | Required | Unique layer identifier. |
| `type` | `'fill' \| 'line' \| 'circle'` | Required | `fill` paints polygons, `line` paints paths and outlines, `circle` paints point markers. |
| `source` | `string` | Required | Added source ID. |
| `source-layer` | `string` | First data layer in the source | Data layer to render; name, ID, or `layer-N`. |
| `paint` | `FillLayerPaint \| LinePaint \| CirclePaint` | Per-field defaults below | Layer drawing properties. |
| `layout.visibility` | `'visible' \| 'none'` | `'visible'` | Whether the layer renders. |
| `filter` | `StyleExpression` | Unset | `true` features render, pick, and appear in attribute filtering. |
| `styleSource` | `'mapshaper'` | Unset | Enables baked colors: fill and circle read `fill`, line reads `stroke`. |
| `pointLod` | `false \| { cellSize?: number }` | `{ cellSize: 8 }` | Circle only: CSS-pixel-grid representatives; `false` draws all, `cellSize` is 1–64. |

## More paint properties

### Line paint

`line` uses these `LinePaint` fields, also used for fill outlines.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `line-color` | `string \| StyleExpression` | `var(--emap-primary)` | Path color, polygon outline color in fill; expressions bucket records. |
| `line-width` | `number` | `0.8` | Path width in CSS pixels; `0` on a fill outline is fill-only. |
| `line-dasharray` | `readonly number[]` | Unset | Alternating dash and gap lengths in CSS pixels. |
| `line-dashstyle` | `LineDashStyle \| StyleExpression` | `'dash'` with `line-dasharray`, otherwise `'solid'` | Named pattern overriding `line-dasharray`; `arrow-dot` draws directional arrows; expression output is `LineDashStyle`. |
| `line-arrow-spacing` | `number` | `32` | `arrow-dot` arrow spacing in CSS pixels; minimum 4. |
| `line-arrow-size` | `number` | `6` | `arrow-dot` arrow-wing length in CSS pixels; minimum 2. |

`LineDashStyle`: `'solid'`, `'dash'`, `'dot'`, `'dash-dot'`, `'arrow-dot'`. Fill outlines read static `line-color` and `line-dashstyle`.

### Fill paint

`fill` adds interior fill on top of the shared `line-*` outline:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `fill-color` | `string \| StyleExpression` | `var(--emap-muted)` | Polygon color; expressions bucket records. |
| `fill-opacity` | `number` | `1` | Color-alpha multiplier, clamped to 0–1. |

### Circle paint

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `circle-color` | `string \| StyleExpression` | `var(--emap-primary)` | Marker color; expressions bucket records. |
| `circle-radius` | `number` | `4` | Marker radius in CSS pixels. |
| `circle-fill` | `boolean` | `true` | Whether marker interiors fill. |
| `circle-shape` | `PointMarkerShape \| StyleExpression` | `'circle'` | Canvas marker shape; expression output is `PointMarkerShape`. |

`PointMarkerShape`: `'circle'`, `'square'`, `'triangle'`, `'triangle-down'`, `'diamond'`, `'pentagon'`, `'star'`, `'cross'`, `'x'`, `'hexagon'`, `'octagon'`.

## More layer operations

```ts
map.setPaintProperty('parcel-fill', 'fill-opacity', 0.6);
map.setPaintProperty('parcel-outline', 'line-width', 3);
map.setLayerVisibility('stations', 'none');
```

`map.setPaintProperty(id, name, value)` updates paint property `name` on added layer `id`; `value` must match the property type. `map.moveLayer(id, beforeId)` changes order; omit `beforeId` to move a layer to the top.

## Attribute-driven styles

Color fields plus `line-dashstyle` and `circle-shape` accept `StyleExpression`; out-of-enum results retain the static value. Expressions validate when set and evaluate per record.

### Expression forms

`StyleExpression` is an eval-free array subset combining strings, numbers, booleans, `null`, and these forms.

| Operator | Accepted form | Behavior |
| --- | --- | --- |
| `get` | `['get', field]` | Reads a field; missing is `null`. |
| `==`, `!=` | `['==', left, right]`, `['!=', left, right]` | Strict equality. |
| `<`, `<=`, `>`, `>=` | `['>', left, right]`, and so on | Coerces both operands to numbers. |
| `!` | `['!', value]` | Inverts truthiness. |
| `all`, `any` | `['all', condition, ...]`, `['any', condition, ...]` | Combines conditions. |
| `match` | `['match', input, caseValue \| [caseValue, ...], output, ..., fallback]` | Strict match; final item is fallback. |
| `step` | `['step', input, output0, stop1, output1, ...]` | Finite ascending stops; nonnumeric and below-first-stop use `output0`. |
| `interpolate` | `['interpolate', 'linear', input, stop1, output1, stop2, output2, ...]` | At least two finite ascending stops; linear interpolation, endpoint clamping, static colors capped at 257 values. |

```ts
map.setPaintProperty('parcel-fill', 'fill-color', [
  'match',
  ['get', 'zone'],
  'residential',
  '#8ecae6',
  'industrial',
  '#ffb703',
  '#adb5bd',
]);
```

### Classified fill buckets

`map.ops.classifyFeatures()` bakes colors into a record field; fill layers with `styleSource: 'mapshaper'` bucket that field. Default `saveAs: 'fill'` matches the fill field.

```ts
await map.ops.classifyFeatures({
  source: 'parcels',
  target: 'lots',
  field: 'assessedValue',
  method: 'quantile',
  classes: 5,
  colors: ['#eff3ff', '#bdd7e7', '#6baed6', '#2171b5', '#08306b'],
});

map.addLayer({
  id: 'parcel-buckets',
  type: 'fill',
  source: 'parcels',
  'source-layer': 'lots',
  styleSource: 'mapshaper',
  paint: { 'fill-opacity': 0.7, 'line-color': '#fff', 'line-width': 0.5 },
});
```

`ClassifyFeaturesOptions` parameters:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `source` | `string` | Required | Source ID containing the target layer. |
| `target` | `string` | Required | Data-layer name or ID to classify. |
| `field` | `string` | Required | Classification attribute. |
| `method` | `'quantile' \| 'equal-interval' \| 'nice' \| 'categorical'` | Required | First three compute numeric breaks; `categorical` maps categories. |
| `classes` | `number` | `4` | Numeric class count; without `breaks`, integer at least 2. |
| `breaks` | `number[]` | Computed from `method` | Interior numeric breaks; supplied values are used directly. |
| `categories` | `(string \| number)[]` | Distinct values in first-occurrence order | `categorical` category list. |
| `colors` | `string[]` | Required | Numeric: `breaks.length + 1`; categorical: `categories.length`. |
| `saveAs` | `string` | `'fill'` | Per-record color field; line uses `'stroke'`. |
| `nullValue` | `string` | `var(--emap-muted)` | Baked color for `null` or `undefined`. |
| `otherColor` | `string` | `nullValue` | Color outside `categories`. |
| `invert` | `boolean` | `false` | Reverses baked color ramp. |

Successful `value` includes effective `breaks` or `categories`, `colors`, class `counts`, `nullColor`, `nullCount`, `saveAs`, and `featureCount`; categorical results also include `otherColor` and `otherCount`.

## Runnable examples

- [Polygon fill](/mapseekai/emap/examples/getting-started/polygon-fill/)
- [Line styling](/mapseekai/emap/examples/getting-started/lines/)
- [Attribute styling](/mapseekai/emap/examples/attribute-styling/)
