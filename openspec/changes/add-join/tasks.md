## 1. Runner extension
- [x] 1.1 Extend `runMapshaperCommandOnDataset(cmd, dataset, inputFiles?)` to attach `inputFiles` to every parsed command's `options.input` when supplied.
- [x] 1.2 Extend `_runDatasetCommand(sourceId, cmd, label, inputFiles?)` to forward.

## 2. Implementation
- [x] 2.1 Declare `JoinTableOptions` in `src/map/map.ts`. `data` is a discriminated union of `{ csv }`, `{ json }`, `{ layer }`. `keys` is `[string, string]`. Optional `fields[]`, `prefix`, `where`, `calc`, `unjoined`, `unmatched`.
- [x] 2.2 Add `Emap.joinTable(opts)`. Validates source/target. Resolves `data` to either a synthetic filename (with input-cache injection) or a layer name. Builds `-target "T" -join "<source>" keys="t,s" [fields=...] [prefix=...] [where=...] [calc=...] [unjoined] [unmatched]` and delegates to the extended `_runDatasetCommand`.
- [x] 2.3 Re-export `JoinTableOptions` from `src/index.ts`.

## 3. Testing
- [x] 3.1 Mocked unit tests in `src/map/map.test.ts`:
  - CSV-based join: command shape + inputFiles cache contains `.emap-join.csv` with the bytes.
  - JSON-based join (string, array, object inputs): all three coerce to a single JSON string in the cache.
  - Layer-based join: command embeds the layer name; no inputFiles cache attached.
  - All optional passthroughs (fields, prefix, where, calc, unjoined, unmatched).
  - keys missing/malformed → false; missing source/target → false; data type mismatch → false.
- [x] 3.2 Real-mapshaper round-trip:
  - Build a tiny 2-feature polygon source.
  - Provide an in-memory CSV with two rows joining on a key.
  - Assert each polygon record gains the joined columns.

## 4. Example
- [x] 4.1 `test/examples/join.html` — file upload, textarea for CSV, key inputs, run-join button, attribute-table preview before/after.

## 5. Validation
- [x] 5.1 `npm test` — all tests pass.
