# Change: Add `translateSelected` — move selected features by (dx, dy)

## Why
Vertex-by-vertex editing exists, but moving a whole feature requires the user to drag every vertex individually. Every editor has a "drag the selection by N units" primitive — it is the geometric counterpart of `setFeatureProperties`. mapshaper's CLI does not have a feature-translate command (its `-affine` is whole-dataset and rarely used interactively); the operation is small enough to implement directly against the mapshaper data model.

## What Changes
- Add `FeatureTranslateCommand` (`src/edit/commands/feature-translate.ts`) that records `(dx, dy)` plus the affected source / arc IDs / point shape positions. `do()` offsets every vertex of those arcs and every point shape by `(+dx, +dy)`; `undo()` offsets by `(-dx, -dy)`. Updates per-arc bounds via mapshaper's `arcs.updateArcBounds` after each pass.
- Add `Emap.translateSelected(dx: number, dy: number): boolean` that:
  1. Returns `false` for an empty selection or `dx === 0 && dy === 0`.
  2. Walks the current selection grouped by source. For each source: collects the union of arc IDs referenced by selected path features (`absArcId`-deduplicated) and the indices of selected point features.
  3. Builds one `FeatureTranslateCommand`, executes it, pushes it onto history, fires `historychange`, schedules a render. Lightweight — does NOT clear the selection (ids stay valid since we are mutating geometry in place, not replacing the dataset).
- Re-export `FeatureTranslateCommand` from `src/index.ts`.
- Add `test/examples/feature-translate.html` showing select + arrow keys to nudge.

## Impact
- Affected specs: `feature-translate` (new capability)
- Affected code:
  - new: `src/edit/commands/feature-translate.ts`, `src/edit/commands/feature-translate.test.ts`
  - modified: `src/map/map.ts` (one new public method + a small helper to walk the selection), `src/map/map.test.ts` (new integration tests), `src/index.ts` (re-export)
  - new: `test/examples/feature-translate.html`
- No public API breaks.

## Notes — known v1 limitation
- mapshaper's topology model means **arcs are shared between adjacent features**. If a selected polygon shares an arc with an unselected neighbour, translating the selection will move that shared arc and distort the neighbour. The proper fix is to first cut the shared arcs at the boundary between selected / unselected (`internal.divideArcsAtNodes` etc.), then translate only the now-private arcs. v1 does NOT do this — it translates blindly and documents the limitation.
  - Selecting a topologically-isolated feature (e.g., no shared edges) translates correctly with no side effects.
  - Selecting a contiguous subset of polygons translates the WHOLE region correctly because all internal shared arcs are owned by selected features on both sides.
  - The breaking case is selecting one polygon on the edge of a polygon mosaic — the neighbour's shared edge moves with it.
- Tracked as a future `add-arc-cut-on-translate` proposal.
