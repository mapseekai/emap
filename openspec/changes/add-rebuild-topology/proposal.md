# Change: Add `rebuildTopology` — repair shared arcs after edits

## Why
emap's lightweight edit ops (`translateSelected`, `rotateSelected`, `scaleSelected`, `VertexMoveCommand`, `VertexInsertCommand`, `VertexDeleteCommand`) mutate arc vertex data **in place**. They are fast and finely undoable, but they don't update the shared-arc topology the dataset depends on:
- Translating a feature can move its arcs across other features → new self-intersections.
- A vertex move can break a shared boundary (vertex now sits at a slightly different point than the neighbour's matching vertex).
- An insert can split an arc that other features expected to be one piece.

Subsequent overlay commands (`-clip`, `-erase`, `-dissolve`, `-union`, `-mosaic`, `-divide`) call mapshaper's `addIntersectionCuts` internally before they run, so they self-heal. But:
- Exports happen against the un-repaired dataset, baking topology bugs into output.
- Vertex-edit / select-edit feedback can render incorrectly when shared arcs no longer overlap.
- `-each`-style attribute updates and feature filters operate on the broken topology directly.

mapshaper's CLI exposes this repair as `-clean` (a heavyweight pass that also removes spikes / slivers / overlapping polygons). What's missing is the **lightweight** counterpart: just rebuild shared arcs and insert intersection cuts, without the extra polygon-repair work. That is what `mapshaper.internal.addIntersectionCuts(dataset, opts)` does — and it's the same primitive every overlay command runs as a pre-pass.

## What Changes
- Add `Emap.rebuildTopology({ source, snapInterval?, noSnap?, rebuildTopology? }): Promise<boolean>` in `src/map/map.ts`.
- The implementation:
  - Resolves the source; returns `false` if missing or has no dataset.
  - Returns `true` immediately for datasets with no arcs (point-only sources have nothing to rebuild).
  - Deep-copies the dataset via `mapshaper.internal.copyDataset`, runs `mapshaper.internal.addIntersectionCuts(copy, opts)` on the copy, swaps it onto the source via `setDataset`.
  - Pushes one `DatasetReplaceCommand` for undo (history barrier, same as every other dataset-replace op).
  - Clears the selection (feature ids may have shifted after degenerate-shape removal).
- Add `RebuildTopologyOptions` interface in `src/map/map.ts`; re-export from `src/index.ts`.
- Add `mapshaper.internal.addIntersectionCuts` declaration to `src/types/mapshaper.d.ts`.
- Add `test/examples/rebuild-topology.html` — load data, translate a selection, run rebuild, observe the dataset is now overlay-safe.

## Impact
- Affected specs: `rebuild-topology` (new capability)
- Affected code: `src/map/map.ts`, `src/map/map.test.ts`, `src/index.ts`, `src/types/mapshaper.d.ts`, new example
- No new infrastructure. Reuses the dataset-replace pattern (`copyDataset` → mutate → `setDataset` → `DatasetReplaceCommand`) and the existing `_history` barrier convention.

## Notes
- **Why a history barrier**: prior fine-grained commands (translate, vertex-move) close over the OLD `arcs` object and old arc indices. After `addIntersectionCuts`, vertices may have been added and arcs re-indexed. Undoing a prior vertex-move would corrupt geometry. Clearing keeps undo predictable: `rebuildTopology` itself is one undoable step that fully restores the pre-rebuild state.
- **Why not auto-rebuild on every translate**: `addIntersectionCuts` is O(n²) on intersecting segment count in the worst case. A 100-feature rotate that runs rebuild on every command would be unworkable. Explicit user-driven invocation is the right default.
- **Composing with `cleanLayer`**: `cleanLayer` (a wrapper for `-clean`) is heavier — runs `addIntersectionCuts` plus polygon overlap removal, sliver elimination, etc. `rebuildTopology` is the lighter option for "I just edited geometry, please re-derive shared arcs". Use `cleanLayer` when you also want to dissolve overlaps.
- **`snapInterval` / `noSnap`**: forwarded to mapshaper's coincident-vertex snap pass that runs before the cut detection. Default behaviour matches mapshaper CLI: auto-detect based on dataset bounds. `noSnap: true` skips snapping entirely (faster but won't fix near-coincident vertices). `snapInterval: 0.001` overrides with an explicit threshold in source-CRS units.
- **`rebuildTopology` flag on the options**: forces a `buildTopology` rerun even if the cut-detection pass found no intersection changes. Useful when arcs were translated but didn't intersect anything new — we still want shared arcs redetected against unchanged neighbours. Leave off for the common case.
