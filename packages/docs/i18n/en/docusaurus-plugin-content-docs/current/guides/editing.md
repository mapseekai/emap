---
id: editing
slug: /guides/editing
title: Editing
api: ["AffineMatrix", "AppendedArc", "AutoCompletePolygonHandler", "AutoCompletePolygonOptions", "AutoCompletePolygonResult", "BulkFeatureDeleteCommand", "BulkFeatureDeleteCommandOptions", "composeMatrix", "CompositeCommand", "DatasetReplaceCommand", "DatasetReplaceCommandOptions", "EditCommand", "EditHistory", "EditHistoryOptions", "Emap", "FeatureAffineCommand", "FeatureAffineCommandOptions", "FeatureAppendCommand", "FeatureAppendCommandOptions", "FeatureCreateCommand", "FeatureDeleteCommand", "FeatureDeleteCommandOptions", "FeaturePropertyChangeCommand", "FeaturePropertyChangeCommandOptions", "FeatureTranslateCommand", "FeatureTranslateCommandOptions", "FieldAddCommand", "FieldAddCommandOptions", "FieldRemoveCommand", "FieldRemoveCommandOptions", "FieldRenameCommand", "FieldRenameCommandOptions", "HistoryStateSnapshot", "IDENTITY_MATRIX", "invertMatrix", "planSharedArcSplit", "planSharedNodeSplit", "rotateMatrix", "scaleMatrix", "SplitSharedArcsCommand", "SplitSharedArcsCommandOptions", "SplitSharedArcsRemap", "SplitSharedNodeCommand", "SplitSharedNodePlan", "TopologySource.fromBytes", "Transaction", "TranslatedPointFeature", "VertexDeleteCommand", "VertexInsertCommand", "VertexMoveCommand", "AddPartOptions", "AddRingOptions", "DeletePartOptions", "DeleteRingOptions", "FillRingOptions", "PartEditHandler", "PartEditOptions", "ReshapeFeatureHandler", "ReshapeFeatureOptions", "ReshapeSelectedOptions", "ReshapeSelectedResult", "RingEditHandler", "RingEditOptions", "DrawFeatureHandler", "VertexEditHandler", "SplitFeatureHandler", "TransformFeatureHandler"]
examples: ["attribute-editing","china-editing","draw-snap-clear","draw-snap-edge","feature-rotate-scale","feature-translate","rebuild-topology","reshape-ring-part","snapshot","split-features","transaction","undo-redo","vertex-editing"]
stability: stable
verifiedVersion: unreleased
---

# Editing

Emap connects interactive editing and undoable commands to the same map state. Configure a handler before enabling it, and call `disable()` when the tool ends.

## Enable an editing tool

Every editing handler starts disabled. The drawing handler needs a target source and geometry type:

```ts
map.drawFeature.setOptions({
  source: 'parcels',
  sourceLayer: 'lots',
  type: 'polygon',
  snapThreshold: 12,
  snapToVertex: true,
  snapToEdge: true,
});
map.drawFeature.enable();
```

| Handler | Purpose | Requirement before enabling |
|---|---|---|
| `drawFeature` | Draw a point, polyline, or polygon | `source` and `type` |
| `vertexEdit` | Select, drag, and delete topology vertices | Editable layers |
| `splitFeature` | Cut selected features with a point or polyline | Valid selection in one source layer |
| `reshapeFeature` | Replace a path segment with a sketch | A path intersecting the sketch |
| `autoCompletePolygon` | Draw a polygon adjoining existing boundaries | Start and end touching existing polygons |
| `ringEdit` | Add or delete polygon interior rings | Selected polygons |
| `partEdit` | Add or delete line or polygon parts | Selection matching the tool mode |
| `transformFeature` | Drag, rotate, or scale selected features | Selected features |

For example, disable vertex editing before switching tools:

```ts
map.vertexEdit.setOptions({ layers: ['lots'] });
map.vertexEdit.enable();

// Before enabling another tool
map.vertexEdit.disable();
```

`boxSelect` and `lassoSelect` cannot be enabled together. Disable an editing tool before enabling another tool that consumes the same gesture.

## Undo, redo, and shortcuts

Editing commands enter map history. Use the return value to update application UI:

```ts
if (map.canUndo()) map.undo();
if (map.canRedo()) map.redo();

const unbind = map.bindHistoryShortcuts();
// Call unbind() when the component unmounts.
```

`undo()` and `redo()` return `false` when no entry is available. The `historychange` event supplies the state needed to synchronize buttons.

## Make several operations one action

`beginTransaction()` stages operations and commands produced during its lifetime. `commit(label)` collapses them into one history entry; call `rollback()` after failure to restore data and selection. Transactions cannot nest.

```ts
const tx = map.beginTransaction();
const clipped = await map.ops.clipLayer({ source: 'parcels', target: 'lots', mask: 'boundary' });
if (!clipped.ok) {
  tx.rollback();
} else {
  await tx.commit('Clip parcels');
}
```

## Add a custom undoable edit

When public map operations do not cover a business edit, implement `EditCommand`, complete the data change, then record the redoable command with `map.pushCommand(command)`. `do()` performs redo and `undo()` restores the prior data.

## Runnable examples

- [Vertex editing](/mapseekai/emap/examples/vertex-editing/)
- [Undo and redo](/mapseekai/emap/examples/undo-redo/)
- [Transactions](/mapseekai/emap/examples/transaction/)
