## ADDED Requirements

### Requirement: Emap.renameLayer
The system SHALL provide `Emap.renameLayer({ source, target, name }): Promise<boolean>` that renames one layer in the source dataset via mapshaper's `-rename-layers`.

#### Scenario: Minimal rename
- **WHEN** `renameLayer({ source, target: 'old', name: 'new' })` resolves with `true`
- **THEN** the constructed mapshaper command is `-target "old" -rename-layers new`

#### Scenario: Quotes are added when the new name contains spaces or special chars
- **WHEN** `name: 'My Layer'` is supplied
- **THEN** the command embeds the new name as `"My Layer"` (quoted)

#### Scenario: Missing source returns false
- **WHEN** `source` does not resolve
- **THEN** the promise resolves with `false`

#### Scenario: Unresolved target returns false
- **WHEN** `target` does not resolve to a layer in the source
- **THEN** the promise resolves with `false`

#### Scenario: Empty / whitespace name returns false
- **WHEN** `name` is `""`, `"   "`, or otherwise empty after trimming
- **THEN** the promise resolves with `false`

#### Scenario: Collision with another existing layer returns false
- **WHEN** another layer in the same source already has the requested `name`
- **THEN** the promise resolves with `false`
- **AND** no command runs

#### Scenario: Renaming to current name is a no-op-style success
- **WHEN** `name` equals `target`
- **THEN** the promise resolves with `true` (the command runs but is harmless)

#### Scenario: Successful rename is reversible by one undo
- **WHEN** `renameLayer(opts)` resolves with `true`
- **THEN** exactly one entry is added to the undo history with label `Rename <target> → <name>`
- **AND** `Emap.undo()` once restores the original layer name
