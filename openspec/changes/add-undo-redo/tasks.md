## 1. Core infrastructure
- [x] 1.1 Create `src/edit/edit-command.ts` exporting the `EditCommand` interface (`do`, `undo`, optional `label`, optional `mergeable(prev): boolean`).
- [x] 1.2 Create `src/edit/edit-history.ts` exporting `EditHistory` with `push(cmd)`, `undo()`, `redo()`, `canUndo()`, `canRedo()`, `clear()`, `size()`. `push` clears the redo stack. Constructor accepts `{ maxSize?: number }` (default 200) — exceeding the cap evicts oldest entries.
- [x] 1.3 Wire `EditHistory` into `Emap`: `_history` field, `undo()`, `redo()`, `canUndo()`, `canRedo()`, `clearHistory()`, `pushCommand(cmd)`. Emit `historychange` events with `{ canUndo, canRedo, label }`.

## 2. Concrete commands
- [x] 2.1 `src/edit/commands/vertex-move.ts` — `VertexMoveCommand` capturing pre-move xx/yy values (one slice per affected arc) and restoring them in `undo()`. *(Captured as `from` / `to` coordinate pair; `snapVerticesToPoint` updates each affected arc's bounds internally.)*
- [x] 2.2 `src/edit/commands/vertex-insert.ts` — `VertexInsertCommand`. `do()` calls `internal.insertVertex`; `undo()` calls `internal.deleteVertex` at the inserted index. Records the inserted vertex id.
- [x] 2.3 `src/edit/commands/vertex-delete.ts` — `VertexDeleteCommand`. Snapshots the vertex's coords + arc id + index *before* deletion; `undo()` re-inserts via `internal.insertVertex` at the same index.
- [x] 2.4 `src/edit/commands/feature-create.ts` — `FeatureCreateCommand`. `undo()` for path features pops the appended shape + data record + last arc (using `internal.deleteLastArc`); for point features pops only the shape + record. After undo, calls `source.refreshDisplayArcs()`.

## 3. Control refactor (dispatch commands instead of mutating directly)
- [x] 3.1 In `VertexEditControl._onMouseUp`, snapshot pre-drag positions on mousedown, then on mouseup build a `VertexMoveCommand` and push it via `map.pushCommand`. The drag itself still mutates arcs live for visual feedback; the command captures the start → end delta on commit.
- [x] 3.2 In `VertexEditControl._onMouseDown`, when an interpolated point becomes a real insertion, push a `VertexInsertCommand` (in addition to the immediate insertVertex call). The vertex move that follows during the drag is captured by the same `VertexMoveCommand` chain.
- [x] 3.3 In `VertexEditControl._deleteHoveredVertex`, snapshot the vertex first, then push a `VertexDeleteCommand` whose `do()` performs the actual deletion.
- [x] 3.4 In `DrawFeatureControl._commitFeature`, push a `FeatureCreateCommand` after the geometry is appended.

## 4. UI / shortcuts
- [x] 4.1 Create `src/ui/history-control.ts` exporting `HistoryControl` with two buttons (Undo / Redo), enabled state driven by `historychange` events, click handlers calling `map.undo()` / `map.redo()`.
- [x] 4.2 Add `Emap.bindHistoryShortcuts(target?: HTMLElement)` that binds Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y) on the given element (default: canvas container) to undo / redo. Returns an unbind function.

## 5. Tests
- [x] 5.1 `src/edit/edit-history.test.ts` covering: push then undo restores via the command, redo replays, push after undo clears the redo stack, maxSize cap evicts oldest, canUndo/canRedo flags, clear empties both stacks.
- [x] 5.2 `src/edit/commands/vertex-move.test.ts` covering snapshot capture and restore on a mock arc collection.
- [x] 5.3 `src/edit/commands/feature-create.test.ts` covering append-then-undo for both polyline and point geometry.
- [x] 5.4 Integration test in `src/map/map.test.ts`: pushCommand → undo → redo cycle fires `historychange` with the expected flag transitions.

## 6. Example & docs
- [x] 6.1 Add `test/examples/undo-redo.html` with `HistoryControl` plus draw + vertex edit, demonstrating Ctrl+Z / Ctrl+Y on the page.
- [x] 6.2 Re-export `EditCommand`, `EditHistory`, `HistoryControl` and the bundled command classes from `src/index.ts`.

## 7. Validation
- [x] 7.1 `npm test` — all existing tests plus the new history / command suites pass. *(97 tests across 9 files, all green.)*
- [ ] 7.2 Manually verify on the example page that Ctrl+Z reverses each editing primitive (draw, drag, insert vertex, delete vertex) and Ctrl+Y replays. *(deferred — requires browser; example HTML is in place at `test/examples/undo-redo.html`)*
