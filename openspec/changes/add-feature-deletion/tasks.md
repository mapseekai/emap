## 1. Implementation
- [x] 1.1 Create `src/edit/commands/composite.ts` exporting `CompositeCommand`. Constructor takes `(children: EditCommand[], label?: string)`. `do()` runs children in order; `undo()` runs them in reverse order.
- [x] 1.2 Create `src/edit/commands/feature-delete.ts` exporting `FeatureDeleteCommand`. Captures `{ layer, featureId, shape, record, source }` at construction time. `do()` splices the shape and record at `featureId` and calls `source.refreshDisplayArcs()`. `undo()` splices them back at the same index.
- [x] 1.3 Add `Emap.deleteSelected()` that snapshots the selection, groups by `(source, layer)`, sorts each group's feature ids descending, builds one `FeatureDeleteCommand` per id, applies them, wraps them in a `CompositeCommand`, pushes that single composite command, clears the selection, and returns `true`. Returns `false` (and pushes nothing) when the selection is empty.
- [x] 1.4 Re-export `CompositeCommand` and `FeatureDeleteCommand` (and their option types) from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add `src/edit/commands/composite.test.ts` covering: `do()` invokes children in order, `undo()` invokes them in reverse, label propagates, empty children list is a no-op.
- [x] 2.2 Add `src/edit/commands/feature-delete.test.ts` covering: shape and record are spliced out at `do()`, restored at the original index by `undo()`, refreshDisplayArcs is called on both, layers without `data` are handled (no record to splice).
- [x] 2.3 Add an integration test in `src/map/map.test.ts` verifying: `deleteSelected()` returns `false` when empty; with two selected features in the same layer it pushes one composite command, mutates `layer.shapes` correctly, fires `selectionchange` to empty, and a single `undo()` restores both features and the data records.

## 3. Example
- [x] 3.1 Update `test/examples/feature-selection.html` so the "Delete selected" button calls `map.deleteSelected()` and so the existing `HistoryControl` (added inline) lets the user Ctrl+Z to bring features back.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass. *(112 / 112 across 11 files.)*
