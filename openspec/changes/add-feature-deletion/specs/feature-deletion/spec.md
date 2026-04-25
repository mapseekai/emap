## ADDED Requirements

### Requirement: CompositeCommand primitive
The system SHALL provide a `CompositeCommand` `EditCommand` that wraps an ordered list of child commands.

#### Scenario: do() invokes children in declared order
- **WHEN** a `CompositeCommand` with children `[A, B, C]` has its `do()` called
- **THEN** `A.do()`, `B.do()`, `C.do()` are invoked in that order

#### Scenario: undo() invokes children in reverse order
- **WHEN** the same `CompositeCommand` has its `undo()` called
- **THEN** `C.undo()`, `B.undo()`, `A.undo()` are invoked in that order

#### Scenario: Empty children list is a no-op
- **WHEN** a `CompositeCommand` is constructed with `[]`
- **THEN** calls to `do()` and `undo()` complete without error and produce no observable effect

### Requirement: FeatureDeleteCommand reverses with insertion at original index
The system SHALL provide a `FeatureDeleteCommand` whose `do()` removes a feature by index and whose `undo()` re-inserts the same shape and data record at the original index.

#### Scenario: do() splices out shape and data record
- **WHEN** a `FeatureDeleteCommand` for `featureId = 3` is executed
- **THEN** `layer.shapes` no longer contains the entry that was at index 3
- **AND** `layer.data.getRecords()[3]` (if present) has been removed

#### Scenario: undo() restores the feature at the same index
- **WHEN** `do()` was called and then `undo()` is called
- **THEN** the original shape is at index 3 of `layer.shapes`
- **AND** the original record is at index 3 of `layer.data.getRecords()` (if a data table existed)

#### Scenario: Layers without a data table are handled
- **WHEN** the layer has no `data` property
- **THEN** `do()` and `undo()` operate only on `layer.shapes` without error

### Requirement: Emap.deleteSelected
The system SHALL provide `Emap.deleteSelected()` that deletes every currently-selected feature in one undoable history entry.

#### Scenario: Empty selection is a no-op
- **WHEN** `deleteSelected()` is called with an empty selection
- **THEN** the call returns `false`
- **AND** no command is pushed onto the history
- **AND** no events are fired

#### Scenario: Multiple selected features collapse to one history entry
- **WHEN** the selection contains three features and `deleteSelected()` is called
- **THEN** all three features are removed from their respective layers
- **AND** exactly one `EditCommand` is added to the undo history
- **AND** `historychange` fires once (with `canUndo: true`)

#### Scenario: Selection is cleared after deletion
- **WHEN** `deleteSelected()` succeeds
- **THEN** `getSelection()` returns an empty array
- **AND** a `selectionchange` event fires with the deleted refs in `removed`

#### Scenario: Single Ctrl+Z restores all deleted features
- **WHEN** `deleteSelected()` removed several features and `Emap.undo()` is called once
- **THEN** every deleted feature is restored to its original layer at its original index
- **AND** every restored feature's data record is back in the layer's record table at its original index

### Requirement: Descending-index deletion preserves intra-layer integrity
Deletion of multiple features within the same layer SHALL not corrupt remaining indices.

#### Scenario: Same-layer multi-delete leaves the rest untouched
- **WHEN** features at indices 2 and 5 of a layer with 8 features are deleted in one `deleteSelected()` call
- **THEN** the remaining six features keep their original shapes and records
- **AND** the layer length is exactly 6 after deletion
