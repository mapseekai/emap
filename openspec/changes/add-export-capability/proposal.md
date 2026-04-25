# Change: Add data export capability

## Why
emap can load GeoJSON / TopoJSON / Shapefile and edit them interactively, but there is no way to get the edited data back out. Without an export path the engine is "view + mutate in memory" — edits never reach disk. This is the single largest blocker to closing the editing loop, and it is independent of every other planned editor feature (Undo/Redo, Selection, geometry ops).

## What Changes
- Add an `export(options)` method to `TopologySource` that serializes the current dataset using mapshaper's `internal.exportFileContent` pipeline.
- Support three output formats matching the supported import formats: GeoJSON, TopoJSON, and Shapefile (zipped).
- Return a browser-friendly `Blob` for single-file formats and a single zipped `Blob` for Shapefile (the multi-file `.shp/.shx/.dbf/.prj` family is packed via `fflate`).
- Expose the new method on the `TopologySource` interface so consumers do not need `as any` casts.
- Add a manual test example (`test/examples/export-roundtrip.html`) that loads a file, triggers an edit, exports, and offers the result as a download.

## Impact
- Affected specs: `data-export` (new capability)
- Affected code: `src/source/topology-source.ts`, `src/source/source.ts`, `src/types/mapshaper.d.ts`, `test/examples/`
- No existing API breaks; the change is purely additive.
