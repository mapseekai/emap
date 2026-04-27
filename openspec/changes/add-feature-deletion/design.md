## Context
The previous two proposals built the rails: selection persists "what the next operation acts on", and the history records reversible commands. Deleting features is the smallest, most independent operation that uses both rails simultaneously, and the natural first L1 operation to ship. It also forces us to pin down two patterns that every future op (clip, erase, dissolve, attribute write, …) will need:

1. **Multi-step undoable operation** — one logical user action that requires several primitive mutations. Modeled as `CompositeCommand` so the entire batch is one undo entry.
2. **Selection-driven dispatch** — the operation walks the current selection, builds commands, executes them, then clears the selection because the operands are gone (or fundamentally changed).

## Goals / Non-Goals
- Goals
  - One method (`Emap.deleteSelected()`) that closes the deletion loop.
  - Match mapshaper's `deleteFeature` / `insertFeature` symmetry exactly so undo round-trips are byte-equivalent.
  - One Ctrl+Z reverses an entire multi-feature deletion, not one Ctrl+Z per feature.
  - Reusable `CompositeCommand` primitive that future ops compose.
- Non-Goals
  - Pruning orphan arcs after deletion. mapshaper's convention is to leave them; `clean` / `dissolve` reclaim them. Doing it here would be premature and would prevent topology-preserving undo.
  - "Delete by predicate" (e.g., delete all features matching expression). That belongs to a future `add-filter-features` proposal that wraps mapshaper's `-filter`.
  - UI button beyond wiring up the existing stub in the selection example.

## Decisions

- **Decision: splice-based delete + undo, leaving orphan arcs.**
  - Rationale: matches `gui-drawing-utils.deleteFeature` and `insertFeature` (mapshaper/src/gui/gui-drawing-utils.mjs:119, 128). Symmetric, zero allocations on either side, undo restores the exact prior state.

- **Decision: descending-id deletion within each layer.**
  - Rationale: `Array.splice(i, 1)` shifts every later index down by one. If we delete id 5 then id 7, the original 7 has become 6 by then. Sorting ids descending sidesteps this without needing a separate "stable id → current index" map.

- **Decision: cross-layer deletes do not need cross-coordination.**
  - Rationale: each layer owns its own `shapes` array. Deletes in layer A do not affect indices in layer B. We only need descending sort *within* a layer.

- **Decision: one `CompositeCommand` per `deleteSelected()` call, even for one feature.**
  - Rationale: uniform behaviour for the user (Ctrl+Z always reverses one whole "delete operation"), and trivially composable when later ops produce additional sub-commands as part of the same logical action.

- **Decision: clear the selection after deletion.**
  - Rationale: the selected refs no longer exist; a stale selection would point to features that were just deleted. Other GIS tools (QGIS, ArcGIS) clear the selection on delete for the same reason. Undo restores the features but does *not* re-add them to the selection — re-selecting after undo is a separate user choice.

- **Decision: `CompositeCommand.undo()` walks children in reverse order.**
  - Rationale: to invert a sequence of mutations you invert each step and run them in reverse. For deletion in particular, the children deleted in descending-id order; undoing in reverse means re-inserting in ascending-id order, which is the only order that lands every shape at its original index.

## Risks / Trade-offs

- **Risk: orphan arcs accumulate over many edit sessions.**
  - Acceptable: this is mapshaper's deliberate trade-off. Users export → re-import or run `-clean` to compact; emap can later expose a `compact()` API that wraps `-clean` if it becomes a real concern.

- **Risk: deleting a feature whose arcs are shared with other features.**
  - In mapshaper's topology model, arcs ARE shared between adjacent features (that is the whole point). Deleting feature A leaves the arc; feature B (which references it) is unaffected. This is the correct, topology-preserving behaviour and is exactly why we do not prune arcs.

- **Trade-off: no pre-delete confirmation.**
  - Acceptable: undo is one keystroke. The example still wires a button that calls `deleteSelected()` — embedders who want a "Are you sure?" dialog can add it before calling.

## Migration Plan
None. Additive change.

## Open Questions
- Should `deleteSelected()` accept an explicit list of refs (overriding the current selection)? Defer — `selection.apply(refs, 'replace')` followed by `deleteSelected()` already covers the use case in two lines, and the simpler API is clearer.
