---
id: emap
slug: /concepts/emap
title: Emap map instance
api: ["Emap","Feature","FeatureAccessor","FeatureQuery","findInvalidFieldName","HighlightManager","isValidFieldName","isValidLayerName","quoteCliArg"]
examples: ["getting-started/geojson-viewer"]
stability: stable
verifiedVersion: 0.5.0
---

# Emap map instance

`Emap` owns the canvas, camera, registered sources, layer order, controls, handlers, history, and worker routing for one map container.

## Behavior notes

Create it with `{ container }`. `interactive` defaults to `true`; `useWorker` defaults to `false`; `workerThreshold` defaults to `50000`; `expressionPolicy` defaults to `disabled`.

## API

- [src.Emap](https://zwishing.github.io/emap/api/classes/index.Emap.html)

## Runnable examples

- [getting-started/geojson-viewer](https://zwishing.github.io/emap/examples/getting-started/geojson-viewer/)
- [interaction-handlers](https://zwishing.github.io/emap/examples/interaction-handlers/)

## Minimal snippet

```ts
new Emap({ container: "map" })
map.addSource("main", source)
map.addLayer({ id: "fill", type: "fill", source: "main" })
```
