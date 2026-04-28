## ADDED Requirements

### Requirement: Emap.rebuildTopology
The system SHALL provide `Emap.rebuildTopology({ source, snapInterval?, noSnap?, rebuildTopology? }): Promise<boolean>` that re-derives shared arcs and inserts intersection cuts via `mapshaper.internal.addIntersectionCuts`, recorded as one undoable history entry.

#### Scenario: Calls addIntersectionCuts on a dataset copy
- **WHEN** `rebuildTopology({ source: 's' })` resolves with `true`
- **THEN** `mapshaper.internal.copyDataset` is invoked once with the source's dataset
- **AND** `mapshaper.internal.addIntersectionCuts` is invoked once with the resulting copy

#### Scenario: Forwards snake_case options
- **WHEN** `rebuildTopology({ source: 's', snapInterval: 0.001, noSnap: false, rebuildTopology: true })` is called
- **THEN** the options object passed to `addIntersectionCuts` is `{ snap_interval: 0.001, no_snap: false, rebuild_topology: true }`

#### Scenario: Missing source returns false
- **WHEN** `source` does not resolve
- **THEN** the promise resolves with `false`
- **AND** no mapshaper call is made

#### Scenario: Source without a dataset returns false
- **WHEN** the source's `getDataset()` returns `undefined`
- **THEN** the promise resolves with `false`

#### Scenario: Dataset without arcs is a no-op success
- **WHEN** the source's dataset has no `arcs` property
- **THEN** the promise resolves with `true`
- **AND** `addIntersectionCuts` is NOT called
- **AND** no history entry is pushed

#### Scenario: Pushes one DatasetReplaceCommand on success
- **WHEN** the rebuild succeeds
- **THEN** exactly one entry is pushed onto the undo history with label `Rebuild topology`
- **AND** that entry's before/after datasets are deep copies (not references)

#### Scenario: Acts as a history barrier
- **WHEN** the rebuild succeeds
- **THEN** any prior fine-grained edit commands (translate, vertex move) are cleared from the history
- **AND** the selection is cleared

#### Scenario: addIntersectionCuts throws → fires error event
- **WHEN** `mapshaper.internal.addIntersectionCuts` throws
- **THEN** the promise resolves with `false`
- **AND** an `error` event is fired carrying the original error
- **AND** no history entry is pushed
- **AND** the source's dataset is unchanged
