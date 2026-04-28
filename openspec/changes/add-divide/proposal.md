# Change: Add `divideLayer` — split lines by polygons, copy polygon attributes

## Why
mapshaper's `-divide` command cuts polylines wherever they cross polygon boundaries and copies attributes from the underlying polygon onto each resulting line segment — the canonical "split this road network by census tract" workflow. It's the polyline counterpart to the polygon-on-polygon `-clip`/`-erase`/`-union` family already wrapped by emap and rounds out our overlay analysis surface.

## What Changes
- Add `Emap.divideLayer({ source, target, divider, fields?, force? }): Promise<boolean>` that builds the mapshaper command `-target "<line-layer>" -divide source="<polygon-layer>" [fields=A,B] [force]` and delegates to `_runDatasetCommand`.
- Validate that:
  - `target` resolves to a polyline layer in the source dataset,
  - `divider` resolves to a polygon layer in the same source.
  Both must live in the same emap source — cross-source dividers require a future explicit merge.
- Add `DivideOptions` interface in `src/map/map.ts`; re-export from `src/index.ts`.
- Add `test/examples/divide.html` with multi-file upload (mirroring `clip-erase.html` / `union.html`) so users can supply one polyline file plus one polygon file.

## Impact
- Affected specs: `divide` (new capability)
- Affected code: `src/map/map.ts` (one new public method + options interface), `src/map/map.test.ts` (new integration tests), `src/index.ts` (re-export), new example HTML
- No new infrastructure. Reuses the multi-file `setData` path landed in `93b57e9` and the `_runDatasetCommand` runner.

## Notes
- mapshaper's `-divide` supports a positional `source` arg (the polygon layer). We use the explicit `source=<name>` form for clarity, mirroring how `clipLayer` / `eraseLayer` already work.
- v1 omits `calc=` (many-to-one join expression). It can be added later as an optional string field — the current scope is the common one-polygon-per-line case where mapshaper just copies the polygon record verbatim.
- mapshaper's `-divide` option list comments out `no-replace`, so we don't expose a `noReplace` flag on `DivideOptions`.
