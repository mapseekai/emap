## ADDED Requirements

### Requirement: Emap.dropLayer
The system SHALL provide `Emap.dropLayer({ source, target }): Promise<boolean>` that deletes a single layer from the source dataset via mapshaper's `-drop`.

#### Scenario: Minimal drop
- **WHEN** `dropLayer({ source, target: 'states' })` resolves with `true`
- **THEN** the constructed mapshaper command is `-target "states" -drop`

#### Scenario: Missing source / unresolved target returns false
- **WHEN** the source or target does not resolve
- **THEN** the promise resolves with `false`
- **AND** no command runs

#### Scenario: History label
- **WHEN** dropLayer succeeds
- **THEN** the history entry is labelled `Drop <target>`

### Requirement: Emap.sortFeatures
The system SHALL provide `Emap.sortFeatures({ source, target, expression, descending? }): Promise<boolean>` that sorts features within a target layer via mapshaper's `-sort`.

#### Scenario: Ascending sort by field
- **WHEN** `sortFeatures({ source, target: 'states', expression: 'POP' })` resolves with `true`
- **THEN** the constructed command is `-target "states" -sort "POP"`

#### Scenario: Descending sort
- **WHEN** `descending: true` is supplied
- **THEN** the command appends `descending`

#### Scenario: Empty expression returns false
- **WHEN** `expression` is empty or whitespace
- **THEN** the promise resolves with `false`

#### Scenario: History label
- **WHEN** sortFeatures succeeds
- **THEN** the history entry is labelled `Sort <target>`

### Requirement: Emap.uniqueFeatures
The system SHALL provide `Emap.uniqueFeatures({ source, target, expression, maxCount?, invert? }): Promise<boolean>` that removes duplicate features (by id expression) via mapshaper's `-uniq`.

#### Scenario: Minimal uniq
- **WHEN** `uniqueFeatures({ source, target: 'states', expression: 'STATE_FIPS' })` resolves with `true`
- **THEN** the constructed command is `-target "states" -uniq "STATE_FIPS"`

#### Scenario: max-count option
- **WHEN** `maxCount: 3` is supplied
- **THEN** the command appends `max-count=3`

#### Scenario: invert flag
- **WHEN** `invert: true`
- **THEN** the command appends `invert`

#### Scenario: Empty expression / non-positive maxCount returns false
- **WHEN** `expression` is empty or `maxCount <= 0`
- **THEN** the promise resolves with `false`

#### Scenario: History label
- **WHEN** uniqueFeatures succeeds
- **THEN** the history entry is labelled `Uniq <target>`

### Requirement: Emap.filterFields
The system SHALL provide `Emap.filterFields({ source, target, fields, invert? }): Promise<boolean>` that retains a subset of attribute fields via mapshaper's `-filter-fields`.

#### Scenario: Keep listed fields
- **WHEN** `filterFields({ source, target: 'states', fields: ['fips', 'name'] })` resolves with `true`
- **THEN** the constructed command is `-target "states" -filter-fields "fips,name"`

#### Scenario: invert flag
- **WHEN** `invert: true`
- **THEN** the command appends `invert`

#### Scenario: Empty / invalid fields returns false
- **WHEN** `fields` is `[]`, contains an empty string, or contains a string with a `,` character
- **THEN** the promise resolves with `false`

#### Scenario: History label
- **WHEN** filterFields succeeds
- **THEN** the history entry is labelled `Filter fields <target>`

### Requirement: Emap.renameFields
The system SHALL provide `Emap.renameFields({ source, target, mapping }): Promise<boolean>` that renames multiple attribute fields in one command via mapshaper's `-rename-fields`.

#### Scenario: Single field rename
- **WHEN** `renameFields({ source, target: 'states', mapping: { OLD: 'NEW' } })` resolves with `true`
- **THEN** the constructed command is `-target "states" -rename-fields "OLD=NEW"`

#### Scenario: Multi-field rename
- **WHEN** `mapping: { fips: 'STATE_FIPS', st: 'state' }` is supplied
- **THEN** the command embeds the comma-joined list of `old=new` pairs in mapping iteration order

#### Scenario: Empty / invalid mapping returns false
- **WHEN** `mapping` is empty
- **OR** any key/value is empty after trimming
- **OR** any key/value contains `,` or `=`
- **THEN** the promise resolves with `false`

#### Scenario: History label
- **WHEN** renameFields succeeds
- **THEN** the history entry is labelled `Rename fields <target>`
