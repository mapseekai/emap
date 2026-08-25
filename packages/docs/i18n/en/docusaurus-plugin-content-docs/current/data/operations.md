---
id: operations
slug: /data/operations
title: Data operations
api: ["AffineLayerOptions","ApplyExpressionOptions","BufferOptions","CheckGeometryOptions","CleanOptions","ClipEraseOptions","DataFillOptions","DissolveOptions","DivideOptions","DragSessionOptions","DropLayerOptions","Emap","ExplodeOptions","ExportSnapshotOptions","ExpressionEvaluationPolicy","FeatureAffineSession","FeatureRef","FeatureTranslateSession","FilterFieldsOptions","FilterGeomOptions","FilterIslandsOptions","FilterOptions","FilterSliversOptions","GeometryCheckReport","HighlightFeatureRef","HighlightStyle","InnerlinesOptions","IntersectionPointsLayerOptions","JoinTableData","JoinTableOptions","LinesOptions","LoadSnapshotOptions","MapOptions","MergeLayersOptions","MosaicOptions","PointsMode","PointsOptions","PolygonsOptions","ProjectLayerExport","ProjectLayerOutputOptions","ProjectOptions","QueriedFeature","QueryFeaturesOptions","RebuildTopologyOptions","RenameFieldsOptions","RenameLayerOptions","SimplifyMethod","SimplifyOptions","SnapOptions","SortFeaturesOptions","SplitCutter","SplitFeatureHandler","SplitFeatureOptions","SplitLayerOptions","SplitSelectedOptions","SplitSelectedResult","UnionOptions","UniqueFeaturesOptions"]
examples: ["buffer","check-geometry","clip-erase","data-engineering","dissolve","divide","duckdb-overlay","duckdb-spatial-aggregate-join","explode","filter-features","innerlines","merge-layers","merge-selected","mosaic","project","rebuild-topology","rename-layer","simplify","simplify-control","snap-layer","split-features","split-layer","union"]
stability: stable
verifiedVersion: 0.5.0
---

# Data operations

`map.ops` wraps mapshaper processing as typed operations. It resolves sources
and layers, executes commands, records history, updates selection and caches,
and returns failures through `OpResult`.

## Call model

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

`BufferOptions` uses `radius`, not `distance`. Units come from the dataset CRS.

Common option concepts include:

| Field | Meaning |
|---|---|
| `source` | Map source ID |
| `target` | Source-layer name or target expression |
| `name` | New output-layer name for operations that support it |
| `noReplace` | Keep input and create output where supported |

Consult the specific interface; operations do not all accept the same fields.

## OpResult

```ts
const result = await map.ops.checkGeometry({
  source: 'main',
});

if (result.ok) {
  console.log(result.value);
} else {
  switch (result.error.kind) {
    case 'not-found':
      console.error(result.error.what, result.error.id);
      break;
    case 'validation':
      console.error(result.error.field, result.error.reason);
      break;
    default:
      console.error(result.error);
  }
}
```

`OpError` is a discriminated union and has no universal `message` property.
Narrow through `kind`.

## Common geometry operations

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

await map.ops.dissolveLayer({
  source: 'main',
  target: 'districts',
  field: 'province',
});

const result = await map.ops.projectLayer({
  source: 'main',
  target: 'districts',
  crs: 'EPSG:3857',
  output: { format: 'geojson', filename: 'districts-3857.geojson' },
});
```

`projectLayer` returns a detached file Blob and never mutates or reloads the
current map. Save `result.value.blob` using `result.value.filename`; use
`map.reproject()` for map-wide CRS changes.

## Layer and attribute operations

```ts
await map.ops.renameLayer({
  source: 'main',
  target: 'old_name',
  name: 'new_name',
});

await map.ops.filterFields({
  source: 'main',
  target: 'districts',
  fields: ['name', 'code'],
});
```

Operations containing expressions, `where`, or `calc` are controlled by the
expression policy.

## Split selected features

Use `map.select()` to choose line or polygon features from one source and layer,
then provide a coordinate cutter:

```ts
map.select([{ source: 'main', layer: 'roads', id: 4 }]);
const result = await map.ops.splitSelected({
  cutter: { type: 'point', coordinates: [121.5, 31.2] },
});

map.splitFeature.setOptions({ cutterType: 'polyline' });
map.splitFeature.enable();
```

A point cutter must lie in the interior of a line. A polyline cutter splits
lines and polygons; finish a polygon cutter with the right mouse button.
The selection must belong to one source and layer. On success, the largest
area or length result keeps the original feature ID and the other pieces are
appended as new features; every result duplicates the original attributes. The
selection is replaced by the final split results, and the complete split is one
atomic history entry that one undo restores.

## Operation effects

| Effect | Typical change | Selection behavior |
|---|---|---|
| `shape-count` | Add, delete, or split shapes | Feature IDs may change |
| `topology-only` | Coordinates or arcs change | Preserve identity when possible |
| `attribute-only` | Records or fields change | Usually preserve selection |
| `crs-only` | Coordinate system changes | Preserve identity, rebuild indexes |

The engine owns this classification. Do not bypass the runner with direct
mapshaper calls or dataset mutation.

## History, transactions, and workers

A successful operation creates history. Group operations with a non-nested
transaction:

```ts
const tx = map.beginTransaction();
const simplified = await map.ops.simplifyLayer({
  source: 'main',
  percentage: 0.4,
});

if (!simplified.ok) {
  tx.rollback();
} else {
  const committed = await tx.commit('Simplify data');
  if (!committed.ok) console.error(committed.error);
}
```

Dataset-replace operations can route through `useWorker: 'auto'` without
changing their call shape or result.

## Troubleshooting

- Emap accepts typed options, not arbitrary mapshaper CLI strings. Buffer uses
  `radius`; project uses `crs`.
- Check `name`, `target`, and `noReplace` for output-layer behavior.
- Run shape-count changes through `map.ops` so selection is cleared or remapped.

## API

- [OpResult](/mapseekai/emap/api/types/emap.OpResult.html)
- [OpError](/mapseekai/emap/api/types/emap.OpError.html)
- [BufferOptions](/mapseekai/emap/api/interfaces/emap.BufferOptions.html)
- [SimplifyOptions](/mapseekai/emap/api/interfaces/emap.SimplifyOptions.html)
- [ProjectOptions](/mapseekai/emap/api/interfaces/emap.ProjectOptions.html)

## Runnable examples

- [Buffer](/mapseekai/emap/examples/buffer/)
- [Clip and erase](/mapseekai/emap/examples/clip-erase/)
- [Dissolve](/mapseekai/emap/examples/dissolve/)
- [Simplify](/mapseekai/emap/examples/simplify/)
- [Union](/mapseekai/emap/examples/union/)
