## ADDED Requirements

### Requirement: cleanLayer exposes mapshaper's full option surface
`Emap.cleanLayer` SHALL accept the full set of options that mapshaper's `-clean` command exposes (excluding aliases): `gapFillArea`, `sliverControl`, `snapInterval`, `noSnap`, `allowOverlaps`, `overlapRule`, `allowEmpty`, `rewind`, `onlyArcs`, `noArcDissolve`. All are optional; omitting an option lets mapshaper apply its default.

#### Scenario: gapFillArea forwarded as gap-fill-area=N
- **WHEN** `cleanLayer({ source, target, gapFillArea: 100 })` runs
- **THEN** the command embeds `gap-fill-area=100`

#### Scenario: overlapRule with invalid value rejected
- **WHEN** `overlapRule` is supplied as a string outside `min-id|max-id|min-area|max-area`
- **THEN** the call resolves with `false` and no command is dispatched

#### Scenario: numeric options reject NaN / negative
- **WHEN** `gapFillArea`, `sliverControl`, or `snapInterval` is `NaN` or negative
- **THEN** the call resolves with `false`

### Requirement: dissolveLayer exposes the standard dissolve workflow options
`Emap.dissolveLayer` SHALL accept `fields` (multi-field group-by), `sumFields`, `copyFields`, `calc`, `where`, `multipart`, `name`, and `noReplace`.

#### Scenario: fields multi-field group-by emitted as positional comma-list
- **WHEN** `dissolveLayer({ source, target, fields: ['STATE', 'COUNTY'] })` runs
- **THEN** the command embeds `STATE,COUNTY` as a bare positional token after `-dissolve`

#### Scenario: field and fields are mutually exclusive
- **WHEN** both `field` and `fields` are supplied
- **THEN** the call resolves with `false` and no command is dispatched

#### Scenario: copyFields / sumFields filter out comma-bearing entries
- **WHEN** any list option contains a string with `,`
- **THEN** that entry is dropped before serialization (consistent with existing list-option wrappers)

#### Scenario: calc / where forwarded as quoted JS expressions
- **WHEN** `calc` or `where` is supplied
- **THEN** the value is wrapped in `quoteMapshaperArg` and emitted as `calc="..."` / `where="..."`

#### Scenario: multipart / noReplace flags emit bare tokens
- **WHEN** `multipart: true` or `noReplace: true`
- **THEN** the command appends `multipart` and / or `no-replace` flag tokens

### Requirement: mosaicLayer exposes calc
`Emap.mosaicLayer` SHALL accept `calc?: string`. When set, the command embeds `calc="..."`.

### Requirement: snapLayer exposes fix-geometry
`Emap.snapLayer` SHALL accept `fixGeometry?: boolean`. When `true`, the command appends the bare `fix-geometry` flag.
