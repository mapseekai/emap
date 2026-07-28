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

- [src.Emap](/emap/api/classes/index.Emap.html)
- [src.TopologySource](/emap/api/classes/index.TopologySource.html)

## Runnable examples

- [getting-started/geojson-viewer](/emap/examples/getting-started/geojson-viewer/)
- [duckdb-query](/emap/examples/duckdb-query/)

## Minimal snippet

```ts
if (source.getExtent().hasBounds()) map.setExtent(source.getExtent())
```
