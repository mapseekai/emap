## ADDED Requirements

### Requirement: Export source dataset to a file blob
The system SHALL provide `TopologySource.export(options)` that serializes the current in-memory dataset to a browser `Blob` using mapshaper's export pipeline.

#### Scenario: Export to GeoJSON
- **WHEN** a caller invokes `source.export({ format: 'geojson' })`
- **THEN** the system returns a `Promise<Blob>` whose contents are a valid GeoJSON FeatureCollection produced by mapshaper's exporter
- **AND** the dataset's vertices, attributes, and CRS metadata are preserved

#### Scenario: Export to TopoJSON
- **WHEN** a caller invokes `source.export({ format: 'topojson' })`
- **THEN** the system returns a `Promise<Blob>` whose contents are a valid TopoJSON document with all source layers represented as objects

#### Scenario: Export to Shapefile
- **WHEN** a caller invokes `source.export({ format: 'shapefile' })`
- **THEN** the system returns a `Promise<Blob>` of MIME type `application/zip` containing the `.shp`, `.shx`, `.dbf`, and (when CRS is known) `.prj` files produced by mapshaper

### Requirement: Preserve render LOD state across export
The export operation SHALL NOT alter the on-screen rendering state of the source.

#### Scenario: LOD interval is restored after export
- **WHEN** the source has an active retained simplification interval set by DisplayArcs
- **THEN** the export emits full-detail geometry
- **AND** the source's retained interval is restored to its prior value before `export()` resolves

### Requirement: Export operations are additive and non-destructive
The export operation SHALL NOT mutate the underlying dataset, layers, arcs, or attribute records.

#### Scenario: Repeated export produces equivalent output
- **WHEN** the caller invokes `export({ format: 'geojson' })` twice in succession with no intervening edits
- **THEN** the two returned `Blob`s have identical byte content

### Requirement: Export surface is part of the TopologySource interface
The `export` method SHALL be declared on the `TopologySource` interface so that consumers can call it without type assertions.

#### Scenario: Type-safe export call
- **WHEN** a TypeScript consumer holds a `TopologySource` reference
- **THEN** calling `source.export({ format: 'geojson' })` typechecks without `as any` casts
- **AND** the return type is `Promise<Blob>`
