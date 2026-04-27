## Context
emap is positioned as a topology editing engine on top of mapshaper. Today it can import (GeoJSON / TopoJSON / zipped Shapefile) and mutate the in-memory dataset (vertex editing, drawing), but there is no way to serialize the dataset back out. This proposal adds the missing export side so the editing loop closes without round-tripping through a server.

## Goals / Non-Goals
- Goals
  - One method, `source.export(opts)`, returning a `Blob` ready for `URL.createObjectURL` or upload.
  - Reuse mapshaper's own export pipeline (`internal.exportFileContent`) so output bytes match the mapshaper CLI exactly.
  - Cover the same format set emap can already import: GeoJSON, TopoJSON, Shapefile (zipped).
  - Browser-only: no Node `Buffer`, no filesystem.
- Non-Goals
  - New formats not currently importable (FlatGeobuf, GeoPackage, KML, CSV, SVG).
  - Streaming / chunked export. Datasets fit in memory by design (same as the rest of emap).
  - Server-side helpers, file pickers, or auto-download UI — those belong in user code.
  - Per-layer subset export. v1 exports the whole dataset as mapshaper would.

## Decisions

- **Decision: Wrap `internal.exportFileContent`, do not call `applyCommands('-o ...')`.**
  - Rationale: `exportFileContent` already returns the raw `[{ filename, content }, ...]` array we need. `applyCommands` would re-parse a CLI string and fork a Job, which is heavier and harder to type. Mapshaper's own `mapshaper -o` command path uses `exportFileContent` internally, so we are using the same code path one level lower.

- **Decision: Map `ExportFormat` → mapshaper format string in one place.**
  - `'geojson' → 'geojson'`, `'topojson' → 'topojson'`, `'shapefile' → 'shapefile'`. The user-facing string is the union, the mapshaper string is the implementation detail.

- **Decision: Return `Blob`, not `Uint8Array` or `string`.**
  - Rationale: `Blob` is the natural browser primitive: works with `URL.createObjectURL`, `fetch` upload bodies, and `FormData`. Single return type across formats keeps the API symmetrical even though shapefile is multi-file under the hood.

- **Decision: For shapefile, zip the file family with `fflate`.**
  - Rationale: emap already depends on `fflate` for zip _import_. Returning a zip is the only way to give callers a single `Blob` that QGIS / mapshaper / ArcGIS will accept on open. The zip contains `.shp`, `.shx`, `.dbf`, optionally `.prj` and `.cpg`.

- **Decision: Export operates on the live dataset, no copy.**
  - Rationale: `exportFileContent` reads the dataset; it does not mutate it. Copying would double memory for no benefit.

- **Decision: Reset retained interval to `0` (full detail) before export.**
  - Rationale: mapshaper's exporters look at `arcs.getRetainedInterval()` and will _materialize_ the simplified version if it is set. emap uses simplification only for rendering LOD; exports should be full-detail. Restore the interval after export so on-screen LOD is unaffected.

## Risks / Trade-offs

- **Risk: mapshaper internal API drift.** `internal.exportFileContent` is not part of mapshaper's public API.
  - Mitigation: same as for every other `internal.*` use in emap — typed in `mapshaper.d.ts`, verified on dependency upgrades. The signature is stable across 0.6.x and 0.7.x (verified in mapshaper repo at `src/io/mapshaper-export.mjs`).
- **Risk: large datasets produce large `Blob`s, can run into the 2GB browser limit.**
  - Mitigation: mention the in-memory constraint in JSDoc; do not pretend to support arbitrary sizes. Same constraint applies to import.
- **Trade-off: no per-layer or per-feature export in v1.**
  - Acceptable: callers can splice `dataset.layers` and clone before calling `export` if they need a subset; or wait for the selection-model proposal that comes next.

## Migration Plan
None. The API is additive. No existing behaviour changes.

## Open Questions
- Should `ExportOptions` accept a mapshaper-style `precision` to match `-o precision=0.00001`? Defer to v2 unless a user asks; keep v1 surface minimal.
- Should shapefile export auto-emit a `.prj` derived from `dataset.info.crs`? Mapshaper's exporter already does this when CRS info is present, so we get it for free — no extra work in v1.
