---
id: styling
slug: /guides/styling
title: Styling layers
api: ["SymbolStyle", "SymbolLayout", "SymbolPaint", "SymbolImage", "SymbolLabeling", "SymbolIconSettings", "Emap.setLayerSymbol", "Emap.removeLayerSymbol", "Emap.setSymbolLayoutProperty", "Emap.setSymbolPaintProperty", "IconOptions", "Emap.setLayerIcon", "LabelOptions", "Emap.setLayerLabel", "ClassificationResult", "ClassifyFeaturesOptions", "Emap.setPaintProperty", "FillPaint", "LayerSpecification", "LineDashStyle", "LinePaint", "PointMarkerShape", "StyleExpression", "Emap", "CirclePaint"]
examples: ["getting-started/lines","getting-started/point-style","getting-started/polygon-fill","getting-started/polygons","attribute-styling"]
stability: stable
verifiedVersion: 0.14.0
---

# Styling layers

Emap supports `fill`, `line`, and `circle` layers, attribute-driven styles, and attached text and image symbols. Layers reference a source and optional `source-layer`; later layers draw above earlier ones.


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

## Attached feature labels

`label` attaches text to an existing `circle`, `line` or `fill` layer, sharing its
data source and layer-tree entry. Parent visibility, filtering and removal also control its labels.

```ts
map.addLayer({
  id: 'city-points', source: 'cities', type: 'circle',
  paint: { 'circle-radius': 5 },
  label: { field: 'name', fontSize: 16, color: '#243447', haloWidth: 2 },
});
map.setLayerLabel('city-points', {
  field: 'name', fontSize: 18, allowOverlap: false,
  priority: ['get', 'population'],
});
map.setLayerLabel('city-points', null); // Remove labels, not the parent layer
```

`setLayerLabel` replaces the entire configuration. Choose `field` or `text`; `text`
accepts a literal string or the existing safe style-expression subset. Null values
are skipped. Font sizes, halos and `offset` use CSS pixels. Point labels try nearby
positions, line labels rotate as an upright text run, and polygon anchors avoid holes.
`placement: 'horizontal'` keeps line labels horizontal. Placement operates on whole text runs
with the point, line, and polygon anchors above. Per-character curved placement, callouts,
rule-based labeling, and QGIS PAL layouts require a separate application integration.
Polygon anchors are inside the valid area; the full text rectangle may extend outside it.

The Canvas2D renderer accepts this configuration. The luma branch draws batched
font-atlas quads in the existing GPU render pass. The local `luma-benchmark`, `luma-25d`
and `luma-vertex-editing` examples include parent-layer label settings. Labels are off
by default and allocate no font atlas or label index until enabled. Placement uses
cross-layer collision avoidance, at most 20,000 candidates and 2,000 labels per view,
with a default limit of 1,000 per layer. Priorities only rank the bounded candidate set.
Up to four 1024×1024 RGBA atlas pages require at most about 16 MiB each on CPU and GPU,
excluding source indexes. The luma path uses HarfBuzz shaping and shared RGB MSDF glyphs, with GPU fill and halo.
Default Noto subsets are hosted locally; custom outlines use `label.fontUrl` with TTF/OTF/WOFF1.
Ordinary size, color and DPR changes reuse glyphs; very wide halos can request a wider distance-range tier.
The Canvas2D renderer retains its compatible bitmap path.
During navigation previews labels temporarily transform with the old frame and are
laid out again when the gesture settles.

## Image symbols on existing point layers

`icon` sets an image symbol on an existing `circle` layer, sharing its layer-tree node.
Parent visibility, filters, point LOD and labels apply to the same layer.

```ts
map.setLayerIcon('city-points', {
  url: '/images/pin.png', size: 32, anchor: [0.5, 1],
  rotation: 0, offset: [0, -2], opacity: 1,
});
map.setLayerIcon('city-points', null); // Restore the ordinary point symbol.
```

A numeric size is the CSS-pixel height with preserved aspect ratio; an explicit `[width, height]`
sets both dimensions. Optional `rect: [x, y, width, height]` crops a shared atlas, and `tint`
recolors its alpha mask. PNG/JPEG/WebP and self-contained SVG images are supported.
The luma backends reuse resident point buffers; the Canvas2D painter also supports this API.
Loading failures keep ordinary points and report the error. Configure images per layer; picking
uses point-layer rules and density display uses PointLod. Per-feature image mapping, alpha-pixel
picking, and count-based clustering require application implementations.
## Unified attached symbol settings

Use `symbol.layout / symbol.paint` on the existing parent layer. Property names are inspired by
MapLibre; settings map to the existing label/icon renderer and share the parent layer-tree node,
luma, MSDF, HarfBuzz and point LOD. Layer types are circle/line/fill.

```ts
map.addLayer({
  id: 'poi', type: 'circle', source: 'poi',
  paint: { 'circle-radius': 4, 'circle-color': '#2563eb' },
  symbol: {
    images: { marker: { url: '/images/marker.png', size: [24, 32] } },
    layout: {
      'icon-image': 'marker', 'icon-size': 1, 'icon-anchor': 'bottom',
      'text-field': ['get', 'name'], 'text-size': 14,
      'text-offset': [0, 1.2], 'text-allow-overlap': false,
    },
    paint: {
      'icon-opacity': 1, 'text-color': '#243447',
      'text-halo-color': '#ffffff', 'text-halo-width': 1.5,
    },
  },
});
map.setSymbolLayoutProperty('poi', 'text-size', 20);
map.setSymbolPaintProperty('poi', 'icon-opacity', 0.6);
map.setSymbolLayoutProperty('poi', 'text-offset', null);
// map.setLayerSymbol('poi', null); // Remove attached text/icons, keeping the parent
```

`text-offset` uses ems and is converted using text-size. `icon-size` multiplies the image definition's
explicit reference CSS size: a height preserving aspect ratio, or [width,height]. The application supplies this logical size explicitly.
 Icon offset is scaled then rotated; icon-anchor uses nine named
anchors. Nested visibility affects attached symbols only; parent visibility still controls the layer.

Supported properties are text-field/size/font/offset/allow-overlap/padding,
icon-image/size/anchor/rotate/offset, text-color/halo-color/halo-width and icon-opacity/color.
Text-font accepts one family/face name in an array. QGIS-style advanced labeling controls live in
`symbol.labeling`: placement, priority, maxLabels, minScale, maxScale, fontUrl, fontWeight,
fontStyle and enabled. The small icon-only compatibility block is `symbol.icon` with enabled
and a custom normalized anchor; ordinary anchors still use `icon-anchor`.

Use the listed properties to configure attached symbols. Complete MapLibre Style documents,
sprite/glyph services, transitions, and data-driven sizes/colors/icon selection require a separate
style integration. Attached symbols reuse placement and alpha-mask icon coloring.
Validation reports keys outside this set and preserves the prior configuration.
Whole-object replacement uses setLayerSymbol; removeLayerSymbol is equivalent to
setLayerSymbol(id, null). Null/undefined in a property setter removes that property and restores its default.

Legacy label/icon APIs remain supported. When symbol exists it is authoritative; legacy setters
update its corresponding channel and preserve the other one. getLayer returns a cloned symbol
and the materialized label/icon compatibility views.
