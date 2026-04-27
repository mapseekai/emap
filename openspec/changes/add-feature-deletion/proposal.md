# Change: Delete selected features

## Why
emap now has selection (`add-selection-model`) and undo/redo (`add-undo-redo`). The smallest, highest-leverage operation that combines them is "delete the selected features": it is the canonical first L1 operation, validates the selection-driven undoable-op pattern end-to-end, and wires up the existing `Delete selected (logs)` button stub in the selection example.

## What Changes
- Add `CompositeCommand` (in `src/edit/commands/composite.ts`): a generic `EditCommand` that wraps an ordered list of child commands. `do()` runs them in order; `undo()` runs them in reverse order. This is the primitive every multi-step L1/L2 operation will use.
- Add `FeatureDeleteCommand` (in `src/edit/commands/feature-delete.ts`) following mapshaper's `deleteFeature` / `insertFeature` pattern: splice the shape and data record out of the layer; on undo, splice them back at the original index. Orphan arcs are left in the arc collection (mapshaper convention — `dissolve` / `clean` reclaims them).
- Add `Emap.deleteSelected()` that:
  - Iterates the current selection, sorting per-layer ids descending so each delete's index remains valid.
  - Wraps every individual `FeatureDeleteCommand` in one `CompositeCommand` so the entire operation is one undo step (one Ctrl+Z reverses all of them).
  - Clears the selection after a successful deletion (via `clearSelection()`, which fires its own `selectionchange`).
  - Returns `false` and does nothing when the selection is empty.
- Re-export `CompositeCommand`, `FeatureDeleteCommand` from `src/index.ts`.
- Update `test/examples/feature-selection.html` so the existing "Delete selected" button calls `map.deleteSelected()` instead of just logging.

## Impact
- Affected specs: `feature-deletion` (new capability)
- Affected code:
  - new: `src/edit/commands/composite.ts`, `src/edit/commands/feature-delete.ts`, plus tests
  - modified: `src/map/map.ts` (deleteSelected method), `src/index.ts` (re-exports), `test/examples/feature-selection.html` (wire the button)
- No public API breaks. Adds a new method and two new command classes.
