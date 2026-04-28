## ADDED Requirements

### Requirement: Bounded ZIP extraction in TopologySource
`TopologySource._extractZip` SHALL enforce a configurable upper bound on uncompressed total bytes, entry count, and compression ratio. When any limit is exceeded, extraction SHALL fail fast with a thrown error (which the existing import path converts into a `fire('error', { error })` event), and the dataset SHALL NOT be updated.

#### Scenario: Default limits permit ordinary shapefile zips
- **WHEN** a 50 MB zip with 6 entries (typical shapefile bundle) is loaded with no `zipLimits` option
- **THEN** extraction succeeds and the source fires `data`

#### Scenario: maxEntries breach
- **WHEN** a zip contains 6000 entries and `maxEntries` defaults to 5000
- **THEN** `_extractZip` throws an error mentioning the entry-count limit
- **AND** `source.fire('error', ...)` is the terminal event for that import; no `data` event is fired

#### Scenario: maxBytes breach
- **WHEN** the running uncompressed total exceeds `maxBytes` while walking entries
- **THEN** extraction throws and `data` is not fired

#### Scenario: maxRatio breach (zip bomb shape)
- **WHEN** uncompressed total / compressed input exceeds `maxRatio`
- **THEN** extraction throws and `data` is not fired

#### Scenario: User-supplied limits override defaults
- **WHEN** `new TopologySource(id, { zipLimits: { maxBytes: 10 } })` is constructed
- **AND** any 11-byte-or-larger zip payload is passed to `setData`
- **THEN** extraction throws on the first entry whose content pushes the total past 10 bytes

### Requirement: setData last-write-wins via version + AbortController
`TopologySource` SHALL serialize concurrent `setData` calls so that only the most recent call's outcome is observable on `data` / `error`. In-flight URL fetches from superseded calls SHALL be aborted.

#### Scenario: Two rapid setData — only the latest fires data
- **WHEN** `setData(a)` is called (slow path), then `setData(b)` is called before `a` resolves
- **THEN** only `b` fires `data`
- **AND** `getDataset()` returns `b`'s dataset

#### Scenario: Stale chain swallows its own error
- **WHEN** `setData(a)` is called against a URL that will reject
- **AND** `setData(b)` is called before `a`'s fetch settles
- **THEN** `a`'s rejection does NOT fire `error` (it was superseded)
- **AND** `b`'s outcome is the one observed

#### Scenario: URL fetch is aborted on supersede
- **WHEN** `setData('url-a')` starts a fetch
- **AND** `setData('url-b')` is called immediately
- **THEN** the underlying `AbortSignal` for the first fetch is aborted

#### Scenario: Empty array input is a terminal error
- **WHEN** `setData([])` is called
- **THEN** the source fires `dataloading` followed by `error` (not `data`)
- **AND** no dataset replacement happens
