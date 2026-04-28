## 1. Implementation
- [x] 1.1 Extend `ExportFormat` to `'geojson' | 'topojson' | 'shapefile' | 'msx'` in `src/source/source.ts`.
- [x] 1.2 In `src/source/topology-source.ts`:
  - Add `'msx'` to `EXPORT_MIME` (`application/octet-stream`).
  - In `export()`, when `format === 'msx'`, await `mapshaper.internal.exportPackedDatasets([dataset], { compact: true })` and pass the resulting `[{ filename, content }]` array to `_filesToBlob` (which already handles binary content via `toBlobPart`).
  - Extend `_hasSupportedExtension` regex to include `msx`.
- [x] 1.3 In `src/types/mapshaper.d.ts`, declare `internal.exportPackedDatasets(datasets, opts) => Promise<Array<{ filename: string; content: Uint8Array }>>`.

## 2. Testing
- [x] 2.1 Add `TopologySource.export({format: 'msx'})` unit test mocking `internal.exportPackedDatasets` — assert call args (`[dataset]`, `{ compact: true }`) and that the returned Blob is `application/octet-stream`.
- [x] 2.2 Add a real-mapshaper round-trip test: build a tiny in-memory dataset, call `export({format: 'msx'})`, feed the bytes back via `setData({ filename: 'x.msx', content: ... })`, assert layer names / shapes / arc counts match.
- [x] 2.3 Existing GeoJSON / TopoJSON / Shapefile export tests should continue to pass (regression check on the format switch).

## 3. Example
- [x] 3.1 Add `test/examples/snapshot.html` — load any supported file, "保存快照 (.msx)" downloads the binary, "加载快照 (.msx)" restores it via the existing setData path.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass.
