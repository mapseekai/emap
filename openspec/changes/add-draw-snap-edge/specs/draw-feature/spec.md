## ADDED Requirements

### Requirement: DrawFeatureControl edge snap
The `DrawFeatureControl` SHALL snap the cursor to the closest point on any arc segment of any snap source whose perpendicular pixel distance is below `snapThreshold`, in addition to the existing vertex snap.

#### Scenario: Cursor near segment midpoint snaps to segment
- **WHEN** the user is drawing and moves the cursor close (within `snapThreshold` pixels) to the midpoint of an existing segment
- **THEN** the resulting `EditDrawState.snapCoord` is the closest point on that segment in map coordinates
- **AND** `EditDrawState.snapKind` is `'edge'`

#### Scenario: Edge candidate beyond segment endpoints does not snap
- **WHEN** the cursor's perpendicular projection onto an extended segment would fall past either endpoint (parameter `t` outside `[0, 1]`)
- **AND** the closer endpoint is itself farther than `snapThreshold`
- **THEN** the segment is NOT a valid snap target

#### Scenario: Vertex preferred over edge at equal distance
- **WHEN** the cursor is exactly on a vertex shared by two segments
- **THEN** `snapKind` is `'vertex'` (not `'edge'`)

#### Scenario: snapToEdge: false disables edge snap
- **WHEN** `snapToEdge` is set to `false`
- **THEN** segments are not tested
- **AND** only vertex snaps are returned (existing behaviour)

#### Scenario: snapToVertex: false disables vertex snap
- **WHEN** `snapToVertex` is set to `false`
- **THEN** existing vertices are not tested
- **AND** only edge snaps are returned

### Requirement: DrawFeatureControl multi-source snap
The `DrawFeatureControl` SHALL accept a `snapSources` option listing source IDs to snap against. Defaults to `[options.source]` (the source being drawn into) so the existing default behaviour is unchanged.

#### Scenario: Default snaps only to draw source
- **WHEN** `snapSources` is not specified
- **THEN** snap targets come ONLY from the source named by `options.source`

#### Scenario: Multi-source snap iterates each listed source
- **WHEN** `snapSources: ['a', 'b']` and the cursor is near a vertex of source `b`
- **THEN** the snap result reflects source `b`'s vertex (not just `a`)

#### Scenario: Unknown source IDs are skipped silently
- **WHEN** `snapSources` contains an id not registered on the map
- **THEN** that entry is skipped without throwing
- **AND** snap behaves as if it weren't in the list

### Requirement: EditDrawState exposes snap kind
`EditDrawState` SHALL include a `snapKind: 'vertex' | 'edge' | null` field reflecting the type of the current snap target. The renderer uses this to draw a different glyph for each kind.

#### Scenario: No snap → snapKind null
- **WHEN** the cursor isn't near any snap target
- **THEN** `snapKind` is `null`
- **AND** `snapCoord` is `null`

#### Scenario: Vertex snap → snapKind 'vertex'
- **WHEN** the snap target is an existing vertex (or an in-progress drawing vertex)
- **THEN** `snapKind` is `'vertex'`

#### Scenario: Edge snap → snapKind 'edge'
- **WHEN** the snap target is the closest point on a segment
- **THEN** `snapKind` is `'edge'`
