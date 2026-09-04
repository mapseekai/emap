# ADR 0003: Geometric merge and split

- Status: Accepted
- Date: 2026-08-24
- Supersedes:
  - `docs/superpowers/specs/2026-08-24-merge-selected-geometric-union-design.md`
  - `docs/superpowers/plans/2026-08-24-merge-selected-geometric-union.md`
  - `docs/superpowers/specs/2026-08-24-split-selected-features-design.md`
  - `docs/superpowers/plans/2026-08-24-split-selected-features.md`

## Context

Merging and splitting selected path features must preserve unrelated layers, shared topology, attributes, selection state, undo/redo, and failure atomicity. Running a whole-dataset command directly would expose unrelated features to topology rewrites.

## Decision

- Selection-driven geometry operations require compatible source and layer membership before planning.
- A mini dataset contains only the candidate geometry plus the topology needed by the operation.
- Mapshaper performs the geometric calculation on the isolated dataset.
- The result is translated back to the live dataset through an undoable command rather than by replacing unrelated state.
- Selection changes are committed with geometry changes and restored by undo.
- Planning validates all allocations and geometry requirements before the command mutates live data.

## Consequences

The operation path is more deliberate than a direct mapshaper command, but unrelated layers remain stable and failures do not leave partial mutations. New selection-driven operations should reuse the same isolation and command boundary instead of introducing another whole-dataset shortcut.
