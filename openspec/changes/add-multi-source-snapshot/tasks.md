## 1. Implementation
- [x] 1.1 Declare `ExportSnapshotOptions { compact?: boolean }` and `LoadSnapshotOptions { idPrefix?: string; replace?: boolean; defaultIds?: string[] }` in `src/map/map.ts`.
- [x] 1.2 Add `Emap.exportSnapshot(opts?): Promise<Blob>`. Iterates `_sources` in insertion order, filters to topology sources with a dataset, calls `mapshaper.internal.exportDatasetsToPack` to get the unpacked obj, injects `obj.emap = { version: 1, sources: [{id}] }`, calls `mapshaper.internal.pack` to serialize, returns `Blob` of `application/octet-stream`.
- [x] 1.3 Add `Emap.loadSnapshot(input, opts?): Promise<string[]>`. Coerces input to `Uint8Array`, calls `mapshaper.internal.unpackSessionData`, derives source IDs from `obj.emap?.sources` (with optional `idPrefix`), falls back to `defaultIds` then to `snapshot-<i>`. For each: rejects-or-replaces existing same-named source per `replace`, instantiates `TopologySource`, calls `setDataset`, calls `addSource`. Clears history and selection. Returns the list of registered IDs.
- [x] 1.4 Re-export `ExportSnapshotOptions` and `LoadSnapshotOptions` from `src/index.ts`.
- [x] 1.5 In `src/types/mapshaper.d.ts`, declare `exportDatasetsToPack`, `pack`, `unpackSessionData`.

## 2. Testing
- [x] 2.1 Mocked unit tests in `src/map/map.test.ts`:
  - `exportSnapshot` calls `exportDatasetsToPack` with all topology source datasets and a final `pack` of the result.
  - The packed object includes `emap: { version: 1, sources: [{id}, ...] }` in source-iteration order.
  - `exportSnapshot` returns `application/octet-stream` Blob.
  - `loadSnapshot` calls `unpackSessionData`, registers a `TopologySource` per restored dataset using stored IDs.
  - With no `emap` metadata: falls back to `snapshot-<i>` IDs.
  - With `idPrefix`: prefixes both stored IDs and fallback IDs.
  - With `defaultIds`: uses them in absence of stored IDs.
  - With `replace: false` and an existing ID: rejects; `replace: true` (default) removes the existing source first.
  - `loadSnapshot` clears edit history and selection.
- [x] 2.2 Real-mapshaper round-trip in `src/map/map.test.ts`:
  - Build two real `TopologySource`s from tiny GeoJSONs, `addSource` both, `exportSnapshot`, `removeSource` both, `loadSnapshot`, assert two sources back with original IDs and matching layer summaries.

## 3. Example
- [x] 3.1 Update `test/examples/snapshot.html` to register a configurable number of sources, expose a "保存全部源 (.msx)" button using `Emap.exportSnapshot`, and use `Emap.loadSnapshot` for restoration. Show the restored source IDs.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass.
