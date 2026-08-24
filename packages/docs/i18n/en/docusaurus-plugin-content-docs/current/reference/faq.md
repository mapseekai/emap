---
id: faq
slug: /reference/faq
title: FAQ
api: []
examples: []
stability: stable
verifiedVersion: 0.5.0
---

# FAQ

If the map is blank, check container size, source load status, layer type/source IDs, and camera extent.

## Behavior notes

If an operation fails, check expression policy, missing fixtures, CRS constraints, and whether optional WASM dependencies were initialized.

## API

- [src.Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [src.TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)

## Runnable examples

- [getting-started/geojson-viewer](/mapseekai/emap/examples/getting-started/geojson-viewer/)
- [duckdb-query](/mapseekai/emap/examples/duckdb-query/)

## Minimal snippet

```ts
if (source.getExtent().hasBounds()) map.setExtent(source.getExtent())
```
