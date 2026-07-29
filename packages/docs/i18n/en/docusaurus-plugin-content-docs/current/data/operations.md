---
id: operations
slug: /data/operations
title: Data operations
api: ["AffineLayerOptions","ApplyExpressionOptions","BufferOptions","CheckGeometryOptions","CleanOptions","ClipEraseOptions","DataFillOptions","DissolveOptions","DivideOptions","DragSessionOptions","DropLayerOptions","Emap","ExplodeOptions","ExportSnapshotOptions","ExpressionEvaluationPolicy","FeatureAffineSession","FeatureRef","FeatureTranslateSession","FilterFieldsOptions","FilterGeomOptions","FilterIslandsOptions","FilterOptions","FilterSliversOptions","GeometryCheckReport","HighlightFeatureRef","HighlightStyle","InnerlinesOptions","IntersectionPointsLayerOptions","JoinTableData","JoinTableOptions","LinesOptions","LoadSnapshotOptions","MapOptions","MergeLayersOptions","MosaicOptions","PointsMode","PointsOptions","PolygonsOptions","ProjectOptions","QueriedFeature","QueryFeaturesOptions","RebuildTopologyOptions","RenameFieldsOptions","RenameLayerOptions","SimplifyMethod","SimplifyOptions","SnapOptions","SortFeaturesOptions","SplitLayerOptions","UnionOptions","UniqueFeaturesOptions"]
examples: ["buffer","check-geometry","clip-erase","data-engineering","dissolve","divide","duckdb-overlay","duckdb-spatial-ops","explode","filter-features","innerlines","merge-layers","merge-selected","mosaic","project","rebuild-topology","rename-layer","simplify","simplify-control","snap-layer","split-layer","union"]
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

await map.ops.projectLayer({
  source: 'main',
  target: 'districts',
  crs: 'EPSG:3857',
});
```

The target CRS field in `ProjectOptions` is `crs`.

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

- [OpResult](/emap/api/types/index.OpResult.html)
- [OpError](/emap/api/types/index.OpError.html)
- [BufferOptions](/emap/api/interfaces/index.BufferOptions.html)
- [SimplifyOptions](/emap/api/interfaces/index.SimplifyOptions.html)
- [ProjectOptions](/emap/api/interfaces/index.ProjectOptions.html)

## Runnable examples

- [Buffer](/emap/examples/buffer/)
- [Clip and erase](/emap/examples/clip-erase/)
- [Dissolve](/emap/examples/dissolve/)
- [Simplify](/emap/examples/simplify/)
- [Union](/emap/examples/union/)
