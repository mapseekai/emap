## 1. Implementation
- [x] 1.1 Declare `MosaicOptions { source, target, snapInterval?, noSnap?, noReplace?, name? }` in `src/map/map.ts`.
- [x] 1.2 Add `Emap.mosaicLayer(opts): Promise<boolean>`. Validates source / target. Builds `-target "<X>" -mosaic [snap-interval=N] [no-snap] [no-replace] [name="N"]` and delegates to `_runDatasetCommand`.
- [x] 1.3 Re-export `MosaicOptions` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add an `Emap mosaicLayer` describe block in `src/map/map.test.ts` covering: bare command, snapInterval, noSnap, noReplace, name combinations, missing source / target no-op, history label `Mosaic <target>`.

## 3. Example
- [x] 3.1 Add `test/examples/mosaic.html`.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass.
