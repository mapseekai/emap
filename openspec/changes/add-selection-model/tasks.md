## 1. Implementation
- [x] 1.1 Add `FeatureRef` type to `src/map/map.ts` (or a new `src/map/feature-ref.ts`); alias `HighlightFeatureRef = FeatureRef` for back-compat.
- [x] 1.2 Create `src/map/selection.ts` implementing a `Selection` class with `set/add/remove/toggle/clear/has/getAll/getByLayer/size` and a per-mutation diff that returns `{ added, removed }`.
- [x] 1.3 Wire `Selection` into `Emap`: add `_selection` field, `getSelection()`, `select(features, opts?)`, `deselect(features)`, `clearSelection()`, `isSelected(feature)`. Mutators dispatch a `selectionchange` event with `{ selected, added, removed }` only when the set actually changes.
- [x] 1.4 Export `Selection`, `FeatureRef`, and `SelectMode` from `src/index.ts`.

## 2. Testing
- [x] 2.1 Add `src/map/selection.test.ts` covering: empty initial state, `set` replacing prior contents, `add` mode union semantics, `toggle` mode flip semantics, `remove` no-op when feature not present, deduplication within a layer, `getByLayer` returning numeric ids only, `size` accuracy.
- [x] 2.2 Add an integration test in `src/map/map.test.ts` that verifies `Emap.select` fires `selectionchange` with correct deltas and that no event fires on a no-op call.
- [x] 2.3 Add `test/examples/feature-selection.html` demonstrating click-replace, shift-click-add, ctrl-click-toggle, and a "Delete selected" button stub (logs to console for now).

## 3. Validation
- [x] 3.1 Run `npm test` — all tests pass, including the new selection suite.
- [ ] 3.2 Manually open `feature-selection.html`, load a small GeoJSON, verify all three selection modes and the event delta payload via console. *(deferred — requires browser; example HTML is in place at `test/examples/feature-selection.html`)*
