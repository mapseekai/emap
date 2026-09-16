---
id: editing
slug: /guides/editing
title: Editing
api: ["AffineMatrix", "AppendedArc", "AutoCompletePolygonHandler", "AutoCompletePolygonOptions", "AutoCompletePolygonResult", "BulkFeatureDeleteCommand", "BulkFeatureDeleteCommandOptions", "composeMatrix", "CompositeCommand", "DatasetReplaceCommand", "DatasetReplaceCommandOptions", "EditCommand", "EditHistory", "EditHistoryOptions", "Emap", "FeatureAffineCommand", "FeatureAffineCommandOptions", "FeatureAppendCommand", "FeatureAppendCommandOptions", "FeatureCreateCommand", "FeatureDeleteCommand", "FeatureDeleteCommandOptions", "FeaturePropertyChangeCommand", "FeaturePropertyChangeCommandOptions", "FeatureTranslateCommand", "FeatureTranslateCommandOptions", "FieldAddCommand", "FieldAddCommandOptions", "FieldRemoveCommand", "FieldRemoveCommandOptions", "FieldRenameCommand", "FieldRenameCommandOptions", "HistoryStateSnapshot", "IDENTITY_MATRIX", "invertMatrix", "planSharedArcSplit", "planSharedNodeSplit", "rotateMatrix", "scaleMatrix", "SplitSharedArcsCommand", "SplitSharedArcsCommandOptions", "SplitSharedArcsRemap", "SplitSharedNodeCommand", "SplitSharedNodePlan", "TopologySource.fromBytes", "Transaction", "TranslatedPointFeature", "VertexDeleteCommand", "VertexInsertCommand", "VertexMoveCommand", "AddPartOptions", "AddRingOptions", "DeletePartOptions", "DeleteRingOptions", "FillRingOptions", "PartEditHandler", "PartEditOptions", "ReshapeFeatureHandler", "ReshapeFeatureOptions", "ReshapeSelectedOptions", "ReshapeSelectedResult", "RingEditHandler", "RingEditOptions", "DrawFeatureHandler", "VertexEditHandler", "SplitFeatureHandler", "TransformFeatureHandler"]
examples: ["attribute-editing","china-editing","draw-snap-clear","draw-snap-edge","feature-rotate-scale","feature-translate","rebuild-topology","reshape-ring-part","snapshot","split-features","transaction","undo-redo","vertex-editing"]
stability: stable
verifiedVersion: 0.12.0
---

# Editing

Emap connects interactive editing, selection transforms, and undoable commands to one map state.

```ts
map.drawFeature.setOptions({ // configure polygon drawing
  source: 'parcels', // source receiving new features
  sourceLayer: 'lots', // target data layer
  type: 'polygon', // sketch geometry type
  snapThreshold: 12, // snapping distance in pixels
  snapToVertex: true, // snap to vertices
  snapToEdge: true, // snap to edges
}); // save drawing options
map.drawFeature.enable(); // enable the drawing session
```

## Core methods

### Common handler methods

Every editing handler provides:

| Method | Signature | Parameters and behavior |
| --- | --- | --- |
| `enable()` / `disable()` | `(): void` | Enters editing mode (repeated calls preserve state) / clears interaction and exits. |
| `isEnabled` | `isEnabled(): boolean` | Returns enabled state. |
| `setOptions` | `setOptions(options: Partial<Options>): void` | Merges supplied fields; validates options or rebuilds the session. |
| `getOptions` | `getOptions(): Readonly<Options>` | Returns the current options snapshot. |

### Draw features

Drawing requires a target source and geometry type:

| Handler | Parameter | Type | Default | Description |
| --- | --- | --- | --- | --- |
| `drawFeature` | `source` | `string` | Required | Source ID receiving new features. |
|  | `sourceLayer` | `string` | First matching geometry layer | Target layer name. |
|  | `type` | `'point' \| 'polyline' \| 'polygon'` | Required | Sketch geometry type. |
|  | `snapThreshold` | `number` | `10` | Vertex and edge snapping threshold in pixels. |
|  | `snapSources` | `string[]` | `[source]` | Sources available for snapping. |
|  | `snapToVertex` | `boolean` | `true` | Snaps to existing vertices. |
|  | `snapToEdge` | `boolean` | `true` | Snaps to arc-segment projections. |
|  | `drawColor` | `string` | `EMAP_THEME_COLORS.primary` | Sketch-line CSS color. |

## More editing tools

### Handler options

| Handler | Parameter | Type | Default | Description |
| --- | --- | --- | --- | --- |
| `vertexEdit` | `layers` | `string[]` | All visible layers | Editable hit-test layers. |
|  | `polygonFillColor` | `string` | `EMAP_THEME_COLORS.selection` | Polygon-hover fill color. |
|  | `snapThreshold` | `number` | `10` | Vertex-drag snapping threshold in pixels. |
|  | `snapToVertex` | `boolean` | `true` | Snaps to other-feature vertices. |
|  | `snapToEdge` | `boolean` | `true` | Snaps to other-feature edges. |
| `splitFeature` | `cutterType` | `'point' \| 'polyline'` | `'point'` | Point or polyline cutter. |
|  | `snapThreshold` | `number` | `10` | Cutter snapping threshold in pixels. |
| `reshapeFeature` | `snapThreshold` | `number` | `10` | Reshape-sketch snapping threshold in pixels. |
| `autoCompletePolygon` | `snapThreshold` | `number` | `10` | Inherits `ReshapeFeatureOptions`. |
| `ringEdit` | `mode` | `'add' \| 'delete' \| 'fill'` | `'add'` | `add` sketches a ring, `delete` clicks a hole, `fill` creates a polygon. |
|  | `snapThreshold` | `number` | `10` | `add`-sketch snapping threshold in pixels. |
| `partEdit` | `mode` | `'add' \| 'delete'` | `'add'` | Adds or removes a path part. |
|  | `snapThreshold` | `number` | `10` | `add`-sketch snapping threshold in pixels. |
| `transformFeature` | `mode` | `'translate' \| 'rotate' \| 'scale'` | `'translate'` | Selected-feature transform mode. |
|  | `layers` | `string[]` | All visible layers | Hit-test layers. |
|  | `session.splitSharedArcs` | `boolean` | `true` | Copies shared arcs at session start, keeping unselected neighbours fixed. |

`splitFeature` requires a valid path selection in one source layer. `partEdit.add` requires one selected path; `ringEdit`, `reshapeFeature`, and `autoCompletePolygon` operate on sketch hits. `transformFeature` starts only from selected features. `boxSelect` and `lassoSelect` gestures are exclusive; call `disable()` before switching.

## Selection editing sessions

`map.editSession` handles selection-level edits; immediate methods create one history entry, drag sessions collapse frames into one.

### One-shot operations

| Method | Signature | Parameters | Behavior |
| --- | --- | --- | --- |
| `translateSelected` | `(dx: number, dy: number): OpResult` | `dx` and `dy` are source-data-coordinate offsets | Translates current selection; empty selection or zero offset returns validation. |
| `rotateSelected` | `(angleDegrees: number, origin?: [number, number]): OpResult` | `angleDegrees` in degrees; `origin` defaults to affected-vertex bounds center | Rotates around explicit or automatic pivot. |
| `scaleSelected` | `(sx: number, sy?: number, origin?: [number, number]): OpResult` | `sx` is X factor; `sy` defaults to `sx`; `origin` defaults to bounds center | Uniform or non-uniform scaling. |
| `splitSharedNode` | `(ref: FeatureRef, vertexId: number): number[] \| null` | `ref` is `{ source, layer, id }`; `vertexId` is a source-global index | Detaches a shared node and returns independent vertex IDs. |

### Drag sessions

| API | Signature | Parameters | Behavior |
| --- | --- | --- | --- |
| `beginTranslateSession` | `(options?: DragSessionOptions): FeatureTranslateSession \| null` | `options.splitSharedArcs?: boolean`, default `true` | Creates translation preview; empty selection returns `null`. |
| `FeatureTranslateSession.move` | `(dx: number, dy: number): void` | One-frame source-data-coordinate delta | Updates geometry without history. |
| `FeatureTranslateSession.commit` | `(): boolean` | None | Writes accumulated offset as one command; zero is `false`. |
| `FeatureTranslateSession.getAccumulated` | `(): [number, number]` | None | Returns accumulated `(dx, dy)`. |
| `beginAffineSession` | `(origin?: [number, number], options?: DragSessionOptions): FeatureAffineSession \| null` | `origin` defaults to selection bounds center; `options.splitSharedArcs` defaults to `true` | Creates affine preview. |
| `FeatureAffineSession.origin` | `readonly [number, number]` | Fixed at session creation | Fixed pivot. |
| `FeatureAffineSession.applyDelta` | `(matrix: AffineMatrix): void` | `matrix` is `{ a, b, c, d, tx, ty }` | Applies and accumulates one affine delta. |
| `FeatureAffineSession.commit` | `(label?: string): boolean` | `label` defaults automatically | Writes cumulative matrix as one command; identity is `false`. |
| `FeatureAffineSession.getCumulative` | `(): AffineMatrix` | None | Returns cumulative matrix. |
| `FeatureTranslateSession.cancel` / `FeatureAffineSession.cancel` | `(): void` | None | Restores pre-session geometry. |

`rotateMatrix()` and `scaleMatrix()` produce `AffineMatrix`; `composeMatrix(a, b)` composes `a · b`, `invertMatrix()` inverts, `IDENTITY_MATRIX` is identity.

## Undo, redo, and shortcuts

| Method | Signature | Parameters | Behavior |
| --- | --- | --- | --- |
| `map.undo` / `map.redo` | `(): boolean` | None | Undoes / redoes the top history entry. |
| `map.canUndo` / `map.canRedo` | `(): boolean` | None | Undo / redo availability; `false` during transactions. |
| `map.clearHistory` | `(): void` | None | Clears undo and redo stacks. |
| `map.bindHistoryShortcuts` | `(target?: HTMLElement): () => void` | `target` defaults to map canvas container | Binds undo/redo shortcuts and returns unbind. |

```ts
if (map.canUndo()) map.undo();
if (map.canRedo()) map.redo();

const unbind = map.bindHistoryShortcuts();
// Call unbind() when the component unmounts.
```

`historychange` carries `canUndo`, `canRedo`, top `label`, `staleCount`, `topIsStale`, and one-shot `skippedStale`; dataset replacement establishes a history boundary.

## Make several operations one action

`map.beginTransaction()` captures commands and operations; commit creates one `CompositeCommand` history entry.

| API | Signature | Parameters | Behavior |
| --- | --- | --- | --- |
| `map.beginTransaction` | `(): Transaction` | None | Starts transaction and snapshots selection plus first-touched sources; nesting throws. |
| `tx.isOpen` | `readonly boolean` | None | `true` before `commit()` or `rollback()`. |
| `tx.commit` | `(label: string): Promise<OpResult>` | `label` is history label | Waits for tracked operations, folds commands, and closes. |
| `tx.rollback` | `(): void` | None | Reverse-undos commands and restores datasets and selection. |

```ts
const tx = map.beginTransaction();
const clipped = await map.ops.clipLayer({ source: 'parcels', target: 'lots', mask: 'boundary' });
if (!clipped.ok) {
  tx.rollback();
} else {
  await tx.commit('Clip parcels');
}
```

## Advanced undoable edits

### Command contract

For edits outside public operations, implement `EditCommand`: mutate first, then `map.pushCommand(command)` records redo state; initial submission does not call `do()`.

| Member | Type | Default | Description |
| --- | --- | --- | --- |
| `do` | `(): void` | Required | Replays mutation for redo. |
| `undo` | `(): void` | Required | Restores state for undo. |
| `label` | `readonly string` | Optional | History label. |
| `mergeable` | `(previous: EditCommand): boolean` | Optional | Merges with stack top. |
| `merge` | `(next: EditCommand): void` | Optional | Absorbs next command, retaining earliest undo snapshot. |
| `invalidatesPriorCommands` | `readonly boolean` | Optional | Establishes history boundary when replacing a dataset. |

`CompositeCommand(children, label?)` calls `do()` in order and `undo()` in reverse, recording commands as one action.

### Built-in command options

These constructors serve advanced integrations; ordinary edits use handlers, `map.ops`, or `map.editSession`. Related types reference existing map objects.

| Command | Parameter | Type | Default | Description |
| --- | --- | --- | --- | --- |
| `FeatureCreateCommand` | `geometryType` | `'point' \| 'polyline' \| 'polygon'` | Required | Newly drawn feature type. |
|  | `layer`, `source` | `MapshaperLayer`, `TopologySource` | Required | Shape-receiving layer and owning source. |
|  | `appendedShape`, `appendedRecord` | `FeatureShape`, `Record<string, unknown> \| null` | Required | Already-appended shape and record. |
|  | `arcVertices`, `arcs` | `[number, number][]`, `ArcCollection` | Required for paths | Path arc vertices and collection; omit for points. |
|  | `adapter` | `MapshaperAdapter` | Default adapter | Mapshaper arc-operation adapter. |
| `FeatureAppendCommand` | `layer`, `source` | `MapshaperLayer`, `TopologySource` | Required | Append target. |
|  | `appendedShape`, `appendedRecord` | `FeatureShape`, `Record<string, unknown> \| null` | Required | Existing-arc reference and optional record. |
|  | `label` | `string` | `'Append feature'` | History label. |
| `FeatureDeleteCommand` | `layer`, `featureId` | `MapshaperLayer`, `number` | Required | Target layer and pre-delete index. |
|  | `shape`, `record`, `source` | `FeatureShape \| null`, `Record<string, unknown> \| null`, `TopologySource` | Required | Undo geometry, record snapshot, and source. |
| `BulkFeatureDeleteCommand` | `layer`, `source` | `MapshaperLayer`, `TopologySource` | Required | Bulk deletion target. |
|  | `snapshots` | `Array<{ id, shape, record }>` | Required | Pre-delete snapshots; `id` is original layer index. |
| `FeaturePropertyChangeCommand` | `layer`, `featureId`, `dataset` | `MapshaperLayer`, `number`, `MapshaperDataset` | Required | Attribute-change layer, feature, and dataset. |
|  | `prev`, `next` | `Record<string, unknown>` | Required | Before/after sparse attribute patches. |
|  | `label` | `string` | `'Edit properties'` | History label. |
| `FeatureTranslateCommand` | `source`, `dx`, `dy` | `TopologySource`, `number`, `number` | Required | Source-data-coordinate translation target and offset. |
|  | `arcs`, `arcIds`, `pointFeatures` | `ArcCollection`, `number[]`, `TranslatedPointFeature[]` | Omit `arcs` for points | Path arcs and point features to move. |
| `FeatureAffineCommand` | `source`, `matrix`, `arcIds`, `pointFeatures` | `TopologySource`, `AffineMatrix`, `number[]`, `TranslatedPointFeature[]` | Required | Affine transform and affected features. |
|  | `arcs` | `ArcCollection` | Omit for points | Path-feature shared arcs. |
|  | `label` | `string` | `Transform N features` | History label. |
| `DatasetReplaceCommand` | `source`, `before`, `after`, `label` | `TopologySource`, `MapshaperDataset`, `MapshaperDataset`, `string` | Required | Dataset replacement: `before` undoes, `after` redoes, establishes boundary. |
| `FieldAddCommand` | `layer`, `field`, `dataset` | `MapshaperLayer`, `string`, `MapshaperDataset` | Required | Adds attribute column. |
|  | `defaultValue` | `unknown` | `null` | Value for records lacking the field. |
| `FieldRemoveCommand` | `layer`, `field`, `dataset` | `MapshaperLayer`, `string`, `MapshaperDataset` | Required | Removes column and stores prior values. |
| `FieldRenameCommand` | `layer`, `from`, `to`, `dataset` | `MapshaperLayer`, `string`, `string`, `MapshaperDataset` | Required | Renames records and field metadata. |

### Low-level topology commands

| Command | Parameter | Type | Default | Description |
| --- | --- | --- | --- | --- |
| `VertexInsertCommand` | `insertionId`, `point`, `arcs`, `source` | `number`, `[number, number]`, `ArcCollection`, `TopologySource` | Required | Inserts at global index; `adapter` optional. |
| `VertexDeleteCommand` | `vertexIndex`, `coords`, `arcs`, `source` | `number`, `[number, number]`, `ArcCollection`, `TopologySource` | Required | Deletes vertex; undo restores `coords`; `adapter` optional. |
| `VertexMoveCommand` | `vertexIds`, `from`, `to`, `arcs`, `source` | `number[]`, `[number, number]`, `[number, number]`, `ArcCollection`, `TopologySource` | Required | Moves one topological node; mergeable; `adapter` optional. |
| `SplitSharedArcsCommand` | `source`, `remaps`, `appendedArcs`, `originalArcCount` | `TopologySource`, `SplitSharedArcsRemap[]`, `AppendedArc[]`, `number` | Required | Copies shared arcs and rewrites shapes; undo restores and truncates arcs. |
| `SplitSharedNodeCommand` | `plan` | `SplitSharedNodePlan` | Required | Executes shared-node separation plan. |

`planSharedArcSplit()` and `planSharedNodeSplit()` produce plans; interactive edits prefer `map.editSession.splitSharedNode()` or drag sessions.

### Supporting contracts

| API | Parameter | Type | Default | Description |
| --- | --- | --- | --- | --- |
| `new EditHistory` | `maxSize` in `options: EditHistoryOptions` | `number` | `200` | Retained undo-command limit; at least `1`. |
| `AppendedArc` | `xx`, `yy`, `zz` | `Float64Array`, `Float64Array`, `Float64Array \| null` | `zz` optional | Appended shared-arc vertex coordinates. |
| `SplitSharedArcsRemap` | `layer`, `featureId`, `originalShape`, `newShape` | `MapshaperLayer`, `number`, `PathShape`, `PathShape` | Required | Shape-rewrite before/after snapshots. |
| `ReshapeSelectedOptions` | `line` | `[number, number][]` | Required | Polyline sketch replacing touched paths. |
| `AddRingOptions` | `ring` | `[number, number][]` | Required | Closed interior-ring coordinates. |
| `DeleteRingOptions` / `FillRingOptions` | `point` | `[number, number]` | Required | Point in a hole; removes it or creates a polygon. |
| `AddPartOptions` | `coordinates` | `[number, number][]` | Required | New independent-part coordinates. |
| `DeletePartOptions` | `point`, `tolerance` | `[number, number]`, `number` | `tolerance` is `0` | Point on part to remove and optional tolerance. |
| `AutoCompletePolygonOptions` | `line` | `[number, number][]` | Required | Open sketch enclosing a face along existing boundaries. |
| `AutoCompletePolygonResult` | `createdCount`, `features` | `number`, `FeatureRef[]` | Required | Created-polygon count and references. |
| `ReshapeSelectedResult` | `reshapedCount` | `number` | Required | Successfully reshaped feature count. |
| `TopologySource.fromBytes` | `(id, bytes, options?)` | `string`, `Uint8Array \| ArrayBuffer`, `TopologySourceFromBytesOptions` | `filename` is `${id}.geojson` | Creates editable source from memory; file extension selects importer. |

## Runnable examples

- [Vertex editing](/mapseekai/emap/examples/vertex-editing/)
- [Undo and redo](/mapseekai/emap/examples/undo-redo/)
- [Transactions](/mapseekai/emap/examples/transaction/)
