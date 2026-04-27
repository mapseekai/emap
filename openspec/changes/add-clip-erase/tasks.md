## 1. Infrastructure
- [x] 1.1 Extend `mapshaper.d.ts` with `internal.copyDataset(dataset): MapshaperDataset` (used to produce the `before` snapshot for `DatasetReplaceCommand`).
- [x] 1.2 Add `setDataset(dataset)` to `TopologySource` (interface in `source.ts`, implementation in `topology-source.ts`). Replaces `_dataset`, rebuilds `_displayArcs`, fires `'data'` so the map re-renders.

## 2. Dataset-replace command
- [x] 2.1 Create `src/edit/commands/dataset-replace.ts` exporting `DatasetReplaceCommand` with options `{ source, before, after, label }`. `do()` calls `source.setDataset(after)`; `undo()` calls `source.setDataset(before)`. The label is forwarded to `historychange`.
- [x] 2.2 Re-export `DatasetReplaceCommand` (and its options) from `src/index.ts`.

## 3. Emap runner + public ops
- [x] 3.1 Add a private `_runDatasetCommand(sourceId, cmd, label)` on `Emap`. Steps: resolve source, snapshot via `internal.copyDataset`, run mapshaper command (using the existing `parseCommands` + `runParsedCommands` path), clear history, push `DatasetReplaceCommand`, clear selection, fire `historychange`. Returns `Promise<boolean>`.
- [x] 3.2 Add `Emap.clipLayer({ source, target, mask })`. Builds the command `-target <target> -clip source=<mask>` (with quoted layer names) and delegates to `_runDatasetCommand`.
- [x] 3.3 Add `Emap.eraseLayer({ source, target, mask })`. Same shape, command is `-target <target> -erase source=<mask>`.
- [x] 3.4 Export `ClipEraseOptions` interface from `src/index.ts`.

## 4. Testing
- [x] 4.1 Add `src/edit/commands/dataset-replace.test.ts` covering: `do()` calls `setDataset(after)`; `undo()` calls `setDataset(before)`; round-trip do/undo restores the original ref; label is exposed.
- [x] 4.2 Add an integration test in `src/map/map.test.ts` for `_runDatasetCommand`: mocks `internal.copyDataset` and `internal.runParsedCommands`; verifies that on success the source's dataset is replaced, history is cleared then a single `DatasetReplaceCommand` is pushed, selection is cleared, and a single `historychange` event fires.
- [x] 4.3 Add a `clipLayer` test that mocks the mapshaper pipeline and verifies the constructed command string includes the target and mask as quoted strings.

## 5. Example
- [x] 5.1 Add `test/examples/clip-erase.html`. Loads a single GeoJSON, lets the user pick which layer is the target and which is the mask, runs clip or erase, and exposes a `HistoryControl` so undo works.

## 6. Validation
- [x] 6.1 `npm test` — all tests pass. *(126 / 126 across 12 files.)*
- [ ] 6.2 Manual: load a multi-layer GeoJSON in the example, run clip / erase, undo to restore. *(deferred — requires browser; example is in place at `test/examples/clip-erase.html`)*
