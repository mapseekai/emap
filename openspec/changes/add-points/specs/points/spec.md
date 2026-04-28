## ADDED Requirements

### Requirement: Emap.pointsLayer
The system SHALL provide `Emap.pointsLayer({ source, target, type, interval?, name?, noReplace? }): Promise<boolean>` that runs mapshaper's `-points` with a single mode flag derived from `type`.

#### Scenario: Centroid mode
- **WHEN** `pointsLayer({ source, target: 'parks', type: 'centroid' })` resolves with `true`
- **THEN** the constructed mapshaper command is `-target "parks" -points centroid`

#### Scenario: Inner-point mode
- **WHEN** `type` is `'inner'`
- **THEN** the command appends `inner`

#### Scenario: Vertices mode
- **WHEN** `type` is `'vertices'`
- **THEN** the command appends `vertices`

#### Scenario: Endpoints mode
- **WHEN** `type` is `'endpoints'`
- **THEN** the command appends `endpoints`

#### Scenario: Midpoints mode
- **WHEN** `type` is `'midpoints'`
- **THEN** the command appends `midpoints`

#### Scenario: Interpolated mode
- **WHEN** `type` is `'interpolated'` and `interval > 0`
- **THEN** the command appends `interpolated interval=<n>`

#### Scenario: Interpolated requires interval
- **WHEN** `type` is `'interpolated'` and `interval` is missing or `<= 0`
- **THEN** the promise resolves with `false`
- **AND** no command runs

#### Scenario: name option
- **WHEN** `name` is supplied
- **THEN** the command appends `name="<value>"` (quoted)

#### Scenario: noReplace flag
- **WHEN** `noReplace` is `true`
- **THEN** the command appends `no-replace`

#### Scenario: Centroid / inner require polygon target
- **WHEN** `type` is `'centroid'` or `'inner'` and target is not a polygon layer
- **THEN** the promise resolves with `false`

#### Scenario: Midpoints / interpolated require polyline target
- **WHEN** `type` is `'midpoints'` or `'interpolated'` and target is not a polyline layer
- **THEN** the promise resolves with `false`

#### Scenario: Vertices / endpoints require polygon or polyline target
- **WHEN** `type` is `'vertices'` or `'endpoints'` and target is a point layer
- **THEN** the promise resolves with `false`

#### Scenario: Missing source returns false
- **WHEN** `source` does not resolve
- **THEN** the promise resolves with `false`

#### Scenario: Unresolved target returns false
- **WHEN** `target` does not resolve to a layer in the source
- **THEN** the promise resolves with `false`

#### Scenario: Successful points op is reversible by one undo
- **WHEN** `pointsLayer(opts)` resolves with `true`
- **THEN** exactly one entry is added to the undo history with label `Points <target>`
- **AND** `Emap.undo()` once restores the original dataset reference
