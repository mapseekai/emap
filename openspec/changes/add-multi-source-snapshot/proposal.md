# Change: Multi-source `.msx` snapshot — `Emap.exportSnapshot` / `loadSnapshot`

## Why
The single-source `.msx` round-trip landed in `add-snapshot` only covers one source per file. A real emap session can have **multiple sources** (e.g. base polygons + roads overlay + points-of-interest) and the user reasonably expects "save the whole map" to produce one file that restores the whole map.

mapshaper's `.msx` format already supports multiple datasets natively (`datasets: []` is an array). What's missing is:
1. An `Emap`-level pack-all-sources convenience.
2. A way to remember **which source ID each dataset belonged to** so the round-trip is fully reversible. Vanilla `.msx` doesn't carry source IDs (mapshaper is dataset-oriented, not source-oriented).

## What Changes
- Add `Emap.exportSnapshot(opts?: ExportSnapshotOptions): Promise<Blob>` packing every topology source into one `.msx` blob via `mapshaper.internal.exportDatasetsToPack`. Inject a custom `emap: { version, sources: [{ id }] }` field carrying source IDs in source-iteration order, then serialize via `mapshaper.internal.pack`.
- Add `Emap.loadSnapshot(input: Blob | Uint8Array | ArrayBuffer, opts?: LoadSnapshotOptions): Promise<string[]>`:
  - Unpack via `mapshaper.internal.unpackSessionData`.
  - For each restored dataset: derive source ID from `obj.emap.sources[i].id` if present (with optional `idPrefix`), otherwise fall back to `snapshot-<i>` (or honour a passed `defaultIds` list).
  - For each ID: instantiate a new `TopologySource`, call `setDataset`, register via `addSource`. If `replace: false` and the ID already exists, throw; default `replace: true` removes the existing source first.
  - Clear edit history and selection (the history references feature IDs that no longer exist after dataset replacement).
  - Return the list of source IDs in registration order.
- Add `ExportSnapshotOptions` and `LoadSnapshotOptions` interfaces; re-export both from `src/index.ts`.

## Impact
- Affected specs: `snapshot` (extended — new requirements added)
- Affected code:
  - `src/map/map.ts` — two new public methods + interfaces
  - `src/index.ts` — re-export
  - `src/types/mapshaper.d.ts` — declare `exportDatasetsToPack`, `pack`, `unpackSessionData`
  - `src/map/map.test.ts` — mocked unit tests + real round-trip
  - `test/examples/snapshot.html` — switch to multi-source `Emap.exportSnapshot` / `loadSnapshot`
- Backward compatible: existing single-source `TopologySource.export({format: 'msx'})` continues to work; the new API can also load files produced by it (no `emap` field → fallback to generated IDs).

## Notes
- Custom `emap` field is safe: msgpack preserves arbitrary keys, mapshaper's `unpackSessionData` only validates `obj.datasets` and uses `Object.assign` to round-trip the rest. mapshaper itself will happily load our files (just ignoring our metadata).
- `compact: true` is the default and matches the single-source path — bakes simplification, gzip-compresses arc buffers.
- `loadSnapshot` clears edit history because feature IDs in the replayed history would point to features that no longer exist. This matches the existing dataset-replace semantics (clip, dissolve, etc. already act as history barriers).
- `loadSnapshot` does **not** auto-set the viewport extent. The example HTML calls `setExtent` based on the first restored source for ergonomics.
