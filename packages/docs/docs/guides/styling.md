---
id: styling
slug: /guides/styling
title: 样式图层
api: ["ClassificationResult", "ClassifyFeaturesOptions", "Emap.setPaintProperty", "FillPaint", "LayerSpecification", "LineDashStyle", "LinePaint", "PointMarkerShape", "StyleExpression", "Emap", "CirclePaint"]
examples: ["getting-started/lines","getting-started/point-style","getting-started/polygon-fill","getting-started/polygons","attribute-styling"]
stability: stable
verifiedVersion: unreleased
---

# 样式图层

Emap 使用 `fill`、`line` 和 `circle` 渲染图层。图层引用一个 source 和可选的 `source-layer`；后添加的图层绘制在上方。

## 添加 fill、line 和 circle 图层

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

`fill` 支持 `fill-color` 和 `fill-opacity`，也可使用 line paint 描边。`line` 支持 `line-color`、`line-width`、`line-dasharray`、`line-dashstyle`、`line-arrow-spacing` 和 `line-arrow-size`。`circle` 支持 `circle-color`、`circle-radius`、`circle-fill` 和 `circle-shape`。

## 在运行时修改 paint

```ts
map.setPaintProperty('parcel-fill', 'fill-opacity', 0.6);
map.setPaintProperty('parcel-outline', 'line-width', 3);
map.setLayerVisibility('stations', 'none');
```

用 `map.moveLayer(id, beforeId)` 调整顺序；不提供 `beforeId` 时图层移到顶部。

## 属性驱动样式

`fill-color`、`line-color` 和 `circle-color` 接受颜色字符串或 `StyleExpression`；line 图层的 `line-dashstyle` 和 circle 图层的 `circle-shape` 同样接受表达式，取值必须是各自枚举成员（非法值回退到图层静态值）。fill 图层的轮廓不支持表达式。表达式是受限、无 `eval` 的子集：`get`、`match`、`step`、`interpolate`（仅 `linear`）、`==`、`!=`、`<`、`<=`、`>`、`>=`、`!`、`all` 和 `any`。其他 MapLibre 表达式不受支持。

```ts
map.setPaintProperty('parcel-fill', 'fill-color', [
  'match', ['get', 'zone'],
  'residential', '#8ecae6',
  'industrial', '#ffb703',
  '#adb5bd',
]);
```

`styleSource: 'mapshaper'` 是另一种显式样式来源：fill 和 circle 图层读取记录的 `fill` 字段，line 图层读取 `stroke` 字段。

## 可运行示例

- [面填充](/mapseekai/emap/examples/getting-started/polygon-fill/)
- [线样式](/mapseekai/emap/examples/getting-started/lines/)
- [属性样式](/mapseekai/emap/examples/attribute-styling/)
