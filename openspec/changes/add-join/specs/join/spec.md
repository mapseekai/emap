## ADDED Requirements

### Requirement: Emap.joinTable
The system SHALL provide `Emap.joinTable(opts: JoinTableOptions): Promise<boolean>` that joins external attribute records (from CSV, JSON, or another layer) onto a target layer via mapshaper's `-join`.

#### Scenario: CSV-string join
- **WHEN** `joinTable({ source, target: 'states', data: { csv: 'fips,pop\n01,4M\n02,800K' }, keys: ['STATE_FIPS', 'fips'] })` resolves with `true`
- **THEN** the constructed mapshaper command is `-target "states" -join ".emap-join.csv" keys="STATE_FIPS,fips"`
- **AND** the input-file cache passed into the runner contains `'.emap-join.csv'` with the bytes of the CSV string

#### Scenario: JSON-string join
- **WHEN** `data: { json: '[{"a":1}]' }` is supplied
- **THEN** the cache key is `.emap-join.json` and the bytes are the JSON string

#### Scenario: JSON-array join (auto-stringified)
- **WHEN** `data: { json: [{ a: 1 }, { a: 2 }] }` is supplied
- **THEN** the cache key is `.emap-join.json` and the bytes are `JSON.stringify` of the array

#### Scenario: Layer-based join
- **WHEN** `data: { layer: 'pop_table' }` is supplied
- **THEN** the constructed command is `-target "states" -join "pop_table" keys="..."`
- **AND** no input-file cache is created

#### Scenario: fields= passthrough
- **WHEN** `fields: ['pop', 'gdp']` is supplied
- **THEN** the command appends `fields=pop,gdp`

#### Scenario: prefix= passthrough
- **WHEN** `prefix: 'p_'` is supplied
- **THEN** the command appends `prefix=p_`

#### Scenario: where= passthrough (quoted)
- **WHEN** `where: 'this.year === 2024'` is supplied
- **THEN** the command appends `where="this.year === 2024"`

#### Scenario: calc= passthrough (quoted)
- **WHEN** `calc: 'sum(pop)'` is supplied
- **THEN** the command appends `calc="sum(pop)"`

#### Scenario: unjoined / unmatched flags
- **WHEN** `unjoined: true` and `unmatched: true` are supplied
- **THEN** the command appends both `unjoined` and `unmatched`

#### Scenario: Missing keys returns false
- **WHEN** `keys` is missing, not a 2-tuple, or contains an empty string
- **THEN** the promise resolves with `false`
- **AND** no command runs

#### Scenario: Missing source / unresolved target returns false
- **WHEN** `source` does not resolve, or `target` does not resolve to a layer in the source
- **THEN** the promise resolves with `false`

#### Scenario: Invalid data shape returns false
- **WHEN** `data` is missing `csv`, `json`, and `layer`
- **THEN** the promise resolves with `false`

#### Scenario: History label
- **WHEN** `joinTable` succeeds
- **THEN** exactly one entry is added to the undo history with label `Join <target>`
