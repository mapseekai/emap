# Task 6 Report: Example Migration

## Baseline

- Baseline SHA: `978191ceacf0bbeaf6980ef7d506be4881c8c03d`
- Scope: migrated the original `test/examples/*.html` data, layers, interaction, and editing families into the typed Vite example catalog.

## Original HTML To Route ID Map

| Original HTML | New route ID |
| --- | --- |
| `test/examples/attribute-editing.html` | `attribute-editing` |
| `test/examples/attribute-expressions.html` | `attribute-expressions` |
| `test/examples/data-engineering.html` | `data-engineering` |
| `test/examples/feature-attributes.html` | `feature-attributes` |
| `test/examples/filter-features.html` | `filter-features` |
| `test/examples/geoparquet-viewer.html` | `geoparquet-viewer` |
| `test/examples/export-geoparquet.html` | `export-geoparquet` |
| `test/examples/export-roundtrip.html` | `export-roundtrip` |
| `test/examples/join.html` | `join` |
| `test/examples/merge-layers.html` | `merge-layers` |
| `test/examples/merge-selected.html` | `merge-selected` |
| `test/examples/rename-layer.html` | `rename-layer` |
| `test/examples/split-layer.html` | `split-layer` |
| `test/examples/interaction-handlers.html` | `interaction-handlers` |
| `test/examples/feature-selection.html` | `feature-selection` |
| `test/examples/box-select.html` | `box-select` |
| `test/examples/lasso-select.html` | `lasso-select` |
| `test/examples/china-editing.html` | `china-editing` |
| `test/examples/draw-snap-clear.html` | `draw-snap-clear` |
| `test/examples/draw-snap-edge.html` | `draw-snap-edge` |
| `test/examples/feature-rotate-scale.html` | `feature-rotate-scale` |
| `test/examples/feature-translate.html` | `feature-translate` |
| `test/examples/snapshot.html` | `snapshot` |
| `test/examples/transaction.html` | `transaction` |
| `test/examples/undo-redo.html` | `undo-redo` |
| `test/examples/vertex-editing.html` | `vertex-editing` |

## Verification

- GitNexus impact: attempted on `docs-meta/examples.ts` / `examples`, but the indexed repository snapshot predates this docs catalog and returned `Target not found`; CodeGraph also reported it was reading the main worktree index, not this linked worktree.
- Catalog tests: `npx vitest run test/docs/example-catalog.test.ts` passed, 5 tests.
- Examples build: `npm run examples:build` passed and emitted 26 Task6 static route HTML files plus fixture assets.
- Typecheck: `npm run typecheck` passed.
- Format: `npm run format:check` passed.
- Static route QA: local Vite server served `attribute-editing`, `box-select`, `feature-translate`, and `undo-redo` at HTTP 200 with the shared Vite module entry; `task-6-polygons.geojson` and `task-6-join.csv` also served at HTTP 200.

## Notes

- Browser automation was not available in this worktree (`playwright` is not installed), and the shell policy blocked launching Chrome via `open`; the verified fallback was direct local-server route and fixture probing.
- Task8-reserved files under `packages/docs/static/api/**` and reserved source files were not edited, staged, reset, checked out, or deleted.
