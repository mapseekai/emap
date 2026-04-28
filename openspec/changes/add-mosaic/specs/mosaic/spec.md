## ADDED Requirements

### Requirement: Emap.mosaicLayer
The system SHALL provide `Emap.mosaicLayer({ source, target, snapInterval?, noSnap?, noReplace?, name? }): Promise<boolean>` that runs mapshaper's `-mosaic` against the named polygon layer and records the operation as a single undoable history entry.

#### Scenario: Bare mosaic
- **WHEN** `mosaicLayer({ source, target: 'parts' })` resolves with `true`
- **THEN** the constructed command is `-target "parts" -mosaic`

#### Scenario: snap-interval option
- **WHEN** `mosaicLayer({ ..., snapInterval: 0.001 })` is called
- **THEN** the command appends `snap-interval=0.001`

#### Scenario: no-snap flag
- **WHEN** `mosaicLayer({ ..., noSnap: true })` is called
- **THEN** the command appends `no-snap`

#### Scenario: no-replace flag
- **WHEN** `mosaicLayer({ ..., noReplace: true })` is called
- **THEN** the command appends `no-replace`

#### Scenario: name option is quoted
- **WHEN** `mosaicLayer({ ..., name: 'flat zones' })` is called
- **THEN** the command appends `name="flat zones"`

#### Scenario: Missing source / target is a no-op
- **WHEN** the source or target cannot be resolved
- **THEN** the promise resolves with `false`
- **AND** no command runs

#### Scenario: Successful mosaic is reversible by one undo
- **WHEN** `mosaicLayer(opts)` resolves with `true`
- **THEN** exactly one entry is added to the undo history with label `Mosaic <target>`
- **AND** `Emap.undo()` once restores the original dataset reference
