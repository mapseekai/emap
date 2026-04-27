## 1. Implementation
- [x] 1.1 Declare `SnapOptions { source, target, interval?, endpoints?, precision? }` in `src/map/map.ts`. `interval` and `precision` accept `number`.
- [x] 1.2 Add `Emap.snapLayer(opts: SnapOptions): Promise<boolean>`. Validates source / target. Builds `-target "<X>" -snap [<INTERVAL>] [endpoints] [precision=<N>]` and delegates to `_runDatasetCommand`.
- [x] 1.3 Re-export `SnapOptions` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add an `Emap snapLayer` describe block in `src/map/map.test.ts` covering: bare `-snap`, with interval, with endpoints flag, with precision, all-options together (deterministic order), missing source / target no-op, history label `Snap <target>`.

## 3. Example
- [x] 3.1 Add `test/examples/snap.html`: load a dataset, optional interval / precision inputs, click "Snap".

## 4. Validation
- [x] 4.1 `npm test` — all tests pass. *(226 / 226 across 17 files.)*
