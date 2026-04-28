# Change: Add `.msx` snapshot save / restore (mapshaper session format)

## Why
GeoJSON / TopoJSON / Shapefile each lose information when round-tripping a working dataset:
- **Simplification thresholds** (`zz` arrays) are flattened or dropped.
- **Multiple layers sharing arcs** become independent geometry, breaking topology.
- **CRS** beyond what the format encodes is lost.
- **Per-layer `menu_order` / `pinned` / `active`** state isn't expressible.

mapshaper's own `.msx` package format (msgpack-encoded, optionally gzipped) preserves all of this — it's the canonical "save the session, reopen later" file. With `clipLayer` / `dissolveLayer` / `unionLayers` / etc. landed, users edit data over many steps; losing topology on save is a real workflow break.

## What Changes
- Add `'msx'` to `ExportFormat` in `src/source/source.ts`.
- In `TopologySource.export()`, route `format: 'msx'` through `mapshaper.internal.exportPackedDatasets([dataset], { compact: true })` instead of `exportFileContent` (mapshaper itself special-cases msx; `exportFileContent` does not handle it).
- Add `application/octet-stream` MIME for `'msx'` in the export MIME map.
- Add `.msx` to `_hasSupportedExtension` so URL-based loads pick the extension up.
- Existing `setData()` path needs no change: mapshaper's `-i` already detects `.msx` via `guessInputFileType` and routes to `importMshpFile` → `unpackSessionData`.
- Add `test/examples/snapshot.html` with a "保存快照 (.msx)" button + a file input that accepts `.msx`.

## Impact
- Affected specs: `snapshot` (new capability)
- Affected code:
  - `src/source/source.ts` — extend `ExportFormat`
  - `src/source/topology-source.ts` — special-case msx in `export()`, extend `_hasSupportedExtension`, extend MIME map
  - `src/types/mapshaper.d.ts` — declare `internal.exportPackedDatasets`
  - `src/source/topology-source.test.ts` — add tests (mocked dispatch + real round-trip)
  - `test/examples/snapshot.html` — new example
- No new public methods on `Emap` itself — the round-trip rides on the existing source-level export/setData API, mirroring how GeoJSON / TopoJSON / Shapefile already work.

## Notes
- `compact: true` matches mapshaper CLI's default for the final on-disk file: bakes simplification into `zz` (only retained values are kept) and gzip-compresses the typed-array buffers. This is the right default for "save and reload"; users wanting a pre-simplification snapshot can still call `setData()` with the original source first.
- `.msx` is binary (msgpack); the export blob uses `application/octet-stream`. Browser downloads will retain the `.msx` extension.
- The format covers a single source (one `Datasets[]` entry per source's dataset). Multi-source workspace snapshots are out of scope for v1; users with multiple sources can save each to a separate `.msx`.
- mapshaper's snapshot also stores GUI state (`gui: {}`); we don't write or read this — purely the topology/layer payload.
