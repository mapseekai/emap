## ADDED Requirements

### Requirement: Emap.checkGeometry
The system SHALL provide `Emap.checkGeometry({ source, target?, tolerance? }): Promise<GeometryCheckReport | null>` that runs a read-only topology validation pass over a source dataset's arcs and returns a structured report.

#### Scenario: Clean dataset
- **WHEN** `checkGeometry({ source })` runs on a dataset with no segment intersections
- **THEN** the resolved value is `{ ok: true, intersections: [], intersectionCount: 0 }`

#### Scenario: Self-intersecting dataset
- **WHEN** `checkGeometry({ source })` runs on a dataset with N self-intersections
- **THEN** `intersectionCount` equals N
- **AND** `intersections` is an array of `{ x, y }` objects
- **AND** `ok` is `false`

#### Scenario: Forwards tolerance to mapshaper
- **WHEN** `tolerance: 0.001` is supplied
- **THEN** `mapshaper.internal.findSegmentIntersections` is invoked with `{ tolerance: 0.001 }`

#### Scenario: Missing source returns null
- **WHEN** `source` does not resolve
- **THEN** the resolved value is `null`
- **AND** no mapshaper internal is invoked

#### Scenario: Source without dataset returns null
- **WHEN** the source's `getDataset()` returns `undefined`
- **THEN** the resolved value is `null`

#### Scenario: Unresolved target returns null
- **WHEN** `target` is supplied and does not resolve to a layer in the source
- **THEN** the resolved value is `null`

#### Scenario: Arc-less point-only datasets are vacuously clean
- **WHEN** the dataset has no `arcs` property
- **THEN** the resolved value is `{ ok: true, intersections: [], intersectionCount: 0 }`
- **AND** `mapshaper.internal.findSegmentIntersections` is NOT invoked

#### Scenario: Read-only — no history mutation
- **WHEN** `checkGeometry` resolves (with any value)
- **THEN** no `historychange` event is fired
- **AND** `Emap.canUndo()` is unchanged
- **AND** the source's `setDataset` is NOT called
