## 1. Implementation
- [x] 1.1 Declare `ApplyExpressionOptions { source, target, expression, where? }` in `src/map/map.ts`.
- [x] 1.2 Add `Emap.applyExpression(opts: ApplyExpressionOptions): Promise<boolean>`. Validates source / target via the same path as `clipLayer`. Builds the command `-target "<X>" -each "<EXPR>" [where="<WHERE>"]` (both expression strings quoted via `quoteMapshaperArg`) and delegates to `_runDatasetCommand`.
- [x] 1.3 Re-export `ApplyExpressionOptions` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add an `Emap applyExpression` describe block in `src/map/map.test.ts` covering:
  - basic expression emits `-target "X" -each "this.foo = 1"` (quoted)
  - with `where` emits the filter as a quoted `where="..."` argument
  - missing source / target returns `false` and pushes nothing
  - empty / whitespace-only expression returns `false`
  - blank where= is omitted from the command
  - successful run pushes one history entry labelled `Update <target>`, fires one `historychange`
  - embedded double-quotes in expression are escaped.

## 3. Example
- [x] 3.1 Add `test/examples/attribute-expressions.html`: load a dataset, type a JS expression (with optional `where`), click "Apply". Reuses `HistoryControl` for undo. Pre-populates with a sensible example.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass. *(202 / 202 across 17 files.)*
