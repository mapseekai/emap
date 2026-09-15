---
id: topology
slug: /concepts/topology
title: Topology model
api: ["ReadonlyArcCollection", "ReadonlyArcVertexData", "ReadonlyCoord2", "ReadonlyDataTable", "ReadonlyFeatureShape", "ReadonlyMapshaperDataset", "ReadonlyMapshaperLayer", "ReadonlyNumericArray", "ReadonlyPathPart", "ReadonlyPathShape", "ReadonlyPointShape", "TopologySource", "ArcCollection", "MapshaperDataset"]
examples: ["rebuild-topology","vertex-editing","simplify"]
stability: stable
verifiedVersion: 0.12.0
---

# Topology model

Emap stores lines and polygons in a mapshaper topology dataset. Path-feature shapes reference arc IDs instead of repeating coordinates in every feature. Adjacent polygons reference the same arc for their shared boundary; point features store coordinates directly in their shapes and do not use arcs.

## What shared arcs provide

A shared boundary has one set of coordinates, so editing a vertex on that arc is reflected in every adjacent feature that references it and keeps the boundary consistent. Simplifying a shared arc also processes it once, so the two sides do not acquire different shapes. Inner-line extraction, dissolve, clip, and topology rebuilding use the same adjacency.

```text
MapshaperDataset
├─ arcs: ArcCollection
└─ layers: MapshaperLayer[]
   ├─ geometry_type
   ├─ shapes
   └─ data
```

The array index of a layer's `shapes` is its feature ID. Signed arc IDs in a path shape encode arc direction and order. Applications normally work with features through query, rendering, and editing APIs rather than interpreting those IDs.

## Inspect topology data

```ts
const dataset = source.getDataset();
const layers = source.getLayers();
const arcs = source.getArcs();

console.log(layers.map((layer) => layer.name));
console.log(arcs?.getPointCount());
console.log(dataset?.layers.length);
```

These methods return zero-copy, read-only TypeScript views of live data. They are for inspection, not mutation; change data with edit commands, edit sessions, or `map.ops` so the map synchronizes history, selection, spatial indexes, and rendering.

## Editing and shared boundaries

Vertex editing changes the referenced arc. When translating selected features, `splitSharedArcs` defaults to `true`: Emap splits arcs shared by the selection and unselected neighbors first, leaving unselected neighbors in place. Setting `splitSharedArcs: false` retains the shared relationship, so the boundary moves with the selected feature.

Use topology rebuilding to recalculate intersections and shared boundaries from lines and polygons:

```ts
const result = await map.ops.rebuildTopology({
  source: 'main',
  snapInterval: 0.001,
});

if (!result.ok) console.error(result.error);
```

`snapInterval` uses dataset coordinate units. A value that is too large merges distinct vertices; choose it for the data CRS.

## Render simplification and data simplification

Emap's display LOD selects simplified arcs for drawing according to view scale without deleting coordinates from the source dataset. `map.ops.simplifyLayer(...)` permanently simplifies data and affects later exports.

## API

- [TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)
- [MapshaperDataset](/mapseekai/emap/api/interfaces/emap.MapshaperDataset.html)
- [ArcCollection](/mapseekai/emap/api/interfaces/emap.ArcCollection.html)

## Runnable examples

- [Rebuild topology](/mapseekai/emap/examples/rebuild-topology/)
- [Vertex editing](/mapseekai/emap/examples/vertex-editing/)
- [Simplify](/mapseekai/emap/examples/simplify/)
