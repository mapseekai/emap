## 1. Implementation
- [x] 1.1 Declare `FilterOptions { source, target, expression?, invert?, removeEmpty? }` in `src/map/map.ts`.
- [x] 1.2 Add `Emap.filterFeatures(opts: FilterOptions): Promise<boolean>`. Validates source / target; returns `false` when neither `expression` nor `removeEmpty` is set. Builds `-target "<X>" -filter [<EXPR>] [invert] [remove-empty]` (expression quoted via `quoteMapshaperArg`) and delegates to `_runDatasetCommand`.
- [x] 1.3 Re-export `FilterOptions` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add an `Emap filterFeatures` describe block in `src/map/map.test.ts` covering: expression-only, expression + invert, expression + remove-empty, remove-empty only (no expression), missing source / target / no predicate at all → false, history label `Filter <target>`.

## 3. Example
- [x] 3.1 Add `test/examples/filter-features.html`: load a dataset, type a JS expression, optional invert + remove-empty checkboxes, click "Filter".

## 4. Validation
- [x] 4.1 `npm test` — all tests pass. *(219 / 219 across 17 files.)*
