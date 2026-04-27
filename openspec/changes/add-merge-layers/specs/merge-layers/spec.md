## ADDED Requirements

### Requirement: Emap.mergeLayers
The system SHALL provide `Emap.mergeLayers({ source, targets, name?, force?, flatten? }): Promise<boolean>` that combines two or more layers in the same source into one via mapshaper's `-merge-layers`.

#### Scenario: Two-layer merge
- **WHEN** `mergeLayers({ source, targets: ['a', 'b'] })` resolves with `true`
- **THEN** the constructed mapshaper command is `-target "a,b" -merge-layers`

#### Scenario: Three-layer merge preserves order
- **WHEN** `targets: ['c', 'a', 'b']` is supplied
- **THEN** the command is `-target "c,a,b" -merge-layers`

#### Scenario: name option
- **WHEN** `name: 'combined'` is supplied
- **THEN** the command appends `name="combined"`

#### Scenario: force flag
- **WHEN** `force: true`
- **THEN** the command appends `force`

#### Scenario: flatten flag
- **WHEN** `flatten: true`
- **THEN** the command appends `flatten`

#### Scenario: Fewer than two targets returns false
- **WHEN** `targets: ['only']` or `targets: []` is supplied
- **THEN** the promise resolves with `false`

#### Scenario: Unresolved target returns false
- **WHEN** any name in `targets` does not resolve to a layer in the source
- **THEN** the promise resolves with `false`

#### Scenario: Mixed geometry types without force returns false
- **WHEN** `targets` reference layers with different `geometry_type` values
- **AND** `force` is not `true`
- **THEN** the promise resolves with `false`
- **AND** no command runs

#### Scenario: Mixed geometry types with force=true is allowed
- **WHEN** `targets` reference layers with different `geometry_type` values
- **AND** `force: true`
- **THEN** the command runs with the `force` flag appended

#### Scenario: Missing source returns false
- **WHEN** `source` does not resolve
- **THEN** the promise resolves with `false`

#### Scenario: Successful merge is reversible by one undo
- **WHEN** `mergeLayers(opts)` resolves with `true`
- **THEN** exactly one entry is added to the undo history with label `Merge <comma-joined-targets>`
- **AND** `Emap.undo()` once restores the original dataset reference
