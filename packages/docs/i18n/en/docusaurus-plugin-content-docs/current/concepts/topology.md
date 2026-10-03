---
id: topology
slug: /concepts/topology
title: Topology model
api: ["ReadonlyArcCollection", "ReadonlyArcVertexData", "ReadonlyCoord2", "ReadonlyDataTable", "ReadonlyFeatureShape", "ReadonlyMapshaperDataset", "ReadonlyMapshaperLayer", "ReadonlyNumericArray", "ReadonlyPathPart", "ReadonlyPathShape", "ReadonlyPointShape", "TopologySource", "ArcCollection", "MapshaperDataset"]
examples: ["rebuild-topology","vertex-editing","simplify"]
stability: stable
verifiedVersion: 0.14.0
---

# Topology model

Emap stores lines and polygons in a mapshaper topology dataset: path shapes reference arc IDs, shared boundaries reference one arc, and point shapes retain coordinates.

Shared arcs support consistent boundary edits. Applications can retain or split sharing for each editing task and rebuild topology to recompute intersections.

```ts
const dataset = source.getDataset(); // read the source's live readonly dataset view
const layers = source.getLayers(); // read live readonly layer views
const arcs = source.getArcs(); // read the live readonly shared-arc view
console.log(arcs?.getPointCount?.()); // read the total arc vertex count
```

## Core structure

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `layers` | `MapshaperLayer[]` | Required | Layers; `shapes` indexes align with `data.records`. |
| `arcs` | `ArcCollection \| undefined` | `undefined` | Shared line and polygon vertices; omitted by point-only or attribute-only datasets. |
| `info` | Metadata object \| `undefined` | `undefined` | CRS, import, and runtime metadata. |
| `layer.geometry_type` | `'point' \| 'polyline' \| 'polygon' \| undefined` | `undefined` | Shape geometry semantics. |
| `layer.shapes` | `(FeatureShape \| null)[] \| null` | `null` | `null` retains deleted-feature positions; paths use arc IDs, points use coordinates. |
| `layer.data` | `DataTable \| undefined` | `undefined` | Attribute records aligned with `shapes`. |
| `editVersion` / `attributeVersion` | `number \| undefined` | `undefined` | Geometry / attribute edit version. |

Path parts list arc IDs in order; negative IDs use `~id` for reverse traversal.

## More readonly queries

```text
MapshaperDataset
├─ layers: MapshaperLayer[]              // layer order
├─ arcs?: ArcCollection                  // shared vertex storage for lines and polygons
└─ info?: { crs_string, prj, wkt1, ... } // CRS and import-source metadata
   └─ layer
      ├─ geometry_type: 'point' | 'polyline' | 'polygon'
      ├─ shapes
      └─ data
```

Read APIs return zero-copy readonly live source views.

| API | Parameters | Return type | Description |
| --- | --- | --- | --- |
| `getDataset()` | None | `ReadonlyMapshaperDataset \| undefined` | Dataset, layers, and metadata. |
| `getLayers()` | None | `readonly ReadonlyMapshaperLayer[]` | Layers, shapes, and attributes. |
| `getArcs()` | None | `ReadonlyArcCollection \| undefined` | Path-arc queries. |
| `arcs?.getPointCount?.()` | None | `number \| undefined` | Total arc vertices. |
| `size()` / `getArcIter(arcId)` | `arcId: number` | `number` / `ArcIterator` | Arc count / one arc's vertices. |
| `getVertexData?()` / `getVertex2?(vertexId)` | `vertexId: number` | `ReadonlyArcVertexData \| undefined` / `readonly [number, number] \| null` | Bulk data / global vertex. |
| `getSimpleShapeBbox?(shapeIds, bbox)` | `shapeIds: number[]`, `bbox: number[]` | `void` | Write a shape extent. |
| `getRecordAt?(id)` / `getRecords?()` | `id: number` | One / all readonly attribute records | Attribute records. |
| `getFields?()` / `size?()` | None | `readonly string[] \| undefined` / `number \| undefined` | Field names / attribute-record count. |

| Type | Structure | Description |
| --- | --- | --- |
| `ReadonlyMapshaperLayer` | `readonly name/id/geometry_type`, `readonly shapes`, `ReadonlyDataTable` | Layer features, type, and attributes. |
| `ReadonlyFeatureShape` | `ReadonlyPathShape \| ReadonlyPointShape \| ReadonlyCoord2` | Path, multipoint, or single-coordinate feature. |
| `ReadonlyPathShape` / `ReadonlyPathPart` | Readonly part / signed arc-ID arrays | Ring or polyline arcs. |
| `ReadonlyPointShape` / `ReadonlyCoord2` | Readonly coordinate arrays / `readonly [number, number]` | Point or multipoint coordinates. |
| `ReadonlyArcVertexData` | `xx`, `yy`, `nn`, `ii`, `bb`, `zz` | Bulk vertex data. |
| `ReadonlyDataTable` | `getRecordAt?`, `getRecords?`, `getFields?`, `size?()` | Fields and attribute records. |

## Editing and shared boundaries

Vertex edits change the referenced arc. `splitSharedArcs: true` splits arcs shared by selected features and unselected neighbors; `false` retains sharing. `Emap.editSession.*` handles interactive editing and `Emap.ops.*` handles undoable dataset operations.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `splitSharedArcs` | `boolean` | `true` | Split arcs shared by selected and unselected neighbor features. |

```ts
const result = await map.ops.rebuildTopology({
  // recompute intersections and shared boundaries
  source: 'main', // select the source to rebuild
  snapInterval: 0.001, // set vertex snap distance in source-CRS units
});

if (!result.ok) console.error(result.error); // handle an operation failure
```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `source` | `string` | Required | Source ID to rebuild. |
| `snapInterval` | `number \| undefined` | Auto-detected | Vertex snap distance in source-CRS units. |
| `noSnap` | `boolean \| undefined` | `undefined` | Skip snap preprocessing. |
| `rebuildTopology` | `boolean \| undefined` | `undefined` | Rebuild shared arcs even when cut points stay the same. |

## Rendering and data simplification

Display LOD chooses simplified arcs by view scale while retaining full coordinates; data simplification permanently changes exported geometry.

## API

- [TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)
- [MapshaperDataset](/mapseekai/emap/api/interfaces/emap.MapshaperDataset.html)
- [ArcCollection](/mapseekai/emap/api/interfaces/emap.ArcCollection.html)

## Runnable examples

- [Rebuild topology](/mapseekai/emap/examples/rebuild-topology/)
- [Vertex editing](/mapseekai/emap/examples/vertex-editing/)
- [Simplify](/mapseekai/emap/examples/simplify/)
