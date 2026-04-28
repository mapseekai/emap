## 1. Implementation
- [x] 1.1 Declare `SimplifyMethod = 'dp' | 'visvalingam' | 'weighted'` and `SimplifyOptions { source; target?; percentage?; interval?; resolution?; method?; weighting?; planar?; keepShapes?; lockBox?; noRepair? }` in `src/map/map.ts`.
- [x] 1.2 Add `Emap.simplifyLayer(opts): Promise<boolean>`. Validates source exists; if `target` supplied it must resolve to a layer in the source. Validates exactly one threshold is supplied and within range. Builds `[-target "T"] -simplify <thresh> [<method>] [weighting=N] [planar] [keep-shapes] [lock-box] [no-repair]` and delegates to `_runDatasetCommand`.
- [x] 1.3 Re-export `SimplifyOptions` and `SimplifyMethod` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add an `Emap simplifyLayer` describe block in `src/map/map.test.ts` covering: percentage / interval / resolution threshold modes; method dp / visvalingam / weighted; weighting; flag passthroughs (planar / keep-shapes / lock-box / no-repair); target scoped vs whole-dataset; missing source / unresolved target / no threshold / multiple thresholds / out-of-range values → false; history label `Simplify <target | source>`.

## 3. Example
- [x] 3.1 Add `test/examples/simplify.html` — file upload, threshold mode + value input, method + flag toggles, "简化" button.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass.
