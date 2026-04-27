## 1. Command + matrix helpers
- [x] 1.1 Create `src/edit/commands/feature-affine.ts` with: `AffineMatrix` interface, `rotateMatrix`, `scaleMatrix`, `invertMatrix` helpers, and `FeatureAffineCommand` class.
- [x] 1.2 `FeatureAffineCommand.do()` applies the forward matrix to xx/yy of every listed arc (calling `arcs.updateArcBounds(arcId)` per arc) and to every listed point feature's coords; `undo()` does the same with `invertMatrix(matrix)`. Calls `source.refreshDisplayArcs()` once per pass.
- [x] 1.3 Re-export `FeatureAffineCommand`, `AffineMatrix`, `rotateMatrix`, `scaleMatrix`, `invertMatrix` from `src/index.ts`.

## 2. Emap public methods
- [x] 2.1 Add `Emap.rotateSelected(angleDegrees, origin?): boolean`. Returns `false` for empty selection or `angleDegrees === 0`. Default origin = bbox centroid of all affected vertices.
- [x] 2.2 Add `Emap.scaleSelected(sx, sy?, origin?): boolean`. Returns `false` for empty selection or `sx === 1 && (sy ?? sx) === 1`. Default origin = bbox centroid. `sy` defaults to `sx` (uniform scale).
- [x] 2.3 Both methods share a private `_applyAffineToSelection` helper that mirrors `translateSelected`'s selection-walking (group by source, dedupe arc ids, collect point features). Builds one `FeatureAffineCommand` per source, wraps in `CompositeCommand` for multi-source. Selection survives.

## 3. Tests
- [x] 3.1 Add `src/edit/commands/feature-affine.test.ts` covering: rotate-90 / scale-around-pivot / non-uniform scale matrix correctness; `invertMatrix` round-trip on translate and rotate; matrix application to arcs and to point shapes; do/undo round-trip bit-equal for non-trivial rotation; `updateArcBounds` / `refreshDisplayArcs` call counts; label.
- [x] 3.2 Add `Emap rotateSelected` / `Emap scaleSelected` describe blocks in `src/map/map.test.ts` covering: empty / no-op early-return, bbox-centroid default origin keeps centre fixed under 90° rotation, custom origin honoured, single-undo round-trip, selection survives, single historychange per call, multi-source CompositeCommand wrapping.

## 4. Example
- [x] 4.1 Add `test/examples/feature-rotate-scale.html`. Click features to select, arrow keys to translate, `[` / `]` to rotate ±5°, `+` / `-` to scale 1.1× / 0.9× (`Shift` for finer steps). `HistoryControl` for undo.

## 5. Validation
- [x] 5.1 `npm test` — all tests pass. *(251 / 251 across 18 files.)*
