## ADDED Requirements

### Requirement: Emap.unionLayers
The system SHALL provide `Emap.unionLayers({ source, targets, fields?, name?, noReplace? }): Promise<boolean>` that runs mapshaper's `-union` against two or more polygon layers in the same source.

#### Scenario: Two-layer union
- **WHEN** `unionLayers({ source, targets: ['parks', 'soils'] })` resolves with `true`
- **THEN** the constructed mapshaper command is `-target "parks,soils" -union`

#### Scenario: Three-layer union
- **WHEN** `unionLayers({ source, targets: ['a', 'b', 'c'] })` is called
- **THEN** the command is `-target "a,b,c" -union` (preserving order)

#### Scenario: fields option
- **WHEN** `unionLayers({ ..., fields: ['name', 'type'] })` is called
- **THEN** the command appends `fields=name,type`

#### Scenario: name option
- **WHEN** `unionLayers({ ..., name: 'overlay' })` is called
- **THEN** the command appends `name="overlay"` (quoted)

#### Scenario: noReplace flag
- **WHEN** `unionLayers({ ..., noReplace: true })` is called
- **THEN** the command appends `no-replace`

#### Scenario: Fewer than two targets returns false
- **WHEN** `unionLayers({ source, targets: ['a'] })` is called
- **THEN** the promise resolves with `false`
- **AND** no command runs

#### Scenario: Empty targets returns false
- **WHEN** `unionLayers({ source, targets: [] })` is called
- **THEN** the promise resolves with `false`

#### Scenario: Unresolved target returns false
- **WHEN** any name in `targets` does not resolve to a layer in the source
- **THEN** the promise resolves with `false`
- **AND** no command runs

#### Scenario: Successful union is reversible by one undo
- **WHEN** `unionLayers(opts)` resolves with `true`
- **THEN** exactly one entry is added to the undo history with label `Union <comma-joined-targets>`
- **AND** `Emap.undo()` once restores the original dataset reference
