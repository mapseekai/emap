---
slug: /guides/styling
title: Styling layers
---

# Styling layers

Style is intentionally small: fill, line, and circle paint objects map to Canvas drawing primitives.

## Behavior notes

`fill-opacity` defaults to opaque behavior when omitted, `line-width` defaults to `0.8`, `circle-radius` defaults to `4`, and `circle-fill` defaults to `true`.

## API

- [src.FillPaint](https://zwishing.github.io/emap/api/interfaces/index.FillPaint.html)
- [src.LinePaint](https://zwishing.github.io/emap/api/interfaces/index.LinePaint.html)
- [src.LayerSpecification](https://zwishing.github.io/emap/api/interfaces/index.LayerSpecification.html)

## Runnable examples

- [getting-started/polygons](https://zwishing.github.io/emap/examples/getting-started/polygons/)
- [getting-started/polygon-fill](https://zwishing.github.io/emap/examples/getting-started/polygon-fill/)

## Minimal snippet

```ts
map.addLayer({ id: "route", type: "line", source: "main", paint: { "line-color": "#335c99", "line-width": 2 } })
```
