## 1. Implementation
- [x] 1.1 Declare `RebuildTopologyOptions { source; snapInterval?; noSnap?; rebuildTopology? }` in `src/map/map.ts`.
- [x] 1.2 Add `Emap.rebuildTopology(opts): Promise<boolean>`. Resolves source; returns `false` for missing source or missing dataset; returns `true` early for arc-less (point-only) datasets. Deep-copies via `mapshaper.internal.copyDataset`, calls `mapshaper.internal.addIntersectionCuts(copy, { snap_interval, no_snap, rebuild_topology })`, swaps via `setDataset`, pushes `DatasetReplaceCommand`, clears history + selection.
- [x] 1.3 Re-export `RebuildTopologyOptions` from `src/index.ts`.
- [x] 1.4 Declare `internal.addIntersectionCuts(dataset, opts) => unknown` in `src/types/mapshaper.d.ts`.

## 2. Testing
- [x] 2.1 Mocked unit tests in `src/map/map.test.ts`:
  - Calls `addIntersectionCuts` with the deep-copied dataset and forwarded options.
  - Forwarded options use mapshaper's snake_case keys (`snap_interval`, `no_snap`, `rebuild_topology`).
  - Returns `false` for unresolved source.
  - Returns `false` when the source has no dataset.
  - Returns `true` (no-op) when the dataset has no arcs.
  - Pushes a `DatasetReplaceCommand` labelled `Rebuild topology`.
  - Acts as a history barrier (clears prior history) and clears selection.
  - On `addIntersectionCuts` throw: fires `error` event and returns `false`.
- [x] 2.2 Real-mapshaper round-trip:
  - Build a small two-feature polygon dataset that shares no arcs initially.
  - Translate one feature so it now overlaps the other.
  - Run `rebuildTopology` and assert the resulting dataset has more arcs / vertices than before (cuts inserted), and that subsequent operations don't error.

## 3. Example
- [x] 3.1 Add `test/examples/rebuild-topology.html` — file upload, click-select a feature, drag to translate, "重建拓扑" button, status line shows arc count before/after.

## 4. Validation
- [x] 4.1 `npm test` — all tests pass.
