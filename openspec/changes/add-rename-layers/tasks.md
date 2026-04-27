## 1. Implementation
- [x] 1.1 Declare `RenameLayerOptions { source, target, name }` in `src/map/map.ts`.
- [x] 1.2 Add `Emap.renameLayer(opts): Promise<boolean>`. Validates source exists, target resolves, `name` is a non-empty trimmed string, name does not collide with another existing layer. Builds `-target "T" -rename-layers <name>` and delegates to `_runDatasetCommand`.
- [x] 1.3 Re-export `RenameLayerOptions` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add an `Emap renameLayer` describe block in `src/map/map.test.ts`: minimal command shape, missing source / unresolved target / empty name / collision → false, history label `Rename <from> → <to>`.

## 3. Example
- [x] 3.1 Add `test/examples/rename-layer.html`.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass.
