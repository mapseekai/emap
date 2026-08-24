# Geometric Merge of Selected Features Design

## Problem

`map.ops.mergeSelected()` currently stamps selected records with a discriminator and runs mapshaper `-dissolve` across the full target layer. With the repository's pinned mapshaper `0.6.113`, ordinary `-dissolve` primarily follows existing topology. It can group shapes without repairing polygon intersections, so overlapping polygons may retain overlapping parts or interior boundaries instead of becoming one geometric union.

The operation also obtains output attributes implicitly from mapshaper's first copied record. Users cannot choose which selected feature supplies the merged record's attributes.

## Goal

Make same-layer polygon merging behave like QGIS Merge Selected Features:

- adjacent and overlapping selected polygons become their geometric union;
- shared and overlap-internal boundaries are removed;
- disconnected selected polygons become one multipart feature;
- unselected features remain geometrically unchanged;
- the caller chooses which selected feature supplies the result attributes;
- the operation remains one undoable dataset replacement.

## Non-goals

- Field-by-field aggregation policies such as sum, minimum, maximum, or concatenation.
- A QGIS-style modal attribute table.
- Cross-source or cross-layer merging.
- Replacing existing point and polyline merge semantics.
- Introducing DuckDB, GEOS, or another geometry runtime.

## Public API

Add an exported option type:

```ts
export interface MergeSelectedOptions {
  /** Selected feature whose record supplies every output attribute. */
  attributeSource?: FeatureRef;
}
```

Change the facade method to:

```ts
mergeSelected(options?: MergeSelectedOptions): Promise<OpResult>;
```

Rules:

1. At least two selected features are required.
2. Every selected feature must have the same `source` and `layer`.
3. `attributeSource`, when provided, must exactly match one selected `FeatureRef`.
4. Omitting `attributeSource` uses the first feature in selection order, preserving source compatibility for existing calls.
5. The target layer must have a data table and a record for the attribute source.

## Architecture

### Prepare the runner copy before command dispatch

The merge must not stamp or otherwise mutate the live source dataset before the runner snapshots it. Add an internal prepared parsed-command runner to `OpContext`, built on the existing `runDatasetMutation()` boundary:

1. copy the original dataset;
2. invoke a synchronous preparation callback on that working copy;
3. route the prepared dataset and parsed commands through the existing main-thread/worker decision;
4. commit the returned dataset through the normal `DatasetReplaceCommand` path.

`mergeSelected()` uses the preparation callback only to split the target layer and install deterministic temporary records. Mapshaper still performs the geometry operation. This preserves worker routing for large selections while guaranteeing that operation failure leaves live geometry, records, selection, and history unchanged and that undo restores a dataset without internal merge fields.

### Isolate selected features

Resolve the selected source/layer against the live registry, record its layer index, then locate the same index in the working dataset.

Split the working target layer into:

- the original layer containing only unselected shapes and records;
- a temporary layer containing only selected shapes.

Every temporary-layer record is a shallow record copy of the chosen attribute-source record. Because all records are identical, mapshaper's `copy-fields` result is deterministic and independent of feature order.

Temporary layer names must be generated against the working dataset's existing names to avoid collisions. No temporary name or field may survive the returned dataset.

### Geometry operation

For a polygon target layer:

1. Add the temporary selected layer to the working dataset.
2. Run mapshaper `dissolve2` on only that layer, without a grouping field.
3. Copy all original fields from its identical temporary records.
4. Merge the one-feature result back into the original layer.
5. Remove the temporary layer and restore the original layer name.

In mapshaper `0.6.113`, `dissolve2` calls `addIntersectionCuts()` before polygon dissolve. This nodes intersections, removes overlaps and internal boundaries, and returns one multipart feature when selected polygons are disconnected.

For point and polyline layers, use the same selected-layer isolation but retain ordinary `dissolve`, preserving current multipart semantics.

The runner's `COMMAND_EFFECTS` table must classify `dissolve2` as `shape-count`.

### Unselected geometry invariant

`dissolve2` must target only the temporary selected layer. It may split shared arc storage while adding intersection cuts, but the shapes representing unselected features must cover exactly the same geometry before and after the operation. It must never allocate an overlap area away from an unselected feature.

## Selection and history

A successful merge uses the existing dataset-replacement path:

- one history entry labelled `Merge N features`;
- selection cleared because feature IDs and shape count change;
- shape-derived caches invalidated;
- one render scheduled;
- normal history and selection events fired.

A validation or geometry failure commits nothing and preserves the current selection.

Undo and redo must round-trip exact geometry, records, field names, layer names, and CRS metadata.

## Example UI

Update `packages/examples/examples/merge-selected/index.html` with an `属性来源` select.

Selection-change behavior:

- Require at least two selected features from one source and layer.
- Populate one option per selected feature.
- Label each option as `要素 <id> — <name>` using `name`, then `fullname`, then only the feature ID when no readable property exists.
- Preserve the current attribute-source choice while it remains selected.
- Otherwise default to the first selected feature.
- Disable both the select and merge button for invalid selections.

Merge behavior:

- Resolve the selected dropdown value back to the complete `FeatureRef`.
- Call `map.ops.mergeSelected({ attributeSource })`.
- Report which feature supplied attributes in the success status.
- Keep existing clear-selection and history controls.

## Error handling

Return validation errors without dispatching mapshaper when:

- fewer than two features are selected;
- selection spans sources or layers;
- the target layer is missing;
- the attribute source is not selected;
- the layer has no data table;
- the attribute-source record is missing.

Mapshaper errors use the existing `Err.mapshaper` path and error event. Since all work occurs on the copied dataset, no rollback mutation is required.

## Verification

### Core contract tests

- Reject zero and one selected feature.
- Reject cross-source and cross-layer selections.
- Reject an attribute source outside the selection.
- Preserve omitted-option compatibility by using the first selected feature.
- Classify `dissolve2` as `shape-count`.

### Real mapshaper tests

- Adjacent polygons produce one exterior boundary with the shared edge removed.
- Overlapping polygons produce a union whose area equals the mathematical union, not the sum of overlapping parts.
- Disconnected polygons produce one multipart feature.
- An unselected polygon overlapping selected polygons preserves its original geometry.
- Choosing a non-first selected feature copies exactly that record's attributes.
- Point and polyline selection retains existing merge semantics.
- No temporary layer or `__emap_*` field remains.
- Undo and redo restore exact datasets and attributes.

### Example tests

- The attribute-source select follows selection changes.
- Invalid mixed-layer/source selection disables merge.
- The selected `FeatureRef` is passed to `mergeSelected()`.
- Success status identifies the attribute source.

## Alternatives rejected

### Run `dissolve2` over the existing discriminator groups

This is smaller but unsafe. `dissolve2` constructs a repaired polygon mosaic across the target layer, so overlaps between selected and unselected groups can be reassigned. That changes geometry outside the selection.

### Implement polygon boolean union in emap

This duplicates mapshaper's existing noding and polygon overlay implementation and creates a large correctness burden for holes, multipart geometry, precision, and invalid inputs.

### Use DuckDB or GEOS

This adds a heavyweight optional runtime to a core editing operation and would make the same API behave differently depending on loaded plugins.

## References

- QGIS documentation, Merge Selected Features: https://docs.qgis.org/3.44/en/docs/user_manual/working_with_vector/editing_geometry_attributes.html#merge-selected-features
- QGIS implementation, `QgisApp::unionGeometries()` and `QgisApp::mergeSelectedFeatures()`: https://github.com/qgis/QGIS/blob/master/src/app/qgisapp.cpp
- Installed mapshaper `0.6.113`: `dissolve2` repairs overlaps and gaps by calling `addIntersectionCuts()` before polygon dissolve.
