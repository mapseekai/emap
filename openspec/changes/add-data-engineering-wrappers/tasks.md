## 1. Implementation
- [x] 1.1 Declare option interfaces in `src/map/map.ts`:
  - `DropLayerOptions { source, target }`
  - `SortFeaturesOptions { source, target, expression, descending? }`
  - `UniqueFeaturesOptions { source, target, expression, maxCount?, invert? }`
  - `FilterFieldsOptions { source, target, fields, invert? }`
  - `RenameFieldsOptions { source, target, mapping }`
- [x] 1.2 Implement five `Emap` methods, each delegating to `_runDatasetCommand`:
  - `dropLayer` — validates source/target; builds `-target "T" -drop`; label `Drop <target>`.
  - `sortFeatures` — validates source/target + non-empty expression; builds `-target "T" -sort "<expr>" [descending]`; label `Sort <target>`.
  - `uniqueFeatures` — validates + non-empty expression + (when given) `maxCount > 0`; builds `-target "T" -uniq "<expr>" [max-count=N] [invert]`; label `Uniq <target>`.
  - `filterFields` — validates + non-empty `fields[]` + each field is a non-empty string with no `,` chars; builds `-target "T" -filter-fields "f1,f2" [invert]`; label `Filter fields ${target}`.
  - `renameFields` — validates + non-empty mapping + each key/value is a non-empty trimmed string with no `,` or `=` characters; builds `-target "T" -rename-fields "old=new,..."`; label `Rename fields ${target}`.
- [x] 1.3 Re-export the five option interfaces from `src/index.ts`.

## 2. Testing
- [x] 2.1 Per-command describe blocks in `src/map/map.test.ts` covering, for each: minimal command shape, every option passthrough, missing source / unresolved target / invalid input → `false`, history label.

## 3. Example
- [x] 3.1 `test/examples/data-engineering.html` — one panel per command (drop / sort / uniq / filter-fields / rename-fields).

## 4. Validation
- [x] 4.1 `npm test` — all tests pass.
