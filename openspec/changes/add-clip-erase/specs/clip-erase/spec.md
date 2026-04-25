## ADDED Requirements

### Requirement: TopologySource.setDataset
The `TopologySource` interface SHALL provide a `setDataset(dataset)` method that swaps the active dataset reference, rebuilds the LOD copy in `DisplayArcs`, and fires the `data` event.

#### Scenario: Dataset swap rebuilds DisplayArcs
- **WHEN** `setDataset(newDataset)` is called
- **THEN** `getDataset()` returns `newDataset`
- **AND** `getDisplayArcs()` returns a `DisplayArcs` constructed from the new dataset's arcs (or `null` when the new dataset has no arcs)
- **AND** a single `data` event is fired so the map re-renders

### Requirement: DatasetReplaceCommand
The system SHALL provide a `DatasetReplaceCommand` `EditCommand` that swaps a `TopologySource`'s dataset between captured `before` and `after` references.

#### Scenario: do() activates `after`
- **WHEN** a `DatasetReplaceCommand({ source, before, after, label })` has its `do()` called
- **THEN** the source's active dataset becomes `after`

#### Scenario: undo() activates `before`
- **WHEN** the same command has its `undo()` called
- **THEN** the source's active dataset becomes `before`

#### Scenario: Round-trip restores the original reference
- **WHEN** `do()` then `undo()` is called
- **THEN** the source's active dataset is identical (`===`) to the reference that was active before `do()` ran

### Requirement: Emap.clipLayer
The system SHALL provide `Emap.clipLayer({ source, target, mask })` that clips the named target layer using the named mask layer, recording the operation as a single undoable history entry.

#### Scenario: Successful clip is reversible by one undo
- **WHEN** `clipLayer(opts)` resolves with `true`
- **THEN** the source's dataset has been replaced with the mapshaper-clipped result
- **AND** the undo stack contains exactly one new entry (a `DatasetReplaceCommand` with label "Clip <target>")
- **AND** calling `Emap.undo()` once restores the original dataset reference

#### Scenario: Missing source / target / mask returns false
- **WHEN** `clipLayer(opts)` is called with a `source`, `target`, or `mask` that cannot be resolved in the current sources
- **THEN** the promise resolves with `false`
- **AND** no command is pushed
- **AND** no events fire

#### Scenario: Selection is cleared on success
- **WHEN** a clip operation completes successfully and the selection was non-empty
- **THEN** `getSelection()` returns an empty array after the promise resolves
- **AND** a `selectionchange` event is fired with the previously-selected refs in `removed`

### Requirement: Emap.eraseLayer
The system SHALL provide `Emap.eraseLayer({ source, target, mask })` that erases (cuts holes in) the named target layer using the named mask layer.

#### Scenario: Successful erase is reversible by one undo
- **WHEN** `eraseLayer(opts)` resolves with `true`
- **THEN** the source's dataset has been replaced with the mapshaper-erased result
- **AND** the undo stack contains exactly one new entry (a `DatasetReplaceCommand` with label "Erase <target>")
- **AND** calling `Emap.undo()` once restores the original dataset reference

### Requirement: Dataset-replace operations are a history barrier
A successful dataset-replace operation SHALL clear the prior undo history before pushing its own command.

#### Scenario: Prior history is wiped on dataset replace
- **WHEN** the user has performed several vertex and draw edits (so `canUndo()` is `true` and the history holds multiple entries)
- **AND** `clipLayer(opts)` resolves with `true`
- **THEN** the undo history holds exactly one entry (the `DatasetReplaceCommand`)
- **AND** the redo stack is empty
- **AND** `historychange` is fired with `canUndo: true, canRedo: false, label: 'Clip <target>'`
