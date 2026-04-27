## ADDED Requirements

### Requirement: Emap.exportSnapshot
The system SHALL provide `Emap.exportSnapshot(opts?: { compact?: boolean }): Promise<Blob>` that packs every topology source registered on the map into a single `.msx` snapshot, preserving source IDs.

#### Scenario: Packs all topology sources in registration order
- **WHEN** `exportSnapshot()` is called on a map with sources `s1`, `s2` (added in that order)
- **THEN** `mapshaper.internal.exportDatasetsToPack` is invoked with `[ds_of_s1, ds_of_s2]`
- **AND** the resulting packed object's `emap.sources` field is `[{id: 's1'}, {id: 's2'}]`

#### Scenario: Returns octet-stream Blob
- **WHEN** `exportSnapshot()` resolves
- **THEN** the resolved value is a `Blob` of MIME type `application/octet-stream`

#### Scenario: Sources without a dataset are skipped
- **WHEN** a registered source has no dataset (load not yet completed)
- **THEN** it is omitted from the snapshot
- **AND** the `emap.sources` list contains only the IDs of sources that were packed

#### Scenario: Empty map returns an empty-datasets snapshot
- **WHEN** `exportSnapshot()` is called on a map with no topology sources
- **THEN** the resulting object's `datasets` array is empty
- **AND** the `emap.sources` array is empty

### Requirement: Emap.loadSnapshot
The system SHALL provide `Emap.loadSnapshot(input: Blob | Uint8Array | ArrayBuffer, opts?: { idPrefix?: string; replace?: boolean; defaultIds?: string[] }): Promise<string[]>` that restores one or more topology sources from a `.msx` snapshot.

#### Scenario: Restores source IDs from emap metadata
- **WHEN** the snapshot's `emap.sources` field contains `[{id: 'a'}, {id: 'b'}]`
- **THEN** two `TopologySource`s are registered with IDs `a` and `b`
- **AND** the resolved value is `['a', 'b']`

#### Scenario: idPrefix prepends to every resolved ID
- **WHEN** `idPrefix: 'restored-'` is supplied
- **AND** the snapshot's `emap.sources` is `[{id: 'a'}]`
- **THEN** the registered source ID is `restored-a`

#### Scenario: Fallback to defaultIds when emap metadata is missing
- **WHEN** the snapshot has no `emap` field
- **AND** `defaultIds: ['x', 'y']` is supplied for a 2-dataset snapshot
- **THEN** the registered source IDs are `['x', 'y']`

#### Scenario: Generated fallback IDs when neither emap metadata nor defaultIds supplied
- **WHEN** the snapshot has no `emap` field and no `defaultIds`
- **THEN** the registered source IDs are `snapshot-0`, `snapshot-1`, ...

#### Scenario: replace=true removes existing same-named sources
- **WHEN** a source with ID `s1` is already registered
- **AND** `loadSnapshot(buf)` would restore a source with ID `s1`
- **THEN** the existing `s1` is removed before the restored one is added
- **AND** no error is thrown

#### Scenario: replace=false rejects on ID collision
- **WHEN** a source with ID `s1` is already registered
- **AND** `loadSnapshot(buf, { replace: false })` would restore a source with ID `s1`
- **THEN** the promise rejects without registering anything new

#### Scenario: Edit history and selection are cleared on load
- **WHEN** `loadSnapshot` succeeds
- **THEN** `Emap.canUndo()` returns `false` and `Emap.canRedo()` returns `false`
- **AND** the selection is empty

#### Scenario: Round-trip preserves source IDs and layer summaries
- **WHEN** a map has two `TopologySource`s `a` and `b`
- **AND** their snapshot is exported and immediately re-loaded into a fresh map
- **THEN** the fresh map has sources `a` and `b` with the same layer names, geometry types, and shape counts as the originals
