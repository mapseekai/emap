## ADDED Requirements

### Requirement: Emap.divideLayer
The system SHALL provide `Emap.divideLayer({ source, target, divider, fields?, force? }): Promise<boolean>` that runs mapshaper's `-divide` against a polyline `target` layer using a polygon `divider` layer in the same source.

#### Scenario: Minimal divide
- **WHEN** `divideLayer({ source, target: 'roads', divider: 'tracts' })` resolves with `true`
- **THEN** the constructed mapshaper command is `-target "roads" -divide source="tracts"`

#### Scenario: fields option
- **WHEN** `divideLayer({ ..., fields: ['NAME', 'STATE'] })` is called
- **THEN** the command appends `fields=NAME,STATE`

#### Scenario: force flag
- **WHEN** `divideLayer({ ..., force: true })` is called
- **THEN** the command appends `force`

#### Scenario: Missing source returns false
- **WHEN** `divideLayer({ source: 'nope', ... })` is called
- **THEN** the promise resolves with `false`
- **AND** no command runs

#### Scenario: Unresolved target returns false
- **WHEN** `target` does not resolve to a layer in the source
- **THEN** the promise resolves with `false`

#### Scenario: Unresolved divider returns false
- **WHEN** `divider` does not resolve to a layer in the source
- **THEN** the promise resolves with `false`

#### Scenario: Target must be polyline
- **WHEN** `target` resolves to a non-polyline layer (e.g. a polygon or point)
- **THEN** the promise resolves with `false`
- **AND** no command runs

#### Scenario: Divider must be polygon
- **WHEN** `divider` resolves to a non-polygon layer
- **THEN** the promise resolves with `false`
- **AND** no command runs

#### Scenario: Successful divide is reversible by one undo
- **WHEN** `divideLayer(opts)` resolves with `true`
- **THEN** exactly one entry is added to the undo history with label `Divide <target>`
- **AND** `Emap.undo()` once restores the original dataset reference
