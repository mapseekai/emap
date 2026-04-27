## ADDED Requirements

### Requirement: Emap.projectLayer
The system SHALL provide `Emap.projectLayer({ source, crs, target?, init?, densify? }): Promise<boolean>` that runs mapshaper's `-proj` against either a single target layer or the whole source dataset.

#### Scenario: Whole-source project (no target)
- **WHEN** `projectLayer({ source, crs: 'EPSG:3857' })` resolves with `true`
- **THEN** the constructed mapshaper command is `-proj "EPSG:3857"` (no `-target` prefix)

#### Scenario: Target-scoped project
- **WHEN** `target: 'roads'` is supplied alongside a valid `crs`
- **THEN** the command begins with `-target "roads" -proj "<crs>"`

#### Scenario: Quotes preserve CRS strings with spaces
- **WHEN** `crs: '+proj=utm +zone=10'` is supplied
- **THEN** the command embeds it as `-proj "+proj=utm +zone=10"` (quoted)

#### Scenario: init source-CRS option
- **WHEN** `init: 'EPSG:4326'` is supplied
- **THEN** the command appends `init="EPSG:4326"` (quoted)

#### Scenario: densify flag
- **WHEN** `densify: true`
- **THEN** the command appends `densify`

#### Scenario: Missing source returns false
- **WHEN** `source` does not resolve
- **THEN** the promise resolves with `false`
- **AND** no command runs

#### Scenario: Unresolved target returns false
- **WHEN** `target` is supplied and does not resolve
- **THEN** the promise resolves with `false`

#### Scenario: Empty / whitespace crs returns false
- **WHEN** `crs` is `""`, `"   "`, or otherwise empty after trimming
- **THEN** the promise resolves with `false`

#### Scenario: Successful project is reversible by one undo
- **WHEN** `projectLayer(opts)` resolves with `true`
- **THEN** exactly one entry is added to the undo history with label `Project <target | source>`
- **AND** `Emap.undo()` once restores the original dataset reference
