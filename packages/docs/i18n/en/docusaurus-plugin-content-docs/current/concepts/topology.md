---
slug: /concepts/topology
title: Topology model
---

# Topology model

emap keeps mapshaper topology intact: shared arcs stay shared, edits route through commands, and render LOD is rebuilt from the source dataset.

## Behavior notes

`getDataset()` returns the live dataset for read-only inspection. Mutate through `Emap.ops`, edit sessions, or custom `EditCommand` objects so caches and history stay coherent.

## API

- [src.TopologySource](https://zwishing.github.io/emap/api/classes/index.TopologySource.html)
- [src.ITopologySource](https://zwishing.github.io/emap/api/interfaces/index.ITopologySource.html)

## Runnable examples

- [rebuild-topology](https://zwishing.github.io/emap/examples/rebuild-topology/)
- [innerlines](https://zwishing.github.io/emap/examples/innerlines/)

## Minimal snippet

```ts
const dataset = source.getDataset()
const layers = source.getLayers()
await map.ops.rebuildTopology({ source: "main" })
```
