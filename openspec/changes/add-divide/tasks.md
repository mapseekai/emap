## 1. Implementation
- [x] 1.1 Declare `DivideOptions { source, target, divider, fields?, force? }` in `src/map/map.ts`.
- [x] 1.2 Add `Emap.divideLayer(opts): Promise<boolean>`. Validates source exists, `target` is a polyline layer, `divider` is a polygon layer (both in the same source). Builds `-target "T" -divide source="D" [fields=A,B] [force]` and delegates to `_runDatasetCommand`.
- [x] 1.3 Re-export `DivideOptions` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add an `Emap divideLayer` describe block in `src/map/map.test.ts` covering: minimal command shape, fields, force, missing source / unresolved target / unresolved divider / wrong geometry types → false, history label `Divide <target>`.

## 3. Example
- [x] 3.1 Add `test/examples/divide.html` with multi-file upload UI, target dropdown (polylines), divider dropdown (polygons), fields/force inputs.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass.
