## ADDED Requirements
### Requirement: Query rendered features by pixel geometry
The system SHALL expose `Emap.queryRenderedFeatures(geometryOrOptions?, options?)` that accepts a pixel-space point or bounding box and returns an array of matching feature attribute records.

#### Scenario: Query features at a point
- **WHEN** the caller passes a single pixel point
- **THEN** the system returns attribute records for features hit at that point

#### Scenario: Query features within a bounding box
- **WHEN** the caller passes a pixel-space bounding box
- **THEN** the system returns attribute records for features intersecting the box

#### Scenario: Query with options-only signature
- **WHEN** the caller passes an options object as the first argument
- **THEN** the system queries the full viewport extent

### Requirement: Filter by layer
The system SHALL allow the query to restrict results to a list of layer identifiers.

#### Scenario: Only specified layers are returned
- **WHEN** the caller provides a `layers` list
- **THEN** results include only features from those layers

### Requirement: Highlight matched features
The system SHALL provide an API to highlight queried features using their returned identifiers.

#### Scenario: Highlight after querying
- **WHEN** the caller passes query results to the highlight API
- **THEN** the corresponding features are visually highlighted on the map
