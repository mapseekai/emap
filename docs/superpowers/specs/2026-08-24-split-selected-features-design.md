# Split Selected Features Design

## Problem

`emap` can divide a polyline layer at polygon boundaries through `map.ops.divideLayer()`, but it cannot perform the interactive feature-editing operation users expect from QGIS **Split Features**:

- split selected polyline features at a point;
- split selected polyline features wherever a cutter line crosses them;
- split selected polygon features with a cutter line that genuinely divides their interiors;
- create independent output features whose attributes come from the original feature.

The similarly named `splitLayer()` partitions a layer by an attribute expression, `explodeLayer()` separates multipart geometry, and shared-arc/node splitting only detaches topology for editing. None implements this contract.

## Goal

Add a coordinate-driven core operation and an integrated drawing handler with QGIS-compatible splitting semantics:

- the current selection defines the targets;
- every target must belong to one source and one layer;
- a point can split selected polylines;
- a polyline can split selected polylines or polygons;
- every effective cut creates independent features;
- each result receives a copy of the original record;
- the largest result retains the original feature position and ID;
- every result and every selected-but-unsplit target remains selected;
- success is one atomic, undoable dataset replacement.

## QGIS Compatibility

The design follows QGIS Split Features for its core geometry and edit semantics:

- an active selection limits targets to selected features;
- one cutter can split multiple selected features;
- the largest result retains the original feature ID;
- ineffective cutters do not modify the dataset;
- the edit is atomic and undoable.

The following differences are intentional and form part of the emap contract:

- a point may split a polyline at an existing vertex or within a segment; QGIS's one-click shortcut is limited to an existing vertex;
- emap requires a non-empty selection instead of falling back to every intersected feature;
- every output record duplicates the original values instead of supporting provider-specific split policies;
- all results are selected after success instead of leaving only the original IDs selected;
- the first version supports straight 2D cutter paths, not curved paths or Z/M interpolation;
- the first version does not propagate topological vertices into other layers.

## Non-goals

- Using an existing point or line layer as the cutter.
- Splitting targets across sources or layers in one call.
- Splitting point features.
- QGIS field split policies such as geometry-ratio, default-value, or unset-value.
- Curved cutter geometry or Z/M interpolation.
- Cross-layer topological editing.
- Geometry repair of invalid input features.
- A separate processing algorithm that emits a new output source.

## Public Coordinate API

Add exported types:

```ts
export type SplitCutter =
  | { type: 'point'; coordinates: [number, number] }
  | { type: 'polyline'; coordinates: Array<[number, number]> };

export interface SplitSelectedOptions {
  cutter: SplitCutter;
}

export interface SplitSelectedResult {
  splitTargetCount: number;
  resultFeatures: FeatureRef[];
}
```

Expose the operation through the existing selection-driven namespace:

```ts
map.ops.splitSelected(
  options: SplitSelectedOptions,
): Promise<OpResult<SplitSelectedResult>>;
```

`resultFeatures` contains, in layer order, every selected feature after the operation: all pieces created from split targets plus selected targets that the cutter did not split.

## Input Validation

Validate before copying or mutating a dataset:

1. The selection is non-empty.
2. Every selected reference has the same `source` and `layer`.
3. The source, layer, shapes, and every selected feature geometry resolve.
4. The layer geometry type is `polyline` or `polygon`.
5. A point cutter is accepted only for a polyline target layer.
6. Point coordinates are finite.
7. A polyline cutter contains at least two finite, consecutively distinct coordinates.
8. Polygon targets have a polyline cutter.

Invalid input returns a structured validation or not-found error and preserves dataset identity, selection, history, caches, and render state.

## Effective-Cut Rules

The operation applies one cutter to all selected targets. A selected target that is not effectively split remains unchanged and selected. The operation succeeds only when at least one selected target is split; otherwise it returns a validation error equivalent to QGIS `NothingHappened`.

### Polyline target with point cutter

- The point must lie on the selected target path.
- Interactive drawing snaps the point exactly onto a selected path before calling the API.
- The coordinate API does not project an off-path point. A scale-aware numerical epsilon may absorb arithmetic noise but must not act as a user-visible spatial tolerance.
- A point at an interior vertex or inside a segment is a cut.
- A point at a path endpoint is not a cut.
- Multipart paths are evaluated independently.

### Polyline target with polyline cutter

- Every distinct proper intersection in the interior of a target path is a cut.
- Intersections at target endpoints do not create zero-length features.
- Repeated cutter vertices or multiple cutter segments meeting at the same target coordinate count once.
- Tangential endpoint contact and collinear overlap do not create cuts.
- Multiple valid intersections can produce more than two result features.

### Polygon target with polyline cutter

- The cutter must produce at least two distinct effective boundary intersections and polygonization must create at least two non-empty results.
- Intersection count is an early rejection only; successful polygonization is authoritative.
- Touching the boundary without traversing the interior, following a boundary, or leaving through the same effective point does not split the polygon.
- A cutter may enter and leave multiple times and can produce more than two result polygons.
- Holes and multipart input are preserved by topology. Each connected output polygon becomes an independent feature.
- The union of output polygons must cover the original feature without gaps or overlaps. A failed coverage invariant aborts the entire operation.

### Degenerate results

Discard zero-length line fragments and zero-area polygon fragments created solely by numeric noise. If fewer than two valid results remain for a target, that target is treated as unsplit.

## Geometry Architecture

### Adapter boundary

All direct mapshaper access remains in `src/adapter/mapshaper-adapter.ts`. Extend `MapshaperAdapter` with focused primitives needed by this operation instead of importing mapshaper in the operation or handler.

The adapter owns:

- inserting a point cut into an arc and remapping affected paths;
- adding a temporary cutter path;
- adding intersection cuts and rebuilding node topology;
- constructing polygon mosaic tiles from an arc filter;
- point-in-polygon and coverage helpers required to assign tiles;
- removing temporary/unreferenced arcs and returning coherent topology.

The implementation should reuse mapshaper's installed `addIntersectionCuts`, cut-point insertion, `NodeCollection`, and polygon mosaic machinery. It must not introduce an independent segment-intersection or polygon-overlay engine.

### Working-copy mutation

Add an internal prepared dataset-mutation runner alongside the parsed-command runner. Its contract:

1. resolve and queue the source operation;
2. copy the live dataset;
3. invoke a synchronous or asynchronous mutation callback on the copy;
4. receive both the mutated dataset and the desired post-commit selection;
5. run stale-operation checks;
6. commit dataset and selection atomically through one `DatasetReplaceCommand`.

This avoids manufacturing an unrelated mapshaper CLI command after the custom topology mutation. The mutation is classified as `shape-count`.

### Polyline splitting

For a point cutter, locate the exact selected path segment, insert a cut point through the adapter, and remap signed arc IDs. For a line cutter, append a temporary cutter arc and node its intersections with the working dataset.

For each selected polyline feature:

1. walk every path in signed arc order;
2. split at the valid cut nodes belonging to the cutter;
3. combine uninterrupted arcs into non-empty output paths;
4. create one feature per output path;
5. keep the feature unchanged when fewer than two outputs remain.

### Polygon splitting

Append the temporary cutter path and node it together with the working dataset. For each selected polygon independently:

1. construct a fresh node view filtered to the feature's boundary arcs and relevant cutter arcs;
2. build polygon mosaic tiles;
3. keep tiles covered by the original polygon;
4. group tiles into connected results without dissolving across cutter arcs;
5. preserve holes and validate coverage against the original polygon;
6. keep the feature unchanged when fewer than two valid results remain.

Building a per-feature filtered mosaic prevents boundaries of other selected or overlapping polygons from spuriously splitting a target.

### Cleanup

Remove the temporary cutter layer and every unreferenced temporary arc, then rebuild coherent topology once. No `__emap_*` layer, field, record, or arc reference may survive the committed dataset.

## Feature and Attribute Replacement

Process the target layer in original feature order.

For every split target:

1. rank results by planar length for polylines or planar area for polygons;
2. write the largest result at the original feature index, preserving its feature ID;
3. append the remaining results to the end of the layer in deterministic target and geometry order;
4. assign each result a separate shallow copy of the original record.

For every unsplit feature, preserve the existing array index, shape, and record values. Unselected features must remain geometrically unchanged. Appending additional results, rather than inserting them beside their parent, preserves every pre-existing feature ID when multiple targets are split together.

Layers without a data table remain without a data table. Layers with a data table retain the exact field schema and one record per output shape.

## Selection and Events

The commit replaces the old selection with:

- every result of each split selected target;
- each selected target which was not split, retaining its original feature ID.

The dataset replacement and selection replacement produce:

- one `historychange` event;
- one `selectionchange` event containing the final selected refs;
- one source `data` event;
- one render scheduling action;
- one cache invalidation for the affected source.

Avoid the generic shape-count behavior of clearing selection and then re-selecting results, which would emit two selection transitions.

## History and Atomicity

A successful call creates one history entry labeled `Split N features`, where `N` is the number of targets actually split.

Undo and redo must round-trip:

- exact dataset geometry and topology;
- layer and field identities;
- every record value;
- the pre-split and post-split selections;
- source CRS metadata.

Selection restoration belongs to the same undoable command as the dataset replacement. Extend or specialize the dataset-replacement command rather than pushing an unrelated second command.

Any validation, geometry, topology, coverage, stale-operation, or host-removal failure commits nothing. No target may remain partially split.

## Integrated Drawing Handler

Add `SplitFeatureHandler`, exposed as `map.splitFeature`, and a corresponding options type:

```ts
export interface SplitFeatureOptions {
  cutterType: 'point' | 'polyline';
  snapThreshold?: number;
}
```

Behavior:

- enabling requires a valid current selection;
- the handler derives source, layer, and target geometry from the selection;
- polygon targets reject `cutterType: 'point'`;
- point mode snaps only to selected polyline targets and commits on one left click;
- polyline mode adds vertices with left click and completes with right click, matching QGIS;
- Escape cancels the current sketch;
- the cutter is transient and is never written as a feature;
- successful completion clears only the sketch and keeps the handler enabled for another split;
- failure clears the completed sketch, reports the structured operation error, and keeps the target selection;
- the handler calls `map.ops.splitSelected()` and contains no independent geometry logic.

Use the existing draw overlay and snapping conventions. Introduce a distinct split edit mode or otherwise enforce mutual exclusion with ordinary feature drawing; two handlers must never simultaneously own a draw sketch.

## Error Contract

Add specific structured validation reasons without introducing a new error family:

- empty selection;
- selection spans sources or layers;
- unsupported target geometry;
- point cutter used for polygons;
- malformed cutter coordinates;
- point is not on any selected line;
- cutter did not split any selected feature;
- invalid selected geometry;
- polygon coverage validation failed.

Mapshaper failures continue through `Err.mapshaper`; stale operations use `Err.staleOperation`.

## Verification

### Core validation tests

- reject empty, cross-source, and cross-layer selections;
- reject point targets and point cutters for polygons;
- reject malformed coordinates and off-line points;
- preserve dataset, history, and selection on every rejected input;
- return no-op validation when no target is effectively split.

### Real mapshaper polyline tests

- split a line at an existing interior vertex;
- split a line inside a segment;
- ignore a target endpoint;
- split a line at multiple cutter intersections;
- deduplicate coincident cutter intersections;
- ignore tangent contact and collinear overlap;
- preserve untouched selected and unselected lines;
- split multipart lines without zero-length fragments.

### Real mapshaper polygon tests

- split a simple polygon with two boundary crossings;
- create more than two polygons from repeated crossings;
- reject a tangent, boundary overlap, and one-point touch;
- preserve holes;
- split multipart polygons into connected result features;
- independently process overlapping selected polygons;
- prove output union coverage equals the original without overlap;
- preserve every unselected polygon exactly.

### Attributes, IDs, and selection tests

- largest line/polygon result retains the original feature ID;
- every additional result is appended deterministically after all pre-existing features;
- every result has equal attribute values but a distinct record object;
- selected unsplit targets remain selected with their original IDs;
- all split results are selected;
- a layer without a data table remains valid.

### History and event tests

- success creates one history entry labeled with the actual split-target count;
- undo restores the original dataset and selection;
- redo restores split geometry and result selection;
- success emits one selection change and one history change;
- geometry or stale-operation failure commits no partial results.

### Handler tests

- point mode commits one snapped click on a selected line;
- point mode rejects an unsnapped click;
- polygon selection rejects point mode;
- polyline mode completes on right click;
- Escape cancels without calling the operation;
- cutter sketches are never added to a layer;
- success keeps the tool enabled and selects all results;
- handler mutual exclusion prevents ordinary draw and split sketches from coexisting.

## Alternatives Rejected

### Temporary layers plus generic command strings

A `-polygons`/`-clean` command chain can polygonize a line network, but it does not directly express selected-only feature replacement, per-input attribute duplication, overlapping selected targets, or deterministic result selection. The required temporary-layer bookkeeping would be more fragile than a focused adapter-backed mutation.

### New geometry dependency

JSTS, Turf, GEOS, or DuckDB would add bundle/runtime cost and require conversions away from mapshaper topology. DuckDB is optional, so it cannot define a consistent core editing API.

### In-place edit commands for every new piece

A composite of arc append, shape splice, and record splice commands would retain object identity but makes polygon topology rollback and partial-failure handling substantially harder. A copied-dataset mutation gives the operation the same atomic failure boundary as existing polygon ops.

## References

- QGIS 3.44 Split Features: https://docs.qgis.org/3.44/en/docs/user_manual/working_with_vector/editing_geometry_attributes.html#split-features
- QGIS field split policies: https://docs.qgis.org/3.44/en/docs/user_manual/working_with_vector/vector_properties.html#policies
- QGIS `QgsGeometry::splitGeometry`: https://api.qgis.org/api/3.44/classQgsGeometry.html#aaae079efa718628e2af10cb0abd73077
- QGIS split map tool: https://github.com/qgis/QGIS/blob/release-3_44/src/app/qgsmaptoolsplitfeatures.cpp
- QGIS layer edit implementation: https://github.com/qgis/QGIS/blob/release-3_44/src/core/vector/qgsvectorlayereditutils.cpp#L469-L730
- Installed mapshaper 0.6.113: `addIntersectionCuts()`, cut-point insertion, `NodeCollection`, and polygon mosaic internals.
