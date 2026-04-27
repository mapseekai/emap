## 1. Implementation
- [x] 1.1 Declare `MergeLayersOptions { source, targets, name?, force?, flatten? }` in `src/map/map.ts`.
- [x] 1.2 Add `Emap.mergeLayers(opts): Promise<boolean>`. Validates source exists, `targets.length >= 2`, all targets resolve. If their geometry types disagree and `force !== true`, return false. Builds `-target "T1,T2,..." -merge-layers [name=...] [force] [flatten]` and delegates to `_runDatasetCommand`.
- [x] 1.3 Re-export `MergeLayersOptions` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add an `Emap mergeLayers` describe block in `src/map/map.test.ts` covering: minimal command (comma-joined targets), name, force, flatten, mixed-geometry targets without force → false, mixed with force=true → ok, missing source / fewer than two targets / unresolved target → false, history label `Merge <comma-list>`.

## 3. Example
- [x] 3.1 Add `test/examples/merge-layers.html` with multi-file upload + checkbox layer picker (mirroring `union.html`).

## 4. Validation
- [x] 4.1 `npm test` — all tests pass.
