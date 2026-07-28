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

Style is intentionally small: fill, line, and circle paint objects map to Canvas drawing primitives.

## Behavior notes

`fill-opacity` defaults to opaque behavior when omitted, `line-width` defaults to `0.8`, `circle-radius` defaults to `4`, and `circle-fill` defaults to `true`.

## API

- [src.FillPaint](/emap/api/interfaces/index.FillPaint.html)
- [src.LinePaint](/emap/api/interfaces/index.LinePaint.html)
- [src.LayerSpecification](/emap/api/interfaces/index.LayerSpecification.html)

## Runnable examples

- [getting-started/polygons](/emap/examples/getting-started/polygons/)
- [getting-started/polygon-fill](/emap/examples/getting-started/polygon-fill/)

## Minimal snippet

```ts
map.addLayer({ id: "route", type: "line", source: "main", paint: { "line-color": "#335c99", "line-width": 2 } })
```
