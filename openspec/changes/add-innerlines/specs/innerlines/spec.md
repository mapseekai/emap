## ADDED Requirements

### Requirement: Emap.innerlinesLayer
The system SHALL provide `Emap.innerlinesLayer({ source, target, where?, name?, noReplace? }): Promise<boolean>` that runs mapshaper's `-innerlines` against the named layer to extract its shared edges as a polyline layer.

#### Scenario: Minimal call
- **WHEN** `innerlinesLayer({ source, target: 'states' })` is called and resolves with `true`
- **THEN** the constructed mapshaper command is `-target "states" -innerlines`

#### Scenario: where filter
- **WHEN** `innerlinesLayer({ ..., where: 'A.STATE !== B.STATE' })` is called
- **THEN** the constructed command appends ` where="A.STATE !== B.STATE"` (quoted)

#### Scenario: name option
- **WHEN** `innerlinesLayer({ ..., name: 'borders' })` is called
- **THEN** the constructed command appends ` name="borders"` (quoted)

#### Scenario: noReplace flag
- **WHEN** `innerlinesLayer({ ..., noReplace: true })` is called
- **THEN** the constructed command appends ` no-replace`
- **AND** the original polygon layer remains alongside the new polyline layer in the post-op dataset

#### Scenario: Missing source / target is a no-op
- **WHEN** the source or target cannot be resolved
- **THEN** the promise resolves with `false`
- **AND** no command is executed

#### Scenario: Successful run is reversible by one undo
- **WHEN** `innerlinesLayer(opts)` resolves with `true`
- **THEN** exactly one entry is added to the undo history with label `Innerlines <target>`
- **AND** `Emap.undo()` once restores the original dataset reference
