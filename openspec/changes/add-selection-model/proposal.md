# Change: Add a persistent feature selection model

## Why
emap exposes `queryRenderedFeatures` and a transient `HighlightManager`, but has no concept of "currently selected feature(s)" that survives across pointer events. Every L1/L2 editor operation we want to add (delete, merge, clip, erase, dissolve, …) needs an explicit selection input — without it those operations have no natural call site. Selection is small, self-contained, and unblocks every subsequent editor proposal.

## What Changes
- Add a `FeatureRef` type as the canonical `{ source, layer, id }` triple and alias the existing `HighlightFeatureRef` to it for backwards compatibility.
- Add a `Selection` class (in `src/map/selection.ts`) that maintains a multi-source / multi-layer set of `FeatureRef`s. Mirrors the storage shape of `HighlightManager` but is independent — selection is persistent state, highlight is transient render state.
- Add `Emap.select(features, options?)`, `Emap.deselect(features)`, `Emap.clearSelection()`, `Emap.getSelection()`, `Emap.isSelected(feature)`.
- Selection mutators support modes `'replace' | 'add' | 'toggle'`; default is `'replace'`.
- Emit a `selectionchange` event with `{ selected, added, removed }` deltas whenever the set actually changes; do not fire for no-op calls.
- No automatic visual change. Callers can pipe the selection into `setHighlightedFeatures` if they want to render it. (Wiring the visual is a follow-up; the selection model is the foundation.)
- Add `test/examples/feature-selection.html` showing click-to-select, shift-click to add, ctrl-click to toggle, and a "Delete selected" button stub.

## Impact
- Affected specs: `feature-selection` (new capability)
- Affected code: `src/map/map.ts`, `src/map/selection.ts` (new), `src/index.ts`, tests
- No existing API breaks. `HighlightFeatureRef` becomes an alias of `FeatureRef`, so existing callers still work.
