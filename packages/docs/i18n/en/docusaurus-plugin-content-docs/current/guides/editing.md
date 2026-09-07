---
id: editing
slug: /guides/editing
title: Editing
api: ["AffineMatrix","AppendedArc","AutoCompletePolygonHandler","AutoCompletePolygonOptions","AutoCompletePolygonResult","BulkFeatureDeleteCommand","BulkFeatureDeleteCommandOptions","composeMatrix","CompositeCommand","DatasetReplaceCommand","DatasetReplaceCommandOptions","EditCommand","EditHistory","EditHistoryOptions","Emap","FeatureAffineCommand","FeatureAffineCommandOptions","FeatureAppendCommand","FeatureAppendCommandOptions","FeatureCreateCommand","FeatureDeleteCommand","FeatureDeleteCommandOptions","FeaturePropertyChangeCommand","FeaturePropertyChangeCommandOptions","FeatureTranslateCommand","FeatureTranslateCommandOptions","FieldAddCommand","FieldAddCommandOptions","FieldRemoveCommand","FieldRemoveCommandOptions","FieldRenameCommand","FieldRenameCommandOptions","HistoryStateSnapshot","IDENTITY_MATRIX","invertMatrix","planSharedArcSplit","planSharedNodeSplit","rotateMatrix","scaleMatrix","SplitSharedArcsCommand","SplitSharedArcsCommandOptions","SplitSharedArcsRemap","SplitSharedNodeCommand","SplitSharedNodePlan","TopologySource.fromBytes","Transaction","TranslatedPointFeature","VertexDeleteCommand","VertexInsertCommand","VertexMoveCommand","AddPartOptions","AddRingOptions","DeletePartOptions","DeleteRingOptions","FillRingOptions","PartEditHandler","PartEditOptions","ReshapeFeatureHandler","ReshapeFeatureOptions","ReshapeSelectedOptions","ReshapeSelectedResult","RingEditHandler","RingEditOptions"]
examples: ["attribute-editing","china-editing","draw-snap-clear","draw-snap-edge","feature-rotate-scale","feature-translate","rebuild-topology","reshape-ring-part","snapshot","split-features","transaction","undo-redo","vertex-editing"]
stability: stable
verifiedVersion: 0.9.0
---

# Editing

Emap edits are command-backed. Commands retain the state required for
restoration, keeping data changes, undo/redo, render caches, and selection
updates consistent.

## Choose an editing entry point

| Requirement | Recommended entry point |
|---|---|
| Change one property | Attribute API or `FeaturePropertyChangeCommand` |
| Translate a feature | `transformFeature` handler or translate edit session |
| Rotate or scale | `transformFeature` handler or affine edit session |
| Edit vertices | `vertexEdit` handler / `VertexEditControl` |
| Draw a feature | `drawFeature` handler / `DrawFeatureControl` |
| Delete selection | `map.deleteSelected()` |
| Process topology in bulk | `map.ops.*` |
| Group several steps | Transaction |

Do not mutate `source.getDataset()` directly. Bypassing commands skips undo
snapshots, cache invalidation, and selection maintenance.

### `DatasetReplaceCommand` trust boundary

`DatasetReplaceCommand` is a trusted low-level escape hatch for advanced
history integrations. It does not normalize CRS metadata, reproject
coordinates, or verify that a source belongs to a map. Prefer `map.ops.*` for
map-managed bulk changes and `map.reproject()` for whole-map CRS changes. Only
construct the command directly when `before` and `after` already match the
owning map's CRS, or when the source is fully detached.

## Edit modes

Public modes are `'none'`, `'vertex'`, `'draw'`, and `'transform'`:

```ts
map.setEditMode('vertex');
console.log(map.getEditMode());
```

Mode changes fire `editmodechange`:

```ts
map.on('editmodechange', ({ mode }) => {
  updateActiveTool(mode);
});
```

Leaving `vertex` or `draw` automatically clears temporary state that belongs to
that mode.

## Built-in editing controls

```ts
map.addControl(new EditToolbar(), 'top-left');
map.addControl(new VertexEditControl(), 'top-left');
map.addControl(new DrawFeatureControl(), 'top-left');
```

Controls provide UI and mode switching; map handlers still own pointer
processing. An application-specific toolbar can enable `map.vertexEdit`,
`map.drawFeature`, or `map.transformFeature` directly.

## Reshape

`reshapeFeature` lets users draw a line that replaces a path segment. It
submits the completed sketch to `map.ops.reshapeSelected()`. Like QGIS, no
selection is required: the line reshapes every line and polygon feature it
contacts (a polygon needs the line to enter and leave its boundary, a
polyline needs at least two contacts).

Reshape writes a reversible command incrementally into the current dataset; it
does not clone the dataset for each operation. Each completed reshape is an
independent history entry and supports multi-level undo and redo.

```ts
const result = await map.ops.reshapeSelected({
  line: [
    [116.38, 39.90],
    [116.40, 39.91],
  ],
});

if (!result.ok) showError(result.error);
else console.log(result.value.reshapedCount);

map.reshapeFeature.setOptions({ snapThreshold: 12 });
map.reshapeFeature.enable();
```

Left-click to place reshape-line vertices, right-click to finish after at
least two vertices, and press Esc to discard the current sketch.
`reshapeFeature` enters `'reshape'` edit mode; enabling another edit mode
turns it off.

`map.ops.reshapeSelected()` returns an `OpResult`. A validation failure
(`kind: 'validation'`) has shape `{ kind, field, reason }`: the sketch needs
at least two finite coordinates and cannot be only repeated points (`line`);
a sketch that reshapes nothing also fails with `line`. Polygon reshapes
reject self-intersecting or invalid results (`geometry`). A prepared mutation
made stale by a concurrent edit has shape
`{ kind: 'stale-operation', sourceId, operation }`, without `field`.

## Auto-complete polygon

`autoCompletePolygon` uses the same sketch gestures as reshape. Start inside or on
an existing polygon, draw the new boundary outside it, and return inside or to a
boundary. Right-click to finish or press Escape to cancel. The sketch and existing
boundaries enclose independent new polygon features. Existing geometry and
attributes are preserved, and adjoining features share topology arcs. No selection
is required; selecting reference features enables the same vertex and edge snapping
as reshape.

```ts
map.autoCompletePolygon.setOptions({ snapThreshold: 12 });
map.autoCompletePolygon.enable();

const result = await map.ops.autoCompletePolygon({
  line: [[8, 2], [14, 2], [14, 8], [8, 8]],
});
if (!result.ok) showError(result.error);
else console.log(result.value.createdCount, result.value.features);
```

The handler enters `'auto-complete'` edit mode and is included in
`EditToolbar({ advancedTools: true })`. New features are appended to the first
polygon layer that encloses a new face with the sketch, in source and layer order.
New attribute records are empty and the existing selection is preserved. A sketch
can create multiple faces in one undoable operation. Invalid coordinates,
self-intersections, or sketches that enclose no new face return `validation`
without modifying data.

## Split

`splitFeature` submits an interactive cutter to `map.ops.splitSelected()`.
First select features in one source and layer: line features accept point or
polyline cutters, while polygon features use polyline cutters. A split keeps
the original feature, appends the remaining results, copies attributes to
every result, and selects the split results.

```ts
const result = await map.ops.splitSelected({
  cutter: { type: 'point', coordinates: [116.39, 39.90] },
});

if (!result.ok) showError(result.error);
else console.log(result.value.resultFeatures);

map.splitFeature.setOptions({ cutterType: 'polyline', snapThreshold: 12 });
map.splitFeature.enable();
```

Click inside a line for a point cutter. For a polyline cutter, left-click to
place vertices, right-click to finish, and press Esc to discard the sketch.
`splitFeature` enters `'split'` edit mode.

Reshape and split use append-only arc storage during a live editing session;
undo truncates only the appended tail. Intermediate or orphan arcs can
therefore remain in the live dataset temporarily. Export compacts a copy and
does not mutate live history or state.

## Batch vertex operations

`vertexEdit` supports box selection, group drag, and batch deletion of
topology nodes:

```ts
map.vertexEdit.setOptions({
  layers: ['roads'],
  snapThreshold: 12,
  snapToVertex: true,
  snapToEdge: true,
  polygonFillColor: '#6ea8fe', // hover fill for polygon features
});
map.vertexEdit.enable();
```

Drag from an area without a hovered vertex to box-select vertices. Shift-drag
adds box hits to the existing selection. Drag any selected vertex to move the
whole group. Press Delete or Backspace for batch deletion, and Esc to clear the
selection. Without a box selection, right-clicking a vertex exposes single-
vertex deletion; shared nodes can be split first. `vertexEdit` uses `'vertex'`
edit mode and cannot operate alongside another edit mode.

Batch deletion keeps the topology-deletion checks: it cannot remove nodes that
would degenerate a path or ring; shared nodes are handled as one topological
unit, and an invalid deletion commits no partial change.

## Add and delete holes

`ringEdit` adds or removes an interior ring (hole) on polygon features. Its
underlying APIs are `map.ops.addRing()` and `map.ops.deleteRing()`;
`map.ops.fillRing()` creates a polygon feature that shares the hole boundary
while preserving the hole on the host feature. Like QGIS, none of these
operations requires a selection: a sketch locates the containing polygon, and
a point inside a hole locates the hole to delete or fill.

```ts
const added = await map.ops.addRing({
  ring: [
    [116.39, 39.90],
    [116.40, 39.90],
    [116.40, 39.91],
    [116.39, 39.90],
  ],
});

const removed = await map.ops.deleteRing({ point: [116.395, 39.905] });
const filled = await map.ops.fillRing({ point: [116.395, 39.905] });

map.ringEdit.setOptions({ mode: 'add', snapThreshold: 12 });
map.ringEdit.enable();
```

With `mode: 'add'`, left-click to draw the hole, right-click to finish, and
Esc to cancel. With `mode: 'delete'`, click any point inside a hole to remove
it. It uses `'ring'` edit mode and exits when another edit mode is selected.

Validation failures from `map.ops.addRing()`, `map.ops.deleteRing()`, and
`map.ops.fillRing()` have
`kind: 'validation'` and shape `{ kind, field, reason }`; `field` is `ring`.
The hole must be closed and enclose area, must not self-intersect, touch, or
cross a polygon boundary, and must be strictly inside a polygon exterior; a
sketch contained by no polygon or a point outside every hole is also rejected.
A prepared mutation made stale by a concurrent edit has shape
`{ kind: 'stale-operation', sourceId, operation }`, without `field`.

## Add and delete parts

`partEdit` adds or deletes an independent part on line or polygon features.
Its underlying APIs are `map.ops.addPart()` and `map.ops.deletePart()`.
Adding a part requires exactly one selected target feature; deleting is
QGIS-style and selection-free — the clicked part is removed, and removing a
feature's last part deletes the whole feature.

```ts
const added = await map.ops.addPart({
  coordinates: [
    [116.41, 39.90],
    [116.42, 39.91],
  ],
});

const removed = await map.ops.deletePart({
  point: [116.415, 39.905],
  tolerance: 0.0001,
});

map.partEdit.setOptions({ mode: 'delete', snapThreshold: 12 });
map.partEdit.enable();
```

With `mode: 'add'`, exactly one path feature must be selected: left-click to
draw a part, right-click to finish, and Esc to cancel. Polygon parts close
automatically; line parts need at least two vertices. With `mode: 'delete'`,
click the target part; for lines, the handler converts `snapThreshold` to
`tolerance`. It uses `'part'` edit mode and exits when another edit mode is
selected.

Validation failures from `map.ops.addPart()` and `map.ops.deletePart()` have
`kind: 'validation'` and shape `{ kind, field, reason }`; `field` is
`selection` or `part`. A new part cannot self-intersect, touch, or intersect
existing geometry. A polygon part also cannot overlap an existing polygon,
enclose an existing exterior, and must match existing exterior orientation.
When deleting, polygon clicks must land inside a part and line clicks must be
within `tolerance`. A prepared mutation made stale by a concurrent edit has
shape `{ kind: 'stale-operation', sourceId, operation }`, without `field`.

## Undo and redo

```ts
if (map.canUndo()) {
  map.undo();
}

if (map.canRedo()) {
  map.redo();
}
```

`undo()` and `redo()` return `false` when no history entry is available and
`true` after a successful change.

Add the history control:

```ts
map.addControl(new HistoryControl(), 'top-right');
```

Bind keyboard shortcuts:

```ts
const unbindHistory = map.bindHistoryShortcuts();

// When the page is removed or the application takes over shortcuts
unbindHistory();
```

The binding supports Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z or Ctrl+Y.

## Transactions

Use a transaction when several operations must become one user action.
Transactions cannot be nested:

```ts
const tx = map.beginTransaction();

const simplified = await map.ops.simplifyLayer({
  source: 'main',
  percentage: 0.4,
});

if (!simplified.ok) {
  tx.rollback();
  showError(simplified.error);
} else {
  const cleaned = await map.ops.cleanLayer({
    source: 'main',
  });

  if (!cleaned.ok) {
    tx.rollback();
    showError(cleaned.error);
  } else {
    const committed = await tx.commit('Simplify and clean');
    if (!committed.ok) {
      showError(committed.error);
    }
  }
}
```

`commit(label)` collapses executed child commands into one history entry.
`rollback()` restores the first-touch datasets and selection. A committed or
rolled-back transaction cannot be reused.

## Custom commands

Implement `EditCommand` for undoable changes not covered by a built-in API.
`do()` is used by redo, `undo()` restores prior state, and the optional `label`
appears in history snapshots.

The caller must perform the change before `map.pushCommand(command)`;
`pushCommand` only records the command and does not invoke `command.do()`.
Capture a complete memento when constructing the command instead of relying on
a live dataset that may later change.

## Dataset replacement and validation

Simplify, projection, and clip may replace the complete dataset. Run them
through `map.ops` so history can mark older commands that are no longer safe
against the new dataset.

After-commit validators can report topology or business-rule failures through
`validationfailed`. They do not automatically undo:

```ts
map.on('validationfailed', ({ results, label }) => {
  showValidationResults(label, results);
});
```

The application chooses whether to warn, continue, or invoke undo.

## Troubleshooting

- Accumulate pointer updates in an edit session and commit once at gesture end;
  do not push a command for every pointermove.
- On any failed transaction step, call `rollback()` immediately and do not run
  later operations.
- Use `getEditMode()` and `editmodechange` as the UI state source rather than a
  separate button boolean.

## API

- [EditCommand](/mapseekai/emap/api/interfaces/emap.EditCommand.html)
- [EditHistory](/mapseekai/emap/api/classes/emap.EditHistory.html)
- [Transaction](/mapseekai/emap/api/classes/emap.Transaction.html)
- [EditToolbar](/mapseekai/emap/api/classes/emap.EditToolbar.html)

## Runnable examples

- [Editing overview](/mapseekai/emap/examples/china-editing/)
- [Vertex editing](/mapseekai/emap/examples/vertex-editing/)
- [Reshape, batch vertex, ring, and part editing](/mapseekai/emap/examples/reshape-ring-part/)
- [Split features](/mapseekai/emap/examples/split-features/)
- [Feature translation](/mapseekai/emap/examples/feature-translate/)
- [Rotate and scale](/mapseekai/emap/examples/feature-rotate-scale/)
- [Transactions](/mapseekai/emap/examples/transaction/)
- [Undo and redo](/mapseekai/emap/examples/undo-redo/)
