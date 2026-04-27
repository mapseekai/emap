## 1. Implementation
- [x] 1.1 Declare `SplitLayerOptions { source, target, expression, noReplace? }` in `src/map/map.ts`.
- [x] 1.2 Add `Emap.splitLayer(opts): Promise<boolean>`. Validates source exists, target resolves, `expression` is a non-empty trimmed string. Builds `-target "T" -split "<expression>" [no-replace]` and delegates to `_runDatasetCommand`.
- [x] 1.3 Re-export `SplitLayerOptions` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add an `Emap splitLayer` describe block in `src/map/map.test.ts` covering: minimal command shape (bare field name), JS-expression-style input is forwarded as-is and quoted, no-replace, missing source / unresolved target / empty expression → false, history label `Split <target>`.

## 3. Example
- [x] 3.1 Add `test/examples/split-layer.html`.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass.
