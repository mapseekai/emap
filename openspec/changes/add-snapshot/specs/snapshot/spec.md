## ADDED Requirements

### Requirement: TopologySource snapshot export
The system SHALL allow `TopologySource.export({ format: 'msx' })` to serialize the current dataset to mapshaper's `.msx` (msgpack package) snapshot format, preserving topology, simplification thresholds, layer metadata, and CRS.

#### Scenario: msx is a supported export format
- **WHEN** `source.export({ format: 'msx' })` is called on a source with a dataset
- **THEN** the promise resolves with a `Blob` of MIME type `application/octet-stream`

#### Scenario: msx export delegates to mapshaper's pack pipeline
- **WHEN** `format: 'msx'` is requested
- **THEN** `mapshaper.internal.exportPackedDatasets` is invoked with `[dataset]` and `{ compact: true }`
- **AND** `mapshaper.internal.exportFileContent` is NOT invoked

#### Scenario: msx export with no dataset rejects
- **WHEN** `export({ format: 'msx' })` is called on a source whose dataset has not yet been set
- **THEN** the promise rejects with the same "TopologySource has no dataset to export" error already used for other formats

### Requirement: TopologySource snapshot import
The system SHALL accept `.msx` snapshot files via the existing `TopologySource.setData()` path, restoring the saved dataset (layers + arcs + info) into the source.

#### Scenario: msx extension is recognized when loading by URL
- **WHEN** `setData(urlString)` resolves to a response whose URL ends in `.msx`
- **THEN** the filename is preserved (no `.json` fallback) so mapshaper detects it as a package file

#### Scenario: Round-trip preserves layers and arcs
- **WHEN** a dataset is exported with `format: 'msx'` and the bytes are re-imported via `setData({ filename: 'x.msx', content: bytes })`
- **THEN** the restored dataset has the same layer names, the same per-layer geometry types, the same shape counts, and the same arc count as the original
