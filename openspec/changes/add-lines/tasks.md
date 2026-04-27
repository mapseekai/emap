## 1. Implementation
- [x] 1.1 Declare `LinesOptions { source, target, fields?, name?, noReplace? }` in `src/map/map.ts`.
- [x] 1.2 Add `Emap.linesLayer(opts): Promise<boolean>`. Validates source exists and target is a polygon layer. Builds `-target "T" -lines [F1,F2] [name="..."] [no-replace]` and delegates to `_runDatasetCommand`.
- [x] 1.3 Re-export `LinesOptions` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add an `Emap linesLayer` describe block in `src/map/map.test.ts` covering: minimal command shape, fields, name, no-replace, missing source / unresolved target / non-polygon target → false, history label `Lines <target>`.

## 3. Example
- [x] 3.1 Add `test/examples/lines.html` with target dropdown (polygons) and fields input.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass.
