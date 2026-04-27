## 1. Implementation
- [x] 1.1 Declare `ExplodeOptions { source, target }` in `src/map/map.ts`.
- [x] 1.2 Add `Emap.explodeLayer(opts: ExplodeOptions): Promise<boolean>`. Validates source / target via the same path as `clipLayer`. Builds `-target "<X>" -explode` and delegates to `_runDatasetCommand`.
- [x] 1.3 Re-export `ExplodeOptions` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add an `Emap explodeLayer` describe block in `src/map/map.test.ts` covering: command-string emission, missing source / target no-op, label `Explode <target>`, history-barrier inheritance.

## 3. Example
- [x] 3.1 Add `test/examples/explode.html`: load a multi-part dataset, pick a target layer, click "Explode".

## 4. Validation
- [x] 4.1 `npm test` — all tests pass. *(205 / 205 across 17 files.)*
