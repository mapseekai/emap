# Change: Add `renameLayer` — rename a layer in place

## Why
Layer housekeeping: every dataset-replace command emap wraps creates output layers with mapshaper's default naming (often `lyr-1`, the input layer's name reused, or a derived form like `borders`). Users routinely need to rename them — for downstream layer references in `addLayer`, for snapshot exports, and for multi-source workspaces where source IDs and layer IDs need to stay distinct.

mapshaper's `-rename-layers` is the canonical command for this.

## What Changes
- Add `Emap.renameLayer({ source, target, name }): Promise<boolean>` in `src/map/map.ts`.
- Build the mapshaper command `-target "<old>" -rename-layers <new>` and delegate to `_runDatasetCommand`.
- Validate that the source resolves, `target` resolves to a layer in it, `name` is a non-empty string, and the new name does not collide with another existing layer in the same dataset.
- Add `RenameLayerOptions` interface; re-export from `src/index.ts`.
- Add `test/examples/rename-layer.html` — choose a layer, type a new name, rename in place.

## Impact
- Affected specs: `rename-layers` (new capability)
- Affected code: `src/map/map.ts`, `src/map/map.test.ts`, `src/index.ts`, new example HTML
- No new infrastructure. Reuses `_runDatasetCommand`.

## Notes
- mapshaper's `-rename-layers` accepts a comma-list so it can rename N layers at once. v1 wraps the single-layer case (the common one); a future change can add `Emap.renameLayers([{from, to}, ...])` for batch renames if needed.
- We don't allow renaming to a name already in use by another layer because mapshaper would either silently overwrite the duplicate's identity in the GUI or break down-stream `target=` references. Up-front rejection keeps the failure mode obvious.
