## ADDED Requirements

### Requirement: Emap.polygonsLayer
The system SHALL provide `Emap.polygonsLayer({ source, target, gapTolerance?, fromRings? }): Promise<boolean>` that runs mapshaper's `-polygons` against a polyline target.

#### Scenario: Minimal command
- **WHEN** `polygonsLayer({ source, target: 'edges' })` resolves with `true`
- **THEN** the constructed mapshaper command is `-target "edges" -polygons`

#### Scenario: gapTolerance is forwarded when positive
- **WHEN** `gapTolerance: 0.001` is supplied
- **THEN** the command appends `gap-tolerance=0.001`

#### Scenario: gapTolerance is ignored when zero or negative
- **WHEN** `gapTolerance: 0` or a negative value is supplied
- **THEN** the command does NOT append `gap-tolerance=`

#### Scenario: fromRings flag
- **WHEN** `fromRings: true` is supplied
- **THEN** the command appends `from-rings`

#### Scenario: Missing source returns false
- **WHEN** `source` does not resolve
- **THEN** the promise resolves with `false`
- **AND** no command runs

#### Scenario: Unresolved target returns false
- **WHEN** `target` does not resolve to a layer in the source
- **THEN** the promise resolves with `false`

#### Scenario: Target must be polyline
- **WHEN** target resolves to a non-polyline layer
- **THEN** the promise resolves with `false`
- **AND** no command runs

#### Scenario: Successful polygons op is reversible by one undo
- **WHEN** `polygonsLayer(opts)` resolves with `true`
- **THEN** exactly one entry is added to the undo history with label `Polygons <target>`
- **AND** `Emap.undo()` once restores the original dataset reference
