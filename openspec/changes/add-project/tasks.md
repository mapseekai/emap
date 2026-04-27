## 1. Implementation
- [x] 1.1 Declare `ProjectOptions { source; crs; target?; init?; densify? }` in `src/map/map.ts`.
- [x] 1.2 Add `Emap.projectLayer(opts): Promise<boolean>`. Validates source resolves; if `target` supplied it must resolve. `crs` must be a non-empty trimmed string. Builds `[-target "T"] -proj "<crs>" [init="<src>"] [densify]` and delegates to `_runDatasetCommand`. History label `Project <target | source>`.
- [x] 1.3 Re-export `ProjectOptions` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add an `Emap projectLayer` describe block in `src/map/map.test.ts` covering: minimal command (whole-source), target-scoped, init=, densify, missing source / empty crs / unresolved target → false, history label.

## 3. Example
- [x] 3.1 Add `test/examples/project.html` — file upload, CRS dropdown (EPSG:3857 / EPSG:4326 / `'webmercator'` / `'robinson'` / `'wgs84'` / `'mercator'` / etc.), optional init-CRS input, densify toggle.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass.
