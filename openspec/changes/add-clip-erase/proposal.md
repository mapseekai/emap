# Change: Add clip and erase polygon operations

## Why
Clip and erase are the two most common polygon operations in any GIS editing workflow ("cut this layer to a boundary", "punch a hole using this mask"). They are also the simplest dataset-replacing mapshaper commands to wrap, so this proposal both ships the operations and pins down the **dataset-replace command pattern** that every later L2 op (`dissolve`, `mosaic`, `union`, `buffer`, `simplify`, …) will reuse.

## What Changes
- Add `TopologySource.setDataset(dataset)` so commands can swap the active dataset reference; rebuilds `DisplayArcs` and fires `data`.
- Add `DatasetReplaceCommand` (in `src/edit/commands/dataset-replace.ts`): an `EditCommand` that holds a `before` snapshot and an `after` reference and swaps which one the source points at on `do()` / `undo()`.
- Add a private `Emap._runDatasetCommand(sourceId, mapshaperCmd, label)` helper that:
  1. Deep-copies the current dataset via `mapshaper.internal.copyDataset` to obtain a stable `before` snapshot.
  2. Runs the mapshaper command (mutating the original dataset in place — that is mapshaper's convention for `-clip` / `-erase` / `-dissolve`).
  3. Clears the history before pushing the new command (dataset replacement is a history barrier — see design.md).
  4. Pushes a `DatasetReplaceCommand({ source, before: copy, after: mutated, label })`.
  5. Clears the selection (feature ids may now point to different features after re-cutting).
- Add `Emap.clipLayer(opts)` and `Emap.eraseLayer(opts)` that build the mapshaper command string and delegate to `_runDatasetCommand`. Both return `Promise<boolean>`: `true` on success, `false` for unresolvable source / target / mask.
- Extend `mapshaper.d.ts` with `internal.copyDataset(dataset)`.
- Re-export `DatasetReplaceCommand`, `ClipEraseOptions` from `src/index.ts`.
- Add `test/examples/clip-erase.html` showing import → click "Clip layer to mask" → undo to restore.

## Impact
- Affected specs: `clip-erase` (new capability)
- Affected code:
  - new: `src/edit/commands/dataset-replace.ts`, `src/edit/commands/dataset-replace.test.ts`
  - modified: `src/source/source.ts` (interface), `src/source/topology-source.ts` (setDataset), `src/map/map.ts` (`clipLayer`, `eraseLayer`, `_runDatasetCommand`), `src/types/mapshaper.d.ts`, `src/index.ts`
  - new test/example: `test/examples/clip-erase.html`
- No public API breaks. New methods are additive.

## Notes
- v1 requires the target and mask to be in the **same source** (mapshaper's command pipeline operates on one dataset's catalog). Cross-source masks require a temporary merge — deferred to a future proposal.
- v1 does **not** yet support `-clip`'s `bbox=` / `bbox2=` shorthand; the mask is always referenced by layer name.
