## ADDED Requirements

### Requirement: Emap.snapLayer
The system SHALL provide `Emap.snapLayer({ source, target, interval?, endpoints?, precision? }): Promise<boolean>` that runs mapshaper's `-snap` against the named layer and records the operation as a single undoable history entry.

#### Scenario: Bare snap (mapshaper default interval)
- **WHEN** `snapLayer({ source, target })` is called
- **THEN** the constructed mapshaper command is `-target "<target>" -snap`

#### Scenario: Custom interval
- **WHEN** `snapLayer({ ..., interval: 0.0001 })` is called
- **THEN** the constructed command appends ` 0.0001` (positional, bare)

#### Scenario: Endpoints-only flag
- **WHEN** `snapLayer({ ..., endpoints: true })` is called
- **THEN** the constructed command appends ` endpoints`

#### Scenario: Precision
- **WHEN** `snapLayer({ ..., precision: 0.000001 })` is called
- **THEN** the constructed command appends ` precision=0.000001`

#### Scenario: Missing source / target is a no-op
- **WHEN** the source or target cannot be resolved
- **THEN** the promise resolves with `false`
- **AND** no command runs

#### Scenario: Successful snap is reversible by one undo
- **WHEN** `snapLayer(opts)` resolves with `true`
- **THEN** exactly one entry is added to the undo history with label `Snap <target>`
- **AND** `Emap.undo()` once restores the original dataset reference
