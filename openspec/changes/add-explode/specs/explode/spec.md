## ADDED Requirements

### Requirement: Emap.explodeLayer
The system SHALL provide `Emap.explodeLayer({ source, target }): Promise<boolean>` that runs mapshaper's `-explode` against the named layer, recorded as a single undoable history entry.

#### Scenario: Constructs the mapshaper command
- **WHEN** `explodeLayer({ source, target: 'parts' })` is called and resolves with `true`
- **THEN** the constructed mapshaper command is `-target "parts" -explode`
- **AND** the source's dataset has been replaced with mapshaper's exploded result

#### Scenario: Missing source / target is a no-op
- **WHEN** the source or target cannot be resolved
- **THEN** the promise resolves with `false`
- **AND** no command is executed
- **AND** no events fire

#### Scenario: Successful explode is reversible by one undo
- **WHEN** `explodeLayer(opts)` resolves with `true`
- **THEN** exactly one entry is added to the undo history with label `Explode <target>`
- **AND** `Emap.undo()` once restores the original dataset reference

#### Scenario: Inherited dataset-replace semantics
- **WHEN** the user has prior history and calls `explodeLayer(opts)` successfully
- **THEN** the prior history is cleared (history barrier)
- **AND** the selection is cleared
- **AND** exactly one `historychange` event fires
