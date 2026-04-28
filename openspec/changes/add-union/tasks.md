## 1. Implementation
- [x] 1.1 Declare `UnionOptions { source, targets, fields?, name?, noReplace? }` in `src/map/map.ts`. `targets` is `string[]`, `fields` is `string[]`.
- [x] 1.2 Add `Emap.unionLayers(opts): Promise<boolean>`. Validates source, requires `targets.length >= 2`, requires every name in `targets` to resolve. Builds `-target "L1,L2,..." -union [fields=A,B] [name="N"] [no-replace]` and delegates to `_runDatasetCommand`.
- [x] 1.3 Re-export `UnionOptions` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add an `Emap unionLayers` describe block in `src/map/map.test.ts` covering: comma-joined target list (quoted), fields, name, no-replace, missing source / fewer than two targets / unresolved target → false, history label `Union <targets>`.

## 3. Example
- [x] 3.1 Add `test/examples/union.html` with multi-file upload UI (mirroring `clip-erase.html`).

## 4. Validation
- [x] 4.1 `npm test` — all tests pass.
