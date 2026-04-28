## ADDED Requirements

### Requirement: Emap.linesLayer
The system SHALL provide `Emap.linesLayer({ source, target, fields?, name?, noReplace? }): Promise<boolean>` that runs mapshaper's `-lines` against a polygon target.

#### Scenario: Minimal command
- **WHEN** `linesLayer({ source, target: 'parks' })` resolves with `true`
- **THEN** the constructed mapshaper command is `-target "parks" -lines`

#### Scenario: fields list
- **WHEN** `fields: ['STATE', 'COUNTY']` is supplied
- **THEN** the command appends `STATE,COUNTY` as a bare positional argument

#### Scenario: name option
- **WHEN** `name` is supplied
- **THEN** the command appends `name="<value>"` (quoted)

#### Scenario: noReplace flag
- **WHEN** `noReplace` is `true`
- **THEN** the command appends `no-replace`

#### Scenario: Missing source returns false
- **WHEN** `source` does not resolve
- **THEN** the promise resolves with `false`
- **AND** no command runs

#### Scenario: Unresolved target returns false
- **WHEN** `target` does not resolve to a layer in the source
- **THEN** the promise resolves with `false`

#### Scenario: Target must be polygon
- **WHEN** target resolves to a non-polygon layer
- **THEN** the promise resolves with `false`
- **AND** no command runs

#### Scenario: Successful lines op is reversible by one undo
- **WHEN** `linesLayer(opts)` resolves with `true`
- **THEN** exactly one entry is added to the undo history with label `Lines <target>`
- **AND** `Emap.undo()` once restores the original dataset reference
