## 1. Implementation
- [x] 1.1 Extend `mapshaper.d.ts` with the `internal.exportFileContent(dataset, opts)` signature and its return shape (`Array<{ filename, content }>`).
- [x] 1.2 Add `ExportFormat` type (`'geojson' | 'topojson' | 'shapefile'`) and `ExportOptions` interface in `src/source/source.ts`.
- [x] 1.3 Implement `TopologySource.export(options)` that maps `ExportFormat` to mapshaper's format string, calls `internal.exportFileContent`, and returns a `Promise<Blob>`.
- [x] 1.4 For shapefile output, zip the multi-file payload (`.shp/.shx/.dbf/.prj`) via `fflate.zipSync` and return a single `application/zip` `Blob`.
- [x] 1.5 Add the `export` method to the `TopologySource` interface so it is part of the public contract.
- [x] 1.6 Re-export `ExportFormat` / `ExportOptions` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add unit tests in `src/source/topology-source.test.ts` (new file) that mock `internal.exportFileContent` and verify (a) the format string is forwarded correctly, (b) GeoJSON and TopoJSON return single Blobs, (c) Shapefile output is wrapped in a zip Blob containing all generated files.
- [x] 2.2 Add a manual round-trip example at `test/examples/export-roundtrip.html` that imports a file, draws a new feature with `DrawFeatureControl`, exports as GeoJSON, and downloads the result.

## 3. Validation
- [x] 3.1 Run `npm test` — all existing tests plus new export tests pass.
- [ ] 3.2 Run `openspec validate add-export-capability --strict` and resolve any issues. *(skipped — `openspec` CLI is not installed in this environment; spec format manually verified against `add-feature-attributes` reference)*
- [ ] 3.3 Manually open the round-trip example: confirm the downloaded file re-opens as a valid GeoJSON / TopoJSON / Shapefile in mapshaper CLI or QGIS and contains the new feature. *(deferred — requires browser; example HTML is in place at `test/examples/export-roundtrip.html`)*
