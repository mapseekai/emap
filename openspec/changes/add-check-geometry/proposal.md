# Change: Add `checkGeometry` — read-only topology validation report

## Why
After a series of edits or imports of dubious-quality source data, "is this dataset clean?" is a question with no current answer in emap. Users either:
- Run `cleanLayer` blind (heavy and destructive even when nothing was wrong), or
- Try a downstream operation and watch it crash on an opaque mapshaper error.

mapshaper has `-check-geometry` for exactly this — a read-only sweep that reports topology problems without mutating data. emap should expose it as a structured report so UIs can show "found N self-intersections; consider running rebuildTopology".

## What Changes
- Add `Emap.checkGeometry({ source, target?, tolerance? }): Promise<GeometryCheckReport | null>` in `src/map/map.ts`.
- The implementation calls `mapshaper.internal.findSegmentIntersections` directly (skipping `parseCommands` / `runParsedCommands`) to get a structured intersection list back. mapshaper's `cmd.checkGeometry` itself only logs a count message; the lower-level primitive is what's actually useful.
- Returns `null` for unresolvable source / target (consistent with "cannot run").
- Returns `{ ok: true, intersections: [], intersectionCount: 0 }` for arc-less point-only datasets (vacuously valid) and for clean datasets.
- Read-only: does NOT push history, does NOT clear selection, does NOT swap the dataset. Cheap to call repeatedly.
- Add `GeometryCheckReport` and `CheckGeometryOptions` types; re-export from `src/index.ts`.
- Declare `findSegmentIntersections` in `src/types/mapshaper.d.ts`.
- Add `test/examples/check-geometry.html` — load data, click "检查", show count + first 10 intersection points.

## Impact
- Affected specs: `check-geometry` (new capability)
- Affected code:
  - `src/map/map.ts` — new public method, two new types
  - `src/map/map.test.ts` — new describe block (mocked + real-mapshaper round-trip with a known-bad dataset)
  - `src/index.ts` — re-exports
  - `src/types/mapshaper.d.ts` — declare `findSegmentIntersections`
  - `test/examples/check-geometry.html`
- No new infrastructure. Read-only — bypasses the dataset-replace runner entirely.

## Notes
- v1 reports only segment intersections (which is what mapshaper's `cmd.checkGeometry` does today). The report shape leaves room for future additions (`emptyShapes`, `dangles`, `slivers`) without breaking callers.
- `tolerance` is forwarded to `findSegmentIntersections.tolerance`; when omitted, mapshaper auto-derives a small bounds-relative epsilon.
- The `target` parameter exists for API symmetry with other commands; v1 always runs against the whole dataset's arcs (mapshaper's `findSegmentIntersections` is arcs-level, not layer-scoped). The `target` is validated for resolvability but doesn't yet narrow the scan. A future change can implement layer-scoped intersection filtering by walking only the target layer's arc ids.
- Returns `null` on missing source/dataset (rather than `false`) because the caller is expecting a structured report; `null` is the unambiguous "couldn't run" signal.
