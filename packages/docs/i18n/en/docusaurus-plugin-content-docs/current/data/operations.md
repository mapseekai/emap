---
id: operations
slug: /data/operations
title: Data operations
api: ["AffineLayerOptions", "ApplyExpressionOptions", "BufferOptions", "CheckGeometryOptions", "CleanOptions", "ClipEraseOptions", "DataFillOptions", "DissolveOptions", "DivideOptions", "DragSessionOptions", "DropLayerOptions", "Emap", "ExplodeOptions", "ExportSnapshotOptions", "ExpressionEvaluationPolicy", "FeatureAffineSession", "FeatureRef", "FeatureTranslateSession", "FilterFieldsOptions", "FilterGeomOptions", "FilterIslandsOptions", "FilterOptions", "FilterSliversOptions", "GeometryCheckReport", "HighlightStyle", "InnerlinesOptions", "IntersectionPointsLayerOptions", "JoinTableData", "JoinTableOptions", "LinesOptions", "LoadSnapshotOptions", "MapOptions", "MergeLayersOptions", "MosaicOptions", "PointsMode", "PointsOptions", "PolygonsOptions", "ProjectLayerExport", "ProjectLayerOutputOptions", "ProjectOptions", "QueriedFeature", "QueryFeaturesOptions", "RebuildTopologyOptions", "RenameFieldsOptions", "RenameLayerOptions", "SimplifyMethod", "SimplifyOptions", "SnapOptions", "SortFeaturesOptions", "SplitCutter", "SplitFeatureHandler", "SplitFeatureOptions", "SplitLayerOptions", "SplitSelectedOptions", "SplitSelectedResult", "UnionOptions", "UniqueFeaturesOptions", "OpResult", "OpError", "ClassifyFeaturesOptions"]
examples: ["buffer","clip-erase","dissolve","filter-features","merge-selected","simplify","split-features","union"]
stability: stable
verifiedVersion: unreleased
---

# Data operations

`map.ops` is Emap's mapshaper data-processing interface. Each method resolves sources and layers, runs its operation, updates history and selection, and returns a `Promise<OpResult>`.

## Calls and errors

Operations use typed options. `source` is a source ID and `target` is a source-layer name or target expression. Operations that support an output layer may also accept `name` or `noReplace`; use the corresponding option type for its exact contract.

```ts
const result = await map.ops.bufferLayer({
  source: 'main',
  target: 'roads',
  radius: 250,
});

if (!result.ok) {
  console.error(result.error);
}
```

`BufferOptions` uses `radius`, with units from the dataset CRS. Successful results are in `result.value`; failed results are `OpError` values discriminated by `kind`.

```ts
const result = await map.ops.checkGeometry({ source: 'main' });
if (!result.ok && result.error.kind === 'validation') {
  console.error(result.error.field, result.error.reason);
}
```

## `map.ops` catalog

| Category | Methods |
| --- | --- |
| Overlay, topology, and geometry | `clipLayer`, `eraseLayer`, `dissolveLayer`, `bufferLayer`, `simplifyLayer`, `projectLayer`, `affineLayer`, `cleanLayer`, `snapLayer`, `mosaicLayer`, `unionLayers`, `divideLayer` |
| Feature geometry | `filterIslands`, `filterSlivers`, `filterGeom`, `explodeLayer`, `innerlinesLayer`, `pointsLayer`, `linesLayer`, `polygonsLayer`, `intersectionPointsLayer` |
| Layer management | `renameLayer`, `mergeLayers`, `splitLayer`, `dropLayer` |
| Attributes and filtering | `applyExpression`, `filterFeatures`, `sortFeatures`, `uniqueFeatures`, `filterFields`, `renameFields`, `classifyFeatures`, `joinTable`, `dataFill` |
| Topology inspection | `rebuildTopology`, `checkGeometry` |
| Selection and editing | `mergeSelected`, `splitSelected`, `reshapeSelected`, `autoCompletePolygon`, `addRing`, `deleteRing`, `fillRing`, `addPart`, `deletePart` |

## Common operations

```ts
await map.ops.simplifyLayer({
  source: 'main',
  target: 'districts',
  percentage: 0.25,
  keepShapes: true,
});

await map.ops.clipLayer({
  source: 'main',
  target: 'parcels',
  mask: 'boundary',
});

await map.ops.eraseLayer({
  source: 'main',
  target: 'parcels',
  mask: 'restricted',
});

await map.ops.dissolveLayer({
  source: 'main',
  target: 'districts',
  field: 'province',
});
```

`projectLayer()` creates a detached export file and does not modify the map. Download its returned `blob` and `filename`; use `map.reproject()` to change the map-wide CRS.

```ts
const result = await map.ops.projectLayer({
  source: 'main',
  target: 'districts',
  crs: 'EPSG:3857',
  output: { format: 'geojson', filename: 'districts-3857.geojson' },
});
```

Expressions, `where`, and `calc` obey the map's `expressionPolicy`. `joinTable()` joins external table data through `keys` and `data`; `classifyFeatures()` returns classification output.

## Selection operations and history

`mergeSelected()`, `splitSelected()`, `reshapeSelected()`, and the ring/part methods operate on Emap's selection. `splitSelected()` requires a selection from one source and layer: a point cutter splits lines, and a polyline cutter splits lines or polygons. Each successful operation creates one history entry.

Use `map.beginTransaction()` to group operations into one undo step:

```ts
const tx = map.beginTransaction();
const simplified = await map.ops.simplifyLayer({
  source: 'main',
  percentage: 0.4,
});

if (simplified.ok) {
  await tx.commit('Simplify data');
} else {
  tx.rollback();
}
```

Operations that change feature count clear or remap selection. Attribute and CRS operations preserve feature identity when possible. Run processing through `map.ops` to keep history, caches, and selection synchronized.

## API

- [Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [OpResult](/mapseekai/emap/api/types/emap.OpResult.html)
- [OpError](/mapseekai/emap/api/types/emap.OpError.html)
- [BufferOptions](/mapseekai/emap/api/interfaces/emap.BufferOptions.html)
- [SimplifyOptions](/mapseekai/emap/api/interfaces/emap.SimplifyOptions.html)
- [ProjectOptions](/mapseekai/emap/api/interfaces/emap.ProjectOptions.html)
- [ClassifyFeaturesOptions](/mapseekai/emap/api/interfaces/emap.ClassifyFeaturesOptions.html)

## Runnable examples

- [Buffer](/mapseekai/emap/examples/buffer/)
- [Clip and erase](/mapseekai/emap/examples/clip-erase/)
- [Dissolve](/mapseekai/emap/examples/dissolve/)
- [Filter features](/mapseekai/emap/examples/filter-features/)
- [Merge selected features](/mapseekai/emap/examples/merge-selected/)
- [Simplify](/mapseekai/emap/examples/simplify/)
- [Split features](/mapseekai/emap/examples/split-features/)
- [Union](/mapseekai/emap/examples/union/)
