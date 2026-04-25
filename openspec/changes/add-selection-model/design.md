## Context
emap currently has no notion of "selected features" beyond the transient hover-highlight maintained by `HighlightManager`. That works for a one-shot click-and-show-attributes flow but breaks down the moment we want to:
- delete several features at once
- run a geometry op (clip / erase / dissolve) where the operands are user-picked
- bind keyboard shortcuts ("Delete", "Ctrl+C") to a stable target

Every one of those needs an answer to "which features are the operation acting on?", and the answer must persist across pointer events. The selection model is that answer.

## Goals / Non-Goals
- Goals
  - One small class (`Selection`) with explicit set/add/remove/toggle semantics.
  - Predictable event delta: `{ selected, added, removed }` so consumers can react incrementally.
  - Idiomatic mode flags (`'replace' | 'add' | 'toggle'`) that map to common click conventions.
  - Reusable `FeatureRef` type so selection, highlight, and future operations all speak the same shape.
- Non-Goals
  - Selection rendering. Callers can pipe the selection into `setHighlightedFeatures` themselves; baking a visual into `Selection` couples concerns and prevents alternate styling.
  - Bbox / lasso selection. That belongs in a follow-up `add-selection-tools` proposal — the model is independent of how the user produces the picks.
  - Persistence to localStorage. Selection is per-map-instance, in-memory. Out of scope.

## Decisions

- **Decision: separate `Selection` from `HighlightManager` even though storage shapes match.**
  - Rationale: they are conceptually different states. Highlight is "what the painter draws extra strokes on right now", selection is "what the next operation will act on". Coupling them would make it impossible to e.g. flash-highlight a hover feature without polluting the selection set, or apply different visuals to selected vs. hovered.

- **Decision: `Selection` storage mirrors `HighlightManager`'s `Map<source, Map<layer, Set<id>>>`.**
  - Rationale: O(1) `has` checks, O(1) per-layer iteration for renderers / operations, deduplication for free. Same shape we already render against.

- **Decision: mutators return `boolean` "actually changed?" and only fire the event on true.**
  - Rationale: avoids selection-event storms during things like rubber-band drag where the same feature is re-asserted every frame. The diff is computed once per mutation and surfaced in the event payload, so consumers don't have to recompute it.

- **Decision: `'replace' | 'add' | 'toggle'` as the explicit mode set.**
  - Rationale: maps directly to "click", "shift-click", "ctrl/cmd-click" — the conventions every desktop GIS uses. Not over-engineered with a generic predicate.

- **Decision: `FeatureRef` is exported as a public type, and `HighlightFeatureRef` becomes a type alias for it.**
  - Rationale: drives consistency across selection / highlight / future operations without breaking existing callers. The narrower `HighlightFeatureRef` was anyway never more than `{ source, layer, id }`.

- **Decision: no automatic re-render on selection change.**
  - Rationale: selection alone has no visual. If a caller pipes selection → highlight, the highlight setter already triggers a render. If they don't, there is nothing to redraw, so an unconditional `_scheduleRender` would just waste a frame.

## Risks / Trade-offs

- **Risk: callers expect selection to highlight automatically.**
  - Mitigation: documented in `select()` JSDoc; example `feature-selection.html` shows the explicit pipe to `setHighlightedFeatures`. A future "auto-highlight selection" toggle can be added without breaking the model.

- **Trade-off: no spatial index on the selection.**
  - Acceptable: selections are bounded by user clicks (typically tens of features, not millions). If we later need fast bbox queries against the selection we can add a flatbush internally without changing the API.

## Migration Plan
None. Additive change. Existing `HighlightFeatureRef` callers continue to work because the type aliases the new `FeatureRef`.

## Open Questions
- Should `select(...)` accept the result of `queryRenderedFeatures` directly (which returns `RenderedFeatureAttributes` carrying `properties`)? Yes — `RenderedFeatureAttributes` extends `FeatureRef` shape-wise via structural typing, so it works without a conversion. Documented in JSDoc; no code change needed.
