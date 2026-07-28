---
id: styling
slug: /guides/styling
title: 样式图层
api: ["FillPaint","LayerSpecification","LinePaint"]
examples: ["getting-started/lines","getting-started/polygon-fill","getting-started/polygons"]
stability: stable
verifiedVersion: 0.5.0
---

# 样式图层

样式面向 Canvas 基元保持精简：填充、线和圆点三类 paint 对象。

## 行为说明

省略 `fill-opacity` 时按不透明绘制，`line-width` 默认 `0.8`，`circle-radius` 默认 `4`，`circle-fill` 默认 `true`。

## API

- [src.FillPaint](/emap/api/interfaces/index.FillPaint.html)
- [src.LinePaint](/emap/api/interfaces/index.LinePaint.html)
- [src.LayerSpecification](/emap/api/interfaces/index.LayerSpecification.html)

## 可运行示例

- [getting-started/polygons](/emap/examples/getting-started/polygons/)
- [getting-started/polygon-fill](/emap/examples/getting-started/polygon-fill/)

## 最小片段

```ts
map.addLayer({ id: "route", type: "line", source: "main", paint: { "line-color": "#335c99", "line-width": 2 } })
```
