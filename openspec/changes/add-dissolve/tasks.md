## 1. Implementation
- [x] 1.1 Declare `DissolveOptions { source, target, field? }` in `src/map/map.ts`.
- [x] 1.2 Add `Emap.dissolveLayer(opts: DissolveOptions): Promise<boolean>`. Validates source and target via the same path as `clipLayer` / `eraseLayer`. Builds the command `-target "X" -dissolve` (no field) or `-target "X" -dissolve "FIELD"` (with field), then delegates to `_runDatasetCommand`.
- [x] 1.3 Re-export `DissolveOptions` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add integration tests to `src/map/map.test.ts` (`Emap dissolveLayer` describe block) that verify:
  - whole-layer dissolve emits `-target "X" -dissolve` (no field arg)
  - field dissolve emits `-target "X" -dissolve "FIELD"` (positional, quoted)
  - missing source / target returns `false` and pushes nothing
  - successful dissolve replaces the dataset, pushes one history entry labelled `Dissolve <target>`, clears the selection, and clears prior history (history barrier inherited from `_runDatasetCommand`).

## 3. Example
- [x] 3.1 Add `test/examples/dissolve.html`: load a polygon GeoJSON, pick a target layer + optional dissolve field (populated from the layer's data table), click "Dissolve". Reuses `HistoryControl` for undo.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass. *(134 / 134 across 12 files.)*
