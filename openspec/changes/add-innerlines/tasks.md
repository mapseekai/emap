## 1. Implementation
- [x] 1.1 Declare `InnerlinesOptions { source, target, where?, name?, noReplace? }` in `src/map/map.ts`.
- [x] 1.2 Add `Emap.innerlinesLayer(opts: InnerlinesOptions): Promise<boolean>`. Validates source / target. Builds `-target "<X>" -innerlines [where="..."] [name="..."] [no-replace]` (string args quoted via `quoteMapshaperArg`) and delegates to `_runDatasetCommand`.
- [x] 1.3 Re-export `InnerlinesOptions` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add an `Emap innerlinesLayer` describe block in `src/map/map.test.ts` covering: minimal command emission, `where` quoted, `name` quoted, `noReplace` flag append, full-options deterministic order, missing source / target no-op, history label `Innerlines <target>`.

## 3. Example
- [x] 3.1 Add `test/examples/innerlines.html`: load a polygon dataset, click "Innerlines", optionally enter a `where` expression.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass. *(212 / 212 across 17 files.)*
