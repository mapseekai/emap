# Change: Add `mergeLayers` — combine multiple layers into one

## Why
Workflow companion to `unionLayers` (polygons-on-polygons) and `divideLayer` (polylines-by-polygons): `mergeLayers` is the bare "stack these layers' features into one layer" operation. Use cases include:
- Combining multiple uploaded shapefiles into a single editable layer.
- Re-flattening output of `splitLayer` once analysis is done.
- Reducing layer count before export.

mapshaper's `-merge-layers` does this with optional `force` (allow inconsistent fields) and `flatten` (remove polygon overlaps via topology) flags.

## What Changes
- Add `Emap.mergeLayers({ source, targets, name?, force?, flatten? }): Promise<boolean>` in `src/map/map.ts`.
- Build mapshaper command `-target "T1,T2,..." -merge-layers [name="..."] [force] [flatten]` and delegate to `_runDatasetCommand`.
- Validate that the source resolves, `targets.length >= 2`, every target resolves, and the targets share a compatible geometry type unless `force: true`.
- Add `MergeLayersOptions` interface; re-export from `src/index.ts`.
- Add `test/examples/merge-layers.html` with multi-file upload + checkbox layer picker (mirroring `union.html`).

## Impact
- Affected specs: `merge-layers` (new capability)
- Affected code: `src/map/map.ts`, `src/map/map.test.ts`, `src/index.ts`, new example
- No new infrastructure. Reuses `_runDatasetCommand` + the multi-file `setData` path.

## Notes
- mapshaper requires layers to share a geometry type (point / polyline / polygon) by default; `force` overrides that. We perform an up-front geometry-type check: if all targets agree, omit `force`; if they don't and the caller didn't pass `force: true`, return `false`. (Better than letting mapshaper throw an opaque error mid-pipeline.)
- `flatten` only makes sense for polygon merges and is ignored by mapshaper for other types — we still pass it through verbatim if the caller sets it.
- mapshaper's `-target` for `-merge-layers` is a comma-list (same shape as `-union`); we join `targets` with commas inside one quoted argument.
