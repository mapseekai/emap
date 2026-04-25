## ADDED Requirements

### Requirement: Single-feature property writes
The system SHALL provide `Emap.setFeatureProperty(ref, key, value)` and `Emap.setFeatureProperties(ref, props)` for mutating attribute values on a single feature, with full undo / redo support.

#### Scenario: Setting a new key
- **WHEN** `setFeatureProperty(ref, 'foo', 42)` is called and the feature's record does NOT have a `foo` key
- **THEN** the record now has `foo: 42`
- **AND** one entry has been added to the undo history
- **AND** calling `undo()` removes the `foo` key (returning the record to its original shape)

#### Scenario: Overwriting an existing key
- **WHEN** `setFeatureProperty(ref, 'name', 'B')` is called on a record where `name` was `'A'`
- **THEN** the record now has `name: 'B'`
- **AND** undoing restores `name: 'A'`

#### Scenario: Setting undefined deletes the key
- **WHEN** `setFeatureProperty(ref, 'foo', undefined)` is called on a record that had `foo: 'x'`
- **THEN** the record no longer has a `foo` key
- **AND** undoing restores `foo: 'x'`

#### Scenario: Multi-key patch is one history entry
- **WHEN** `setFeatureProperties(ref, { a: 1, b: 2 })` is called
- **THEN** both keys are written
- **AND** exactly one entry is added to the undo history
- **AND** a single `undo()` reverses both writes

#### Scenario: No-op patch returns false
- **WHEN** `setFeatureProperties(ref, props)` is called with values that match the record exactly
- **THEN** the call returns `false`
- **AND** no history entry is pushed
- **AND** no events fire

#### Scenario: Unresolvable feature returns false
- **WHEN** the ref's source / layer / id cannot be resolved to a record
- **THEN** the call returns `false`
- **AND** no command is pushed

### Requirement: Field-level (schema) operations
The system SHALL provide `Emap.addField`, `Emap.removeField`, and `Emap.renameField` for mutating the column structure of a layer's data table, with full undo / redo support.

#### Scenario: addField sets the default value on every record that lacked the key
- **WHEN** `addField({ source, target, field: 'pop', defaultValue: 0 })` is called
- **THEN** every record that did not have a `pop` key now has `pop: 0`
- **AND** records that already had `pop` are unchanged
- **AND** `undo()` removes the `pop` key from exactly those records the command added it to

#### Scenario: removeField captures per-record values for undo
- **WHEN** `removeField({ source, target, field: 'name' })` is called on a layer where some records had `name` and others did not
- **THEN** the `name` key is removed from every record that had it
- **AND** `undo()` restores each record's prior `name` value (and does not introduce the key on records that never had it)

#### Scenario: renameField round-trips on every record
- **WHEN** `renameField({ source, target, from: 'a', to: 'b' })` is called and the layer has no `b` key on any record
- **THEN** every record's `a` value moves to `b` and the `a` key is gone
- **AND** `undo()` reverses the rename exactly

#### Scenario: renameField refuses on collision
- **WHEN** any record in the layer already has both `from` and `to` keys
- **THEN** the call returns `false`
- **AND** no records are mutated
- **AND** no command is pushed

### Requirement: Attribute commands compose in one undo timeline
Attribute edits SHALL NOT clear prior history. They are not a history barrier, unlike whole-dataset operations.

#### Scenario: Attribute and geometry commands interleave freely
- **WHEN** the user moves a vertex (pushed as a `VertexMoveCommand`)
- **AND** then sets a property (pushed as a `FeaturePropertyChangeCommand`)
- **THEN** the undo stack contains BOTH commands in order
- **AND** two consecutive `undo()` calls reverse the property write first, then the vertex move

### Requirement: historychange fires once per successful call
Each successful attribute method SHALL fire exactly one `historychange` event.

#### Scenario: Single fire per call
- **WHEN** `setFeatureProperty(ref, k, v)` succeeds
- **THEN** exactly one `historychange` event is fired with `canUndo: true` and the command's label
