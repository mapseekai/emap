## ADDED Requirements

### Requirement: Persistent feature selection set
The system SHALL maintain a per-map persistent set of selected features, addressed by `{ source, layer, id }` triples and accessible via `Emap.getSelection()`.

#### Scenario: Initial selection is empty
- **WHEN** a new `Emap` instance is created
- **THEN** `getSelection()` returns an empty array
- **AND** `isSelected(any)` returns `false`

#### Scenario: Selection survives across pointer events
- **WHEN** a feature is added to the selection
- **AND** unrelated pointer events (move, hover, render) occur afterwards
- **THEN** the feature remains in the selection until explicitly removed

### Requirement: Replace, add, and toggle selection modes
The system SHALL provide `Emap.select(features, options?)` accepting `{ mode: 'replace' | 'add' | 'toggle' }`, with `'replace'` as the default mode.

#### Scenario: Replace mode discards prior selection
- **WHEN** `select(A, { mode: 'replace' })` is called after `select(B)`
- **THEN** the resulting selection contains only the features in `A`

#### Scenario: Add mode unions with prior selection
- **WHEN** `select(A, { mode: 'add' })` is called with `B` already selected and `A ∩ B = ∅`
- **THEN** the resulting selection contains every feature in `A ∪ B`

#### Scenario: Toggle mode flips membership
- **WHEN** `select(F, { mode: 'toggle' })` is called and `F` is already selected
- **THEN** `F` is removed from the selection
- **WHEN** `select(F, { mode: 'toggle' })` is called and `F` is not selected
- **THEN** `F` is added to the selection

### Requirement: Selection change events with diff payload
The system SHALL fire a `selectionchange` event with payload `{ selected, added, removed }` whenever a selection mutation actually changes the set.

#### Scenario: Successful add fires event with non-empty `added`
- **WHEN** `select([X])` is called and `X` is not in the current selection
- **THEN** a `selectionchange` event is fired
- **AND** the event payload's `added` array contains `X`
- **AND** the event payload's `selected` array reflects the post-mutation state

#### Scenario: No-op selection change does not fire event
- **WHEN** `select(F, { mode: 'add' })` is called and `F` is already selected
- **THEN** no `selectionchange` event is fired

#### Scenario: Clearing an empty selection does not fire event
- **WHEN** `clearSelection()` is called while the selection is already empty
- **THEN** no `selectionchange` event is fired

### Requirement: Deselect and clear primitives
The system SHALL provide `Emap.deselect(features)` for removing specific features and `Emap.clearSelection()` for emptying the entire set.

#### Scenario: Deselect removes only the named features
- **WHEN** `deselect([X])` is called while `[X, Y]` are selected
- **THEN** only `Y` remains selected
- **AND** a `selectionchange` event with `removed: [X]` is fired

#### Scenario: Clear empties the selection in one call
- **WHEN** `clearSelection()` is called while `[X, Y, Z]` are selected
- **THEN** `getSelection()` returns an empty array
- **AND** a `selectionchange` event with `removed: [X, Y, Z]` and empty `selected` is fired

### Requirement: Layer-scoped accessor for downstream operations
The `Selection` SHALL expose a `getByLayer(source, layer)` helper returning the set of selected feature ids within a single source/layer, so geometry-operation call sites can iterate without re-grouping.

#### Scenario: Filter selection by layer
- **WHEN** the selection contains features from multiple layers
- **AND** `getByLayer(sourceId, layerId)` is called
- **THEN** the returned array contains only the numeric ids of selected features in that layer
