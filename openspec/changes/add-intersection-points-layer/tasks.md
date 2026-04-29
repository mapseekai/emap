## 1. Type stubs
- [x] 1.1 In `src/types/mapshaper.d.ts`, add `internal.getIntersectionLayer(intersections, lyr, arcs): { geometry_type: 'point'; shapes: number[][][] }`.

## 2. API
- [x] 2.1 Declare `IntersectionPointsLayerOptions { source, target, name?, tolerance? }` in `src/map/map.ts`. Re-export from `src/index.ts`.
- [x] 2.2 Implement `Emap.intersectionPointsLayer(opts)`:
  - Validate source / target resolution + target geometry type ∈ `{polygon, polyline}`.
  - Validate `name` doesn't collide with another layer in the same dataset.
  - Validate `tolerance` (when supplied) is positive finite.
  - Build the new point layer in a custom path (not via `_runDatasetCommand` — this isn't a CLI wrap):
    - Snapshot dataset via `mapshaper.internal.copyDataset`.
    - Compute `findSegmentIntersections(working.arcs, { tolerance })`.
    - Compute `getIntersectionLayer(intersections, targetLayerInWorking, working.arcs)`.
    - Set `pointLyr.name = opts.name ?? '${target}-intersections'`.
    - `working.layers.push(pointLyr)`.
    - `source.setDataset(working)` and push DatasetReplaceCommand for undo.
  - Return `true` on success, `false` on validation failure, fire `error` event on internal throw.

## 3. Tests
- [x] 3.1 In `src/map/map.test.ts`:
  - Mocked: validates the source-resolution / target-resolution / target-geometry / name-collision / tolerance branches.
  - Real mapshaper round-trip: load a small dataset with crossing polylines, call `intersectionPointsLayer`, assert a new layer was added and contains at least one point.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass.
