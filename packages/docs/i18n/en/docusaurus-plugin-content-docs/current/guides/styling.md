---
id: styling
slug: /guides/styling
title: Styling layers
api: ["ClassificationResult","ClassifyFeaturesOptions","Emap.setPaintProperty","FillPaint","LayerSpecification","LineDashStyle","LinePaint","PointMarkerShape","StyleExpression","Emap","CirclePaint"]
examples: ["getting-started/lines","getting-started/point-style","getting-started/polygon-fill","getting-started/polygons","attribute-styling"]
stability: stable
verifiedVersion: 0.9.1
---

# Styling layers

Emap renders `fill`, `line`, and `circle` layers. A layer references a source and optional `source-layer`; later layers draw above earlier ones.

## Add fill, line, and circle layers

```ts
map.addLayer({
  id: 'parcel-fill',
  type: 'fill',
  source: 'parcels',
  'source-layer': 'lots',
  paint: { 'fill-color': '#4c956c', 'fill-opacity': 0.35 },
});

map.addLayer({
  id: 'parcel-outline',
  type: 'line',
  source: 'parcels',
  'source-layer': 'lots',
  paint: { 'line-color': '#1d3557', 'line-width': 2, 'line-dasharray': [6, 3] },
});

map.addLayer({
  id: 'stations',
  type: 'circle',
  source: 'stations',
  paint: { 'circle-color': '#e76f51', 'circle-radius': 6, 'circle-fill': true },
});
```

`fill` supports `fill-color` and `fill-opacity`, and may use line paint for an outline. `line` supports `line-color`, `line-width`, `line-dasharray`, `line-dashstyle`, `line-arrow-spacing`, and `line-arrow-size`. `circle` supports `circle-color`, `circle-radius`, `circle-fill`, and `circle-shape`.

## Change paint at runtime

```ts
map.setPaintProperty('parcel-fill', 'fill-opacity', 0.6);
map.setPaintProperty('parcel-outline', 'line-width', 3);
map.setLayerVisibility('stations', 'none');
```

Use `map.moveLayer(id, beforeId)` to change order; omit `beforeId` to move a layer to the top.

## Attribute-driven colors

`fill-color`, `line-color`, and `circle-color` accept a color string or `StyleExpression`. Expressions are a restricted, eval-free subset: `get`, `match`, `step`, `interpolate` (with `linear` only), `==`, `!=`, `<`, `<=`, `>`, `>=`, `!`, `all`, and `any`. Other MapLibre expressions are not supported.

```ts
map.setPaintProperty('parcel-fill', 'fill-color', [
  'match', ['get', 'zone'],
  'residential', '#8ecae6',
  'industrial', '#ffb703',
  '#adb5bd',
]);
```

`styleSource: 'mapshaper'` is another explicit style source: fill and circle layers read a record's `fill` field, while line layers read `stroke`.

## Runnable examples

- [Polygon fill](/mapseekai/emap/examples/getting-started/polygon-fill/)
- [Line styling](/mapseekai/emap/examples/getting-started/lines/)
- [Attribute styling](/mapseekai/emap/examples/attribute-styling/)
