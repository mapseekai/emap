# Change: Add `mergeSelected` — combine selected features into one

## Why
`dissolveLayer` already exists, but it dissolves an entire layer. The everyday editor operation is "I picked these few adjacent polygons, merge just them into one feature" — which mapshaper's CLI does NOT have a direct command for. The standard mapshaper recipe is a temp-field discriminator + `-dissolve` + cleanup. This proposal wraps that recipe behind a one-call `Emap.mergeSelected()` so users do not need to know the trick.

## What Changes
- Add `Emap.mergeSelected(): Promise<boolean>` that:
  1. Reads the current selection. Returns `false` if empty, or if it spans more than one source/layer (mapshaper's dissolve runs on a single layer at a time).
  2. Reads the layer's attribute fields.
  3. Builds a single mapshaper command sequence that adds a temp discriminator field (`__emap_merge`), runs `-dissolve` on it with `copy-fields=` listing every original field, and drops the temp field afterwards.
  4. Delegates to the existing `_runDatasetCommand` runner so the whole thing is one undoable history entry, captures a `before` snapshot, and clears the selection on success.
- Reuse the canonical mapshaper attribute-aggregation behaviour: the merged feature inherits the FIRST selected feature's attribute values (matches `data-aggregation.mjs:88`).
- Add `test/examples/merge-selected.html` showing pick-multiple-polygons → "Merge" → one feature.

## Impact
- Affected specs: `merge-selected` (new capability)
- Affected code:
  - modified: `src/map/map.ts` (one new public method + small helper to build the command string), `src/map/map.test.ts` (new integration tests), `src/index.ts` (no new exports — method only)
  - new: `test/examples/merge-selected.html`
- No new commands files, no new helpers beyond the field-discriminator builder. v1 reuses every primitive shipped by `add-clip-erase` / `add-dissolve`.

## Notes
- mapshaper's `this.id` is a feature's row index inside its layer, which is exactly what emap's `FeatureRef.id` uses. The discriminator expression embeds the selected ids as a JSON array literal; runtime cost is O(N) per row at dissolve time, fine for any interactive selection.
- For non-polygon layers (polyline, point), mapshaper's `-dissolve` still runs but the semantics differ (multipoint / multipart polyline output). The method does not artificially restrict by geometry type — that would break feature parity with mapshaper's CLI.
- Cross-source / cross-layer merge is out of scope — it requires moving features between layers, which has no mapshaper equivalent. Returning `false` for cross-layer selections keeps semantics unambiguous.
