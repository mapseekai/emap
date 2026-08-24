---
id: editing
slug: /guides/editing
title: Editing
api: ["AffineMatrix","AppendedArc","BulkFeatureDeleteCommand","BulkFeatureDeleteCommandOptions","composeMatrix","CompositeCommand","DatasetReplaceCommand","DatasetReplaceCommandOptions","EditCommand","EditHistory","EditHistoryOptions","Emap","FeatureAffineCommand","FeatureAffineCommandOptions","FeatureCreateCommand","FeatureDeleteCommand","FeatureDeleteCommandOptions","FeaturePropertyChangeCommand","FeaturePropertyChangeCommandOptions","FeatureTranslateCommand","FeatureTranslateCommandOptions","FieldAddCommand","FieldAddCommandOptions","FieldRemoveCommand","FieldRemoveCommandOptions","FieldRenameCommand","FieldRenameCommandOptions","HistoryStateSnapshot","IDENTITY_MATRIX","invertMatrix","planSharedArcSplit","planSharedNodeSplit","rotateMatrix","scaleMatrix","SplitSharedArcsCommand","SplitSharedArcsCommandOptions","SplitSharedArcsRemap","SplitSharedNodeCommand","SplitSharedNodePlan","TopologySource.fromBytes","Transaction","TranslatedPointFeature","VertexDeleteCommand","VertexInsertCommand","VertexMoveCommand"]
examples: ["attribute-editing","china-editing","draw-snap-clear","draw-snap-edge","export-roundtrip","feature-rotate-scale","feature-translate","rebuild-topology","snapshot","transaction","undo-redo","vertex-editing"]
stability: stable
verifiedVersion: 0.5.0
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
- [Feature translation](/mapseekai/emap/examples/feature-translate/)
- [Rotate and scale](/mapseekai/emap/examples/feature-rotate-scale/)
- [Transactions](/mapseekai/emap/examples/transaction/)
- [Undo and redo](/mapseekai/emap/examples/undo-redo/)
