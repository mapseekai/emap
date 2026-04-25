## ADDED Requirements

### Requirement: Emap.dissolveLayer
The system SHALL provide `Emap.dissolveLayer({ source, target, field? })` that runs mapshaper's `-dissolve` against the named layer, recording the operation as a single undoable history entry.

#### Scenario: Whole-layer dissolve merges every feature into one
- **WHEN** `dissolveLayer({ source, target })` is called without a `field` option and resolves with `true`
- **THEN** the source's dataset has been replaced with mapshaper's dissolve result (all features in the target layer collapsed to one)
- **AND** exactly one entry is added to the undo history with label `Dissolve <target>`

#### Scenario: Field-based dissolve groups features by the named field
- **WHEN** `dissolveLayer({ source, target, field: 'state' })` is called and resolves with `true`
- **THEN** the constructed mapshaper command places the field name as a positional argument (`-target "<target>" -dissolve "state"`)
- **AND** features sharing the same `state` value are merged in the resulting dataset

#### Scenario: Missing source or target is a no-op
- **WHEN** `dissolveLayer(opts)` is called with a `source` or `target` that cannot be resolved
- **THEN** the promise resolves with `false`
- **AND** no command is executed
- **AND** no history entry is pushed
- **AND** no events are fired

#### Scenario: Successful dissolve clears the selection
- **WHEN** a dissolve operation completes successfully and the selection was non-empty
- **THEN** `getSelection()` returns an empty array after the promise resolves
- **AND** a `selectionchange` event is fired with the previously-selected refs in `removed`

#### Scenario: Successful dissolve is reversible by one undo
- **WHEN** `dissolveLayer(opts)` resolves with `true`
- **AND** `Emap.undo()` is called once
- **THEN** the source's dataset is restored to the reference that was active before the dissolve

#### Scenario: Layer or field names with special characters are quoted
- **WHEN** the target or field contains a space or a double quote
- **THEN** the constructed mapshaper command wraps the value in double quotes and escapes any embedded quotes (the same convention the CLI accepts)
