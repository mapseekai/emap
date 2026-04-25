# Change: Add undo / redo for editing operations

## Why
Every edit emap currently performs is an in-place mutation of the live mapshaper dataset. There is no way to revert a vertex drag, an inserted vertex, a deleted vertex, or a drawn feature. For an editing engine this is the standard table-stakes capability — without it users will not trust the engine with real data.

## What Changes
- Introduce an `EditCommand { do(), undo(), label?, mergeable? }` interface (in `src/edit/edit-command.ts`).
- Introduce an `EditHistory` class (in `src/edit/edit-history.ts`) that holds an undo stack and a redo stack with a configurable `maxSize` (default 200). The redo stack clears on any new push.
- Provide concrete command classes for the edits emap can already perform:
  - `VertexMoveCommand` — captures pre-move snapshots (per-arc xx/yy slices) for every arc whose vertex moved, restores them on undo.
  - `VertexInsertCommand` — undo deletes the inserted vertex via mapshaper's `internal.deleteVertex`.
  - `VertexDeleteCommand` — captures the deleted vertex's coords + arc index, undo re-inserts via `internal.insertVertex`.
  - `FeatureCreateCommand` — undo pops the newly appended shape, data record, and the new arc tail (`internal.deleteLastArc` for path features).
- Wire `Emap.undo()`, `Emap.redo()`, `Emap.canUndo()`, `Emap.canRedo()`, `Emap.clearHistory()`. Emit a `historychange` event with `{ canUndo, canRedo, label }` after every push / undo / redo / clear.
- Refactor `VertexEditControl._onMouseUp`, `_deleteHoveredVertex`, and the insert-vertex branch in `_onMouseDown` to push their corresponding commands instead of mutating arcs directly. Same for `DrawFeatureControl._commitFeature`.
- Bind `Ctrl+Z` / `Ctrl+Shift+Z` (and `Cmd` on macOS) to `Emap.undo()` / `redo()` via an opt-in convenience: `new HistoryControl()` UI control plus `Emap.bindHistoryShortcuts(target?)` method (defaults to the canvas container; opt-in so pages embedding emap inside larger forms keep keyboard control).
- Add `test/examples/undo-redo.html` demonstrating draw + drag + delete with Ctrl+Z / Ctrl+Y.

## Impact
- Affected specs: `edit-history` (new capability)
- Affected code:
  - new: `src/edit/edit-command.ts`, `src/edit/edit-history.ts`, `src/edit/commands/{vertex-move,vertex-insert,vertex-delete,feature-create}.ts`, `src/ui/history-control.ts`
  - modified: `src/map/map.ts` (history wiring), `src/ui/vertex-edit-control.ts`, `src/ui/draw-feature-control.ts` (dispatch commands)
- No public API breaks. Existing event names and control APIs continue to work; the controls just route mutations through the history.
