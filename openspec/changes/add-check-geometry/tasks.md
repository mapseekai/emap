## 1. Implementation
- [x] 1.1 Declare `CheckGeometryOptions { source; target?; tolerance? }` and `GeometryCheckReport { ok; intersections; intersectionCount }` in `src/map/map.ts`. `intersections` is `Array<{ x: number; y: number }>`.
- [x] 1.2 Add `Emap.checkGeometry(opts): Promise<GeometryCheckReport | null>`. Validates source resolves (returns `null` if not), `target` resolves when supplied. Returns the empty/clean report for arc-less datasets. Otherwise calls `mapshaper.internal.findSegmentIntersections(arcs, { tolerance })` and maps each result's `x`/`y` to `{ x, y }`. `ok` = `intersectionCount === 0`.
- [x] 1.3 Re-export `CheckGeometryOptions` and `GeometryCheckReport` from `src/index.ts`.
- [x] 1.4 Declare `internal.findSegmentIntersections(arcs, opts?) => Array<{ x: number; y: number }>` in `src/types/mapshaper.d.ts`.

## 2. Testing
- [x] 2.1 Mocked unit tests in `src/map/map.test.ts`:
  - Calls `findSegmentIntersections` with the source's arcs and the forwarded tolerance.
  - Returns the mapped `{ x, y }` array.
  - Returns `null` for missing source / unresolved target.
  - Returns `{ ok: true, intersections: [], intersectionCount: 0 }` for arc-less datasets and never calls the mapshaper internal.
  - Does NOT push history (call counts on history listener stay zero).
- [x] 2.2 Real-mapshaper round-trip:
  - Build a tiny GeoJSON with a known self-intersection (a "bowtie" polygon).
  - Assert `intersectionCount > 0` and `ok === false`.
  - Build a clean dataset and assert `ok === true`.

## 3. Example
- [x] 3.1 `test/examples/check-geometry.html` — load data, click "检查几何", show `ok` / count / first 10 intersection points; "重建拓扑" shortcut linking to `rebuildTopology`.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass.
