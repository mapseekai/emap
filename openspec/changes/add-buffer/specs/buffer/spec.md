## ADDED Requirements

### Requirement: Emap.bufferLayer
The system SHALL provide `Emap.bufferLayer({ source, target, radius, capStyle? })` that runs mapshaper's `-buffer` against the named layer and records the operation as a single undoable history entry.

#### Scenario: Constant numeric radius
- **WHEN** `bufferLayer({ source, target, radius: 5 })` is called and resolves with `true`
- **THEN** the constructed mapshaper command is `-target "<target>" -buffer 5`
- **AND** the source's dataset has been replaced with mapshaper's buffered output

#### Scenario: Expression radius
- **WHEN** `bufferLayer({ source, target, radius: 'pop / 1000' })` is called
- **THEN** the constructed command is `-target "<target>" -buffer "pop / 1000"` (radius arg is quoted)

#### Scenario: capStyle option
- **WHEN** `bufferLayer({ source, target, radius: 5, capStyle: 'flat' })` is called
- **THEN** the constructed command appends `cap-style=flat`

#### Scenario: Missing source / target is a no-op
- **WHEN** `bufferLayer(opts)` is called with a `source` or `target` that cannot be resolved in the current sources
- **THEN** the promise resolves with `false`
- **AND** no command is executed
- **AND** no history entry is pushed
- **AND** no events are fired

#### Scenario: Successful buffer is reversible by one undo
- **WHEN** `bufferLayer(opts)` resolves with `true`
- **THEN** exactly one entry is added to the undo history with label `Buffer <target>`
- **AND** `Emap.undo()` once restores the original dataset reference

#### Scenario: Inherited dataset-replace semantics
- **WHEN** the user has prior history and calls `bufferLayer(opts)` successfully
- **THEN** the prior history is cleared (history barrier)
- **AND** the selection is cleared (feature ids may have changed)
- **AND** exactly one `historychange` event fires
