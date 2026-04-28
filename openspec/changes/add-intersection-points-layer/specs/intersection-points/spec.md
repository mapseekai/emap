## ADDED Requirements

### Requirement: Emap.intersectionPointsLayer
The system SHALL provide `Emap.intersectionPointsLayer({ source, target, name?, tolerance? }): Promise<boolean>` that materializes the self-intersection points of a polygon or polyline target as a new point layer in the same dataset, registered as one undoable history entry.

#### Scenario: Adds a new point layer with the intersection points
- **WHEN** `intersectionPointsLayer({ source, target: 'edges' })` resolves with `true`
- **THEN** the source's dataset gains a new layer with `geometry_type: 'point'`
- **AND** the new layer's name is `edges-intersections` (default) unless `name` was supplied

#### Scenario: name option collision is rejected
- **WHEN** `name` is supplied and a layer with that name already exists in the source dataset
- **THEN** the call resolves with `false` and no layer is added

#### Scenario: target must be polygon or polyline
- **WHEN** `target` resolves to a layer with `geometry_type: 'point'` (no segments)
- **THEN** the call resolves with `false`

#### Scenario: Missing source / unresolved target returns false
- **WHEN** `source` does not resolve, or `target` does not resolve to a layer
- **THEN** the call resolves with `false`
- **AND** the underlying mapshaper internals are not invoked

#### Scenario: tolerance is forwarded as `findSegmentIntersections({ tolerance })`
- **WHEN** `tolerance: 0.001` is supplied
- **THEN** the underlying `mapshaper.internal.findSegmentIntersections` is invoked with `{ tolerance: 0.001 }`

#### Scenario: tolerance must be positive finite
- **WHEN** `tolerance` is `0`, negative, or `NaN`
- **THEN** the call resolves with `false`

#### Scenario: Successful op is reversible by one undo
- **WHEN** the call resolves with `true`
- **THEN** exactly one entry is added to the undo history with label `Intersection points <target>`
- **AND** `Emap.undo()` once restores the original dataset (without the new point layer)
