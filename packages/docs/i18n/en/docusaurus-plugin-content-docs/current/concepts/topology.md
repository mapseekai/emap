---
id: topology
slug: /concepts/topology
title: Topology model
api: ["ReadonlyArcCollection","ReadonlyArcVertexData","ReadonlyCoord2","ReadonlyDataTable","ReadonlyFeatureShape","ReadonlyMapshaperDataset","ReadonlyMapshaperLayer","ReadonlyNumericArray","ReadonlyPathPart","ReadonlyPathShape","ReadonlyPointShape"]
examples: ["rebuild-topology","vertex-editing"]
stability: stable
verifiedVersion: 0.5.0
---

# Topology model

Emap stores geometry in a mapshaper dataset. Line and polygon coordinates are
not repeated in every feature; shapes reference shared arcs. Adjacent polygons
that share a boundary reference the same arc coordinates.

## Why topology matters

- Editing a shared boundary can keep neighboring features connected.
- Simplification processes a shared arc once instead of opening different
  gaps on each side.
- Inner-line extraction, dissolve, clip, and topology repair can use adjacency.
- Several layers may reuse one `ArcCollection`.

Point layers store coordinates directly in shapes and do not use arcs.

## Dataset structure

```text
MapshaperDataset
├─ arcs: ArcCollection
└─ layers: MapshaperLayer[]
   ├─ geometry_type
   ├─ shapes
   └─ data
```

A shape array index is its feature ID. Path shapes contain signed arc IDs that
describe direction and path order. Applications normally use query and editing
APIs rather than interpreting signed IDs directly.

## Read-only inspection

```ts
const dataset = source.getDataset();
const layers = source.getLayers();

if (dataset) {
  console.log(dataset.arcs?.getPointCount());
}

console.log(layers.map((layer) => layer.name));
```

`getDataset()` returns a zero-copy, deeply read-only TypeScript view of the
current live object, not a copy. Nested layers, shapes, records, and metadata
are read-only, and arcs expose query methods only. JavaScript, `any`, and
explicit assertions can still bypass this type boundary, so mutations must use
the entry points below.

## Choose the correct mutation entry point

| Change | Entry point |
|---|---|
| Property or field | `map.attributes` or an attribute operation |
| Feature transform or vertex | Edit command or handler |
| Simplify, dissolve, clip, buffer | `map.ops.*` |
| Reproject every registered dataset | `map.reproject(...)` |
| Reproject a detached source | `TopologySource.reproject(...)` |
| Replace a detached source's dataset | `TopologySource.setDataset(...)` |

Direct mutation bypasses history, spatial indexes, display arcs, selection
maintenance, and rendering invalidation.

## Rebuild topology

After import or editing, rebuild intersections and shared boundaries with:

```ts
const result = await map.ops.rebuildTopology({
  source: 'main',
  snapInterval: 0.001,
});

if (!result.ok) {
  console.error(result.error);
}
```

`snapInterval` uses dataset coordinate units. A value that is too large merges
distinct vertices; do not guess the unit when CRS is unknown.

## Simplification and display LOD

`DisplayArcs` maintains zoom-dependent simplification for rendering. Display
simplification does not delete coordinates from the source dataset. Use
`map.ops.simplifyLayer(...)` only when output geometry should be permanently
simplified.

Do not set the ArcCollection retained interval directly; it conflicts with
Emap's LOD management.

## Operation effects and selection

Operations are classified as `shape-count`, `topology-only`, `attribute-only`,
or `crs-only`. Emap uses the effect to preserve, remap, or clear selection and
to invalidate indexes. A shape-count operation may change feature IDs, so old
references must not be retained.

## Troubleshooting

- For gaps after editing adjacent polygons, ensure the edit used shared-arc
  commands and consider `rebuildTopology` with a CRS-appropriate interval.
- Use `map.attributes` instead of mutating data-table records.
- Rendering LOD and permanent simplification are separate.
  `TopologySource.export()` exports complete geometry unless a simplify
  operation changed the dataset.

## API

- [TopologySource](/mapseekai/emap/api/classes/index.TopologySource.html)
- [ITopologySource](/mapseekai/emap/api/interfaces/index.ITopologySource.html)
- [MapshaperDataset](/mapseekai/emap/api/interfaces/index.MapshaperDataset.html)
- [ArcCollection](/mapseekai/emap/api/interfaces/index.ArcCollection.html)

## Runnable examples

- [Rebuild topology](/mapseekai/emap/examples/rebuild-topology/)
- [Inner lines](/mapseekai/emap/examples/innerlines/)
- [Vertex editing](/mapseekai/emap/examples/vertex-editing/)
- [Simplify](/mapseekai/emap/examples/simplify/)
