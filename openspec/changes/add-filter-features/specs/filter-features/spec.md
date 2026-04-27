## ADDED Requirements

### Requirement: Emap.filterFeatures
The system SHALL provide `Emap.filterFeatures({ source, target, expression?, invert?, removeEmpty? }): Promise<boolean>` that runs mapshaper's `-filter` against the named layer and records the operation as a single undoable history entry.

#### Scenario: Expression keeps matching features
- **WHEN** `filterFeatures({ source, target, expression: 'this.pop > 100' })` is called
- **THEN** the constructed mapshaper command is `-target "<target>" -filter "this.pop > 100"`

#### Scenario: invert flips the predicate
- **WHEN** `filterFeatures({ ..., expression: '...', invert: true })` is called
- **THEN** the constructed command appends ` invert`

#### Scenario: removeEmpty drops null-geometry features
- **WHEN** `filterFeatures({ ..., expression: '...', removeEmpty: true })` is called
- **THEN** the constructed command appends ` remove-empty`

#### Scenario: removeEmpty alone (no expression)
- **WHEN** `filterFeatures({ source, target, removeEmpty: true })` is called without an expression
- **THEN** the constructed command is `-target "<target>" -filter remove-empty`

#### Scenario: Neither expression nor removeEmpty returns false
- **WHEN** `filterFeatures({ source, target })` is called with no predicate at all
- **THEN** the promise resolves with `false`
- **AND** no command is executed

#### Scenario: Missing source / target is a no-op
- **WHEN** the source or target cannot be resolved
- **THEN** the promise resolves with `false`
- **AND** no command runs

#### Scenario: Successful filter is reversible by one undo
- **WHEN** `filterFeatures(opts)` resolves with `true`
- **THEN** exactly one entry is added to the undo history with label `Filter <target>`
- **AND** `Emap.undo()` once restores the original dataset reference
