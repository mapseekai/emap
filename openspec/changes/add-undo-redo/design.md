## Context
emap performs every edit via direct mutation of the live mapshaper dataset:
- `VertexEditControl` calls `internal.snapVerticesToPoint`, `insertVertex`, `deleteVertex` straight on the source arcs.
- `DrawFeatureControl._appendArc` writes new vertex storage in-place via `arcs.updateVertexData`.

There is no record of what changed, so there is no way to revert it. This proposal introduces a thin command layer between the controls and the mutations so every edit becomes a reversible step.

## Goals / Non-Goals
- Goals
  - One uniform abstraction (`EditCommand`) for every edit that should be undoable.
  - Cheap snapshots: never copy the full dataset; capture only what the command itself needs to restore (e.g., a small slice of `xx/yy` for a vertex move).
  - Predictable history events so UI controls can render Undo/Redo button states.
  - Backwards compatibility: existing public APIs (`vertex_moved` event, `feature_created` event, control behaviour) keep working.
- Non-Goals
  - Cross-source / cross-map history. Each map owns one history.
  - Persistent (localStorage) history. Out of scope; in-memory only.
  - Auto-merging of consecutive vertex drags into a single command. Useful future work but not v1 — would complicate the control refactor.
  - Branching or non-linear history (tree of edits). Linear undo/redo only.

## Decisions

- **Decision: command-pattern with explicit `do() / undo()`, not event sourcing.**
  - Rationale: mapshaper datasets are large mutable objects. Replaying a long event log to reach an old state is expensive; explicit reverse operations are O(1) per command for the edits we have.

- **Decision: snapshot only the affected slice of arc storage, not the whole dataset.**
  - Rationale: a vertex move touches a handful of vertices on one or two arcs. Storing one `Float64Array` per affected arc, sized by the arc length, is bounded and small even for millions-of-vertex datasets. mapshaper's own `arcs.getCopy()` would copy the entire arc collection (millions of bytes for typical datasets) — too coarse.

- **Decision: drag-end is the commit point for `VertexMoveCommand`, not every mouse-move frame.**
  - Rationale: capturing every interpolated frame would explode history size and is not what users mean by "one undo step". The drag itself still mutates live for visual feedback; mousedown snapshots the pre-drag state, mouseup builds the command from `{ pre, post }` and pushes it. Cancelling a drag (mouse leave / Esc — future work) would discard the snapshot without push.

- **Decision: standard memento pattern — `push()` only records, never executes.**
  - Rationale: the controls already mutated the data (that is what produced the visible result the user just made). The command is a record of what changed, used to undo on demand and to replay on redo. `EditHistory.push(cmd)` stores the command and fires `historychange`; `undo()` invokes `cmd.undo()`; `redo()` invokes `cmd.do()`. This avoids the double-execution problem at push-time and keeps the API symmetric.

- **Decision: `historychange` event payload is small and complete.**
  - `{ canUndo: boolean, canRedo: boolean, label?: string }`. UI controls use it to enable/disable buttons and optionally show the label of the last action. Recomputing canUndo/canRedo inside the listener would couple the UI to internals.

- **Decision: keyboard shortcuts are opt-in, not implicit.**
  - Rationale: emap is a library, not an app. If the host page already binds Ctrl+Z to a different action (form undo, design tool, etc.), we must not steal it. Provide `bindHistoryShortcuts(target?)` and let the user decide.

## Risks / Trade-offs

- **Risk: a command pushed during a drag, then a topology change that invalidates its captured indices.**
  - For example: `VertexMoveCommand` records vertex ids; if a `VertexDeleteCommand` between drag-start and drag-end shifts those ids, the move command's undo would target wrong vertices.
  - Mitigation: snapshots are taken at mousedown and the command is pushed at mouseup with no other commands interleaving (drag locks input). Ad-hoc interleaving is not currently possible from the controls. If it becomes possible later we will need command versioning.

- **Risk: very large vertex moves (e.g., dragging an entire feature) snapshot a lot of memory.**
  - Acceptable: emap currently has no "drag whole feature" tool. When that lands, the corresponding command can store a more compact delta (`dx, dy` per affected vertex with the original ids) instead of full slices.

- **Trade-off: no command merging means many small undos for repeated taps.**
  - Acceptable for v1. The `mergeable(prev)` hook on the interface lets us add this without breaking the abstraction later.

## Migration Plan
None for callers. The control refactor is internal — the `vertex_moved` and `feature_created` events still fire after the command is pushed, so external listeners are unaffected.

## Open Questions
- None blocking v1. Future open questions: command merging (e.g., consecutive vertex drags collapsing to one history entry) — the `mergeable(prev)` hook is reserved on the interface, but no command currently uses it.
