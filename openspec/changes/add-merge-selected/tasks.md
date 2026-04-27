## 1. Implementation
- [x] 1.1 Add `Emap.mergeSelected(): Promise<boolean>` in `src/map/map.ts`. Reads the current selection; returns `false` when empty or when it spans more than one (source, layer) pair.
- [x] 1.2 Add a private helper `buildMergeSelectedCommand(target, ids, layer)` that returns the mapshaper command string with all string args quoted via `quoteMapshaperArg`.
- [x] 1.3 In `mergeSelected`, resolve the layer (existing `_resolveLayer`), read field names from `layer.data.getFields()`, build the command, and delegate to `_runDatasetCommand(sourceId, cmd, 'Merge N features')`. Field list omits the temp `__emap_merge` field defensively.
- [x] 1.4 If the layer has no `data` table, omit `copy-fields=` from the command (mapshaper handles that case fine — dissolve still runs).

## 2. Testing
- [x] 2.1 Add an `Emap mergeSelected` describe block in `src/map/map.test.ts` covering: empty / cross-layer / cross-source returns false, command-string assertions (sorted ids, copy-fields, this.id, discriminator field name, cleanup), no-data-table omits copy-fields, single history entry + selection clear, history-barrier inheritance, comma-in-field-name defensive filter.

## 3. Example
- [x] 3.1 Add `test/examples/merge-selected.html`. Loads a polygon dataset, click+shift-click to build a multi-feature selection, click "Merge selected" to combine them. Reuses `HistoryControl` for undo.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass. *(171 / 171 across 16 files.)*
