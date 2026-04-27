## 1. Implementation
- [x] 1.1 Declare `BufferOptions { source, target, radius, capStyle? }` in `src/map/map.ts`. `radius` accepts `number | string`.
- [x] 1.2 Add `Emap.bufferLayer(opts: BufferOptions): Promise<boolean>`. Validates source and target via the same path as `clipLayer`. Builds the command `-target "<X>" -buffer <RADIUS> [cap-style=<round|flat>]` and delegates to `_runDatasetCommand`.
- [x] 1.3 Numeric radii are emitted as bare literals; string radii (expressions) are quoted via the existing `quoteMapshaperArg` helper so they survive mapshaper's command parser.
- [x] 1.4 Re-export `BufferOptions` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add an `Emap bufferLayer` describe block in `src/map/map.test.ts` covering:
  - constant numeric radius emits `-buffer 5` (no quoting)
  - expression radius emits `-buffer "pop / 1000"` (quoted)
  - `capStyle: 'flat'` adds `cap-style=flat` to the command
  - missing source / target returns `false` and pushes nothing
  - successful buffer pushes one history entry labelled `Buffer <target>`, clears prior history (history barrier inherited), and clears the selection.

## 3. Example
- [x] 3.1 Add `test/examples/buffer.html`: load a polyline / polygon dataset, type a numeric radius, click "Buffer". Reuses `HistoryControl` for undo.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass. *(195 / 195 across 17 files.)*
