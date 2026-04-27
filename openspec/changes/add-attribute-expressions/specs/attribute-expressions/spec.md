## ADDED Requirements

### Requirement: Emap.applyExpression
The system SHALL provide `Emap.applyExpression({ source, target, expression, where? }): Promise<boolean>` that runs mapshaper's `-each` against a layer, mutating attributes per the supplied JS expression, recorded as one undoable history entry.

#### Scenario: Basic expression mutates every record
- **WHEN** `applyExpression({ source, target, expression: 'this.density = this.pop / this.area' })` is called and resolves with `true`
- **THEN** the constructed mapshaper command is `-target "<target>" -each "this.density = this.pop / this.area"` (expression quoted)
- **AND** the source's dataset has been replaced with mapshaper's mutated result

#### Scenario: where filters the affected subset
- **WHEN** `applyExpression({ ..., expression: 'this.flag = true', where: 'this.pop > 100' })` is called
- **THEN** the constructed command appends ` where="this.pop > 100"` (where value quoted)

#### Scenario: Missing source / target is a no-op
- **WHEN** the source or target cannot be resolved
- **THEN** the promise resolves with `false`
- **AND** no command is executed
- **AND** no history entry is pushed
- **AND** no events fire

#### Scenario: Empty expression is rejected
- **WHEN** `applyExpression({ ..., expression: '' })` (or whitespace-only) is called
- **THEN** the promise resolves with `false`
- **AND** no command is executed (mapshaper would error; we catch early)

#### Scenario: Successful run is reversible by one undo
- **WHEN** `applyExpression(opts)` resolves with `true`
- **THEN** exactly one entry is added to the undo history with label `Update <target>`
- **AND** `Emap.undo()` once restores the original dataset reference

#### Scenario: Inherited dataset-replace semantics
- **WHEN** the user has prior history and calls `applyExpression(opts)` successfully
- **THEN** the prior history is cleared (history barrier)
- **AND** the selection is cleared
- **AND** exactly one `historychange` event fires
