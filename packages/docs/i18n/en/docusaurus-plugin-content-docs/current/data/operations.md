---
id: operations
slug: /data/operations
title: Data operations
api: ["AffineLayerOptions", "ApplyExpressionOptions", "BufferOptions", "CheckGeometryOptions", "CleanOptions", "ClipEraseOptions", "DataFillOptions", "DissolveOptions", "DivideOptions", "DragSessionOptions", "DropLayerOptions", "Emap", "ExplodeOptions", "ExportSnapshotOptions", "ExpressionEvaluationPolicy", "FeatureAffineSession", "FeatureRef", "FeatureTranslateSession", "FilterFieldsOptions", "FilterGeomOptions", "FilterIslandsOptions", "FilterOptions", "FilterSliversOptions", "GeometryCheckReport", "HighlightStyle", "InnerlinesOptions", "IntersectionPointsLayerOptions", "JoinTableData", "JoinTableOptions", "LinesOptions", "LoadSnapshotOptions", "MapOptions", "MergeLayersOptions", "MosaicOptions", "PointsMode", "PointsOptions", "PolygonsOptions", "ProjectLayerExport", "ProjectLayerOutputOptions", "ProjectOptions", "QueriedFeature", "QueryFeaturesOptions", "RebuildTopologyOptions", "RenameFieldsOptions", "RenameLayerOptions", "SimplifyMethod", "SimplifyOptions", "SnapOptions", "SortFeaturesOptions", "SplitCutter", "SplitFeatureHandler", "SplitFeatureOptions", "SplitLayerOptions", "SplitSelectedOptions", "SplitSelectedResult", "UnionOptions", "UniqueFeaturesOptions", "OpResult", "OpError", "ClassifyFeaturesOptions"]
examples: ["buffer","clip-erase","dissolve","filter-features","merge-selected","simplify","split-features","union"]
stability: stable
verifiedVersion: 0.12.0
---

# Data operations

`map.ops` is Emap's mapshaper data-processing interface and returns `Promise<OpResult>`.

```ts
const result = await map.ops.bufferLayer({ // buffer the roads layer by 250 units
  source: 'main',
  target: 'roads',
  radius: 250,
});
if (!result.ok) console.error(result.error); // handle an operation error
```

## Core methods

| Method | Parameters | Description |
| --- | --- | --- |
| `bufferLayer(options)` | `BufferOptions` | Buffer features. |
| `simplifyLayer(options)` | `SimplifyOptions` | Simplify geometry. |
| `clipLayer(options)` / `eraseLayer(options)` | `ClipEraseOptions` | Clip or erase a layer. |
| `dissolveLayer(options)` | `DissolveOptions` | Merge geometry by field. |

## More calls and errors

Success is `{ ok: true, value }`; failure is `{ ok: false, error }`. `checkGeometry()`, `classifyFeatures()`, and `projectLayer()` return artifacts; `error.kind` is `not-found`, `validation`, `expression-disabled`, `mapshaper`, `stale-operation`, or `host-removed`.

Expressions require `expressionPolicy: 'trusted'`. `withSignal(signal)` creates a cancellable operation scope.

```ts
const controller = new AbortController();
const ops = map.ops.withSignal(controller.signal);
cancelButton.addEventListener('click', () => controller.abort(), { once: true });
const result = await ops.simplifyLayer({ source: 'main', percentage: 25 });
```

## More operations

| Category | Methods |
| --- | --- |
| Overlay, topology, and geometry | `clipLayer`, `eraseLayer`, `dissolveLayer`, `bufferLayer`, `simplifyLayer`, `projectLayer`, `affineLayer`, `cleanLayer`, `snapLayer`, `mosaicLayer`, `unionLayers`, `divideLayer` |
| Feature geometry | `filterIslands`, `filterSlivers`, `filterGeom`, `explodeLayer`, `innerlinesLayer`, `pointsLayer`, `linesLayer`, `polygonsLayer`, `intersectionPointsLayer` |
| Layer management | `renameLayer`, `mergeLayers`, `splitLayer`, `dropLayer` |
| Attributes and filtering | `applyExpression`, `filterFeatures`, `sortFeatures`, `uniqueFeatures`, `filterFields`, `renameFields`, `classifyFeatures`, `joinTable`, `dataFill` |
| Topology inspection | `rebuildTopology`, `checkGeometry` |
| Selection and editing | `mergeSelected`, `splitSelected`, `reshapeSelected`, `autoCompletePolygon`, `addRing`, `deleteRing`, `fillRing`, `addPart`, `deletePart` |

### Operation parameters

#### Layer targeting and output

Unless noted, layer operations use these locators; `name` and `noReplace` apply only to listed methods.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `source` | `string` | Required | Dataset source ID. |
| `target` | `string` | Required | Target layer name or ID. |
| `targets` | `string[]` | Required | `mergeLayers` and `unionLayers` input layers. |
| `name` | `string` | Unset | Output-layer name. |
| `noReplace` | `boolean` | `false` | Preserves input layers. |

#### Overlay, topology, and transforms

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `clipLayer` / `eraseLayer`: `mask` | `string` | One of two | Same-source polygon clipping layer. |
| `clipLayer` / `eraseLayer`: `bbox` | `[number, number, number, number]` | One of two | Source-coordinate rectangle; exclusive with `mask`. |
| `clipLayer` / `eraseLayer`: `cleanup`, `removeSlivers` | `boolean` | `false` | Repairs rings and slivers after overlay. |
| `dissolveLayer`: `field` / `fields` | `string` / `string[]` | Unset | Group key; unset merges the layer, forms exclusive. |
| `dissolveLayer`: `sumFields`, `copyFields` | `string[]` | Unset | Group sum or copied fields. |
| `dissolveLayer`: `calc`, `where` | `string` | Unset | Aggregate calculation or pre-filter. |
| `dissolveLayer`: `multipart` | `boolean` | `false` | Outputs multipart features. |
| `bufferLayer`: `radius` | `number \| string` | Required | Positive finite distance or per-feature expression. |
| `bufferLayer`: `capStyle`, `type` | `'flat' \| 'round'` / `'left' \| 'right' \| 'outer' \| 'inner'` | `'round'` / Unset | Line-cap style and one-sided direction. |
| `bufferLayer`: `vertices`, `arcQuality`, `tolerance` | `number` | Unset | Circle vertices, arc segments, curve tolerance. |
| `bufferLayer`: `planar`, `v2`, `sliceLength`, `backtrack` | `boolean` / `number` | `false` / Unset | Planar, v2, path-slicing controls. |
| `simplifyLayer`: `target` | `string` | Unset | Omit for every shared arc. |
| `simplifyLayer`: `percentage` | `number` | One of three | Removable-vertex percentage `[0, 100]`. |
| `simplifyLayer`: `interval` / `resolution` | `number` / `string` | One of three | CRS distance or grid; exclusive with `percentage`. |
| `simplifyLayer`: `method`, `weighting` | `'dp' \| 'visvalingam' \| 'weighted'` / `number` | `'weighted'` / `0.7` | Simplification algorithm and coefficient. |
| `simplifyLayer`: `planar`, `keepShapes`, `lockBox`, `noRepair` | `boolean` | `false` | Planar, shape, bbox, repair controls. |
| `projectLayer`: `target`, `crs` | `string` | Required | Export layer and destination CRS. |
| `projectLayer`: `init`, `densify` | `string` / `boolean` | Unset / `false` | Source-CRS override and densification. |
| `projectLayer`: `output` | `{ format?: ExportFormat; filename?: string }` | Unset (`format: 'geojson'`) | Export format and filename. |
| `affineLayer`: `target`, `shift`, `rotate` | `string` / `[number, number]` / `number` | Unset | Layer, translation, counter-clockwise angle. |
| `affineLayer`: `scale`, `anchor`, `where` | `number \| [number, number]` / `[number, number]` / `string` | Unset / bbox centre / Unset | Scale, anchor, filter. |
| `cleanLayer`: `gapFillArea`, `sliverControl`, `snapInterval` | `number` | Unset | Hole, sliver, pre-snap controls. |
| `cleanLayer`: `noSnap`, `allowOverlaps`, `allowEmpty`, `rewind`, `onlyArcs`, `noArcDissolve` | `boolean` | `false` | Snap, overlap, empty, ring, repair controls. |
| `cleanLayer`: `overlapRule` | `'min-id' \| 'max-id' \| 'min-area' \| 'max-area'` | Unset | Overlap attribute source. |
| `snapLayer`: `interval`, `precision`, `endpoints`, `fixGeometry` | `number` / `boolean` | Auto / Unset / `false` / `false` | Snap distance, precision, endpoints, repair. |
| `mosaicLayer`: `snapInterval`, `noSnap`, `calc` | `number` / `boolean` / `string` | Unset / `false` / Unset | Snap and aggregation. |
| `unionLayers`: `fields` | `string[]` | Unset | Output attributes. |
| `divideLayer`: `divider`, `fields`, `force` | `string` / `string[]` / `boolean` | Required / All / `false` | Polygon-cuts lines and copies fields. |

#### Feature geometry

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `filterIslands`: `minArea`, `minVertices`, `removeEmpty` | `number` / `boolean` | At least one required / `false` | Removes small or empty features. |
| `filterSlivers`: `minArea`, `weighted` | `number` / `boolean` | Required / `false` | Sliver threshold and weighted metric. |
| `filterGeom`: `bbox` | `[number, number, number, number]` | Required | Retains rectangle-intersecting features. |
| `explodeLayer` | — | — | Splits multipart features. |
| `innerlinesLayer`: `where` | `string` | Unset | Adjacent-polygon filter. |
| `pointsLayer`: `type`, `interval` | `'centroid' \| 'inner' \| 'vertices' \| 'endpoints' \| 'midpoints' \| 'interpolated'` / `number` | Required / Unset | Point extraction mode and interval. |
| `linesLayer`: `fields` | `string[]` | Unset | Polygon-boundary hierarchy fields. |
| `polygonsLayer`: `gapTolerance`, `fromRings` | `number` / `boolean` | Auto / `false` | Snap tolerance and closed-ring path. |
| `intersectionPointsLayer`: `tolerance` | `number` | Auto | Positive source-unit intersection tolerance. |

#### Layers, attributes, and topology

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `renameLayer`: `name` | `string` | Required | Nonempty non-colliding layer name. |
| `mergeLayers`: `targets`, `name`, `force`, `flatten` | `string[]` / `string` / `boolean` | At least two / Unset / `false` / `false` | Combines layers; can force or mosaic. |
| `splitLayer`: `expression`, `noReplace` | `string` / `boolean` | Required / `false` | Splits by field or expression. |
| `dropLayer` | — | — | Removes target layer. |
| `applyExpression`: `expression`, `where` | `string` | Required / Unset | Attribute update and filter. |
| `filterFeatures`: `expression`, `invert`, `removeEmpty` | `string` / `boolean` | Unset / `false` / `false` | Predicate filter, reversal, empty removal. |
| `sortFeatures`: `expression`, `descending` | `string` / `boolean` | Required / `false` | In-place sort. |
| `uniqueFeatures`: `expression`, `maxCount`, `invert` | `string` / `number` / `boolean` | Required / `1` / `false` | Deduplication and per-key count. |
| `filterFields`: `fields`, `invert` | `string[]` / `boolean` | Required / `false` | Retains fields; `['*']` removes all. |
| `renameFields`: `mapping` | `Record<string, string>` | Required | `oldField -> newField` mapping. |
| `classifyFeatures`: `field`, `method`, `classes`, `colors` | `string` / `'quantile' \| 'equal-interval' \| 'nice' \| 'categorical'` / `number` / `string[]` | Required / Required / `4` / Required | Field classification colors. |
| `classifyFeatures`: `breaks`, `categories`, `saveAs`, `nullValue`, `otherColor`, `invert` | `number[]` / `(string \| number)[]` / `string` / `string` / `string` / `boolean` | Unset / distinct appearance order / `'fill'` / theme muted / `nullValue` / `false` | Breaks, categories, output, colors, reversal. |
| `joinTable`: `data`, `keys` | `JoinTableData` / `[string, string]` | Required | External data and key pair. |
| `joinTable`: `fields`, `prefix`, `where`, `calc`, `unjoined`, `unmatched` | `string[]` / `string` / `string` / `string` / `boolean` | All except source key / Unset / Unset / Unset / `false` / `false` | Fields, prefix, filter, aggregation, unmatched controls. |
| `dataFill`: `field`, `weightField`, `contiguous` | `string` / `string` / `boolean` | Required / Unset / `false` | Backfills attributes from neighbors. |
| `rebuildTopology`: `source`, `snapInterval`, `noSnap`, `rebuildTopology` | `string` / `number` / `boolean` | Required / Auto / `false` / `false` | Rebuilds shared arcs. |
| `checkGeometry`: `source`, `tolerance` | `string` / `number` | Required / Auto | Read-only geometry check. |

#### Selection and editing

Selection and editing methods use current selection or a geometry hit, omitting `source` and `target`; success adds one history entry.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `mergeSelected`: `attributeSource` | `FeatureRef` | First selected feature | Output attribute source. |
| `splitSelected`: `cutter` | `{ type: 'point'; coordinates: [number, number] } \| { type: 'polyline'; coordinates: [number, number][] }` | Required | Point or polyline cutter. |
| `reshapeSelected` / `autoCompletePolygon`: `line` | `[number, number][]` | Required | Replacement path or enclosure sketch. |
| `addRing`: `ring` | `[number, number][]` | Required | Closed interior-ring coordinates. |
| `deleteRing` / `fillRing`: `point` | `[number, number]` | Required | Interior-ring hit point. |
| `addPart`: `coordinates` | `[number, number][]` | Required | Independent path part. |
| `deletePart`: `point`, `tolerance` | `[number, number]` / `number` | Required / Unset | Hit point and tolerance. |

### Worker routing

`Emap.create()` `useWorker` routes dataset replacement: `false` (default) main thread, `true` Worker, `'auto'` at `workerThreshold` (default `50000`) vertices. `workerUrl` defaults to `'emap-worker.js'`; `workerPoolSize` to `1`; selection editing stays on the main thread.

## More common operations

```ts
await map.ops.simplifyLayer({
  source: 'main',
  target: 'districts',
  percentage: 25,
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

`projectLayer()` returns a detached export file; `map.reproject()` changes map CRS.

```ts
const result = await map.ops.projectLayer({
  source: 'main',
  target: 'districts',
  crs: 'EPSG:3857',
  output: { format: 'geojson', filename: 'districts-3857.geojson' },
});
```

## More selection operations and history

`map.beginTransaction()` groups operations into one undo:

```ts
const tx = map.beginTransaction();
const simplified = await map.ops.simplifyLayer({
  source: 'main',
  percentage: 40,
});

if (simplified.ok) {
  await tx.commit('Simplify data');
} else {
  tx.rollback();
}
```

Feature-count changes clear or remap selection; attribute and CRS operations preserve identity where possible.

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
