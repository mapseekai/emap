## ADDED Requirements

### Requirement: Emap.splitLayer
The system SHALL provide `Emap.splitLayer({ source, target, expression, noReplace? }): Promise<boolean>` that partitions a single layer into one output layer per distinct grouping value via mapshaper's `-split`.

#### Scenario: Bare field-name split
- **WHEN** `splitLayer({ source, target: 'states', expression: 'REGION' })` resolves with `true`
- **THEN** the constructed mapshaper command is `-target "states" -split "REGION"`

#### Scenario: JS-expression split is forwarded verbatim
- **WHEN** `expression: 'this.pop > 1000000 ? "big" : "small"'`
- **THEN** the entire expression is embedded as a single quoted argument (no escaping or rewriting)

#### Scenario: noReplace flag
- **WHEN** `noReplace: true`
- **THEN** the command appends `no-replace`

#### Scenario: Missing source returns false
- **WHEN** `source` does not resolve
- **THEN** the promise resolves with `false`

#### Scenario: Unresolved target returns false
- **WHEN** `target` does not resolve to a layer in the source
- **THEN** the promise resolves with `false`

#### Scenario: Empty / whitespace expression returns false
- **WHEN** `expression` is `""` or whitespace-only
- **THEN** the promise resolves with `false`

#### Scenario: Successful split is reversible by one undo
- **WHEN** `splitLayer(opts)` resolves with `true`
- **THEN** exactly one entry is added to the undo history with label `Split <target>`
- **AND** `Emap.undo()` once restores the original dataset reference
