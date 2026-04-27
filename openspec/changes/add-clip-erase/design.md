## Context
Up to now, every emap edit has been a localized mutation: a vertex moves, a feature is appended, a feature is removed. Clip and erase are a different beast — mapshaper rewrites the whole arcs table (intersection cuts can add or remove vertices), the target layer's `shapes` are wholesale replaced, and feature ids may no longer correspond to anything that existed before. This proposal pins down the **dataset-replace pattern** so all later L2 ops (`dissolve`, `mosaic`, `union`, `buffer`, `simplify`, …) drop into the same scaffolding.

## Goals / Non-Goals
- Goals
  - One-line `Emap.clipLayer(opts)` / `eraseLayer(opts)` API matching mapshaper's CLI shape.
  - Outputs are byte-equivalent to running the same mapshaper CLI command (we *are* that pipeline).
  - Operation is reversible via standard undo/redo.
  - The runner is generic enough that `dissolve` etc. just supply a different command string.
- Non-Goals
  - Cross-source clipping / erasing. mapshaper's command pipeline runs on one dataset's catalog; combining two emap sources requires a merge step that is out of scope for v1.
  - Bbox-based shortcuts (`-clip bbox=...`). v1 always references a polygon mask layer.
  - Per-feature clipping. v1 clips a whole layer by a whole mask layer — same as the CLI.

## Decisions

- **Decision: deep snapshot via `mapshaper.internal.copyDataset` before running the command.**
  - Rationale: `cmd.clipLayers` mutates the input dataset in place (see `mapshaper/src/commands/mapshaper-clip-erase.mjs:43`, `clipLayersInPlace`). To undo, we need a stable snapshot of the prior state. mapshaper exposes `copyDataset` (`mapshaper-dataset-utils.mjs:79`) which clones layers and copies arcs via `arcs.getFilteredCopy()`. That is the same primitive mapshaper uses internally for its own undo-style operations, so the snapshot is byte-equivalent to a full reload.
  - Memory cost: O(dataset). For typical interactive datasets (thousands of features, hundreds of MB max) this is acceptable. For multi-GB datasets a future optimisation could store the inverse delta only, but `copyDataset` is the right starting point.

- **Decision: hold the mutated original as `after`; do not deep-clone it.**
  - Rationale: after `runParsedCommands` completes, the source's `_dataset` reference is the mutated object. We hold a second reference in the command's `after`. On undo, we swap to `before`; on redo, swap back to `after`. Two refs in memory, one swap per direction — O(1) at undo time.

- **Decision: dataset-replace clears the prior history (history barrier).**
  - Rationale: existing commands (e.g., `VertexMoveCommand`, `FeatureCreateCommand`) close over specific arc / layer object references that came from the *old* dataset. After the swap they would point at orphaned objects; their `undo()` would either silently mutate the wrong data or throw. Wiping the history before pushing the dataset-replace command makes the boundary explicit: the user can undo *the clip* itself, but not edits that happened before it. This matches Photoshop's "Flatten" / Illustrator's "Pathfinder" UX — the destructive op is the new origin of the undo timeline.
  - Future work: tag each command with a "data version" and skip-or-rewrite older commands across the boundary. Out of scope for v1.

- **Decision: clear the selection on success.**
  - Rationale: selection is `{ source, layer, id }`. After clipping, layer ids may be the same but feature ids inside that layer almost certainly are not (the clip can split, drop, or re-order shapes). A stale selection would point at random features. Clearing is conservative and predictable.

- **Decision: same-source-only for v1.**
  - Rationale: mapshaper's command runner operates on one dataset's catalog. Supporting cross-source masks would require a temporary "import the other source's polygon layer into this dataset" step, plus careful cleanup. That's a future `add-cross-source-ops` proposal — does not block clip/erase for the common case where target and mask come from the same input file.

- **Decision: build mapshaper commands as quoted strings rather than calling `cmd.clipLayers` directly.**
  - Rationale: keeps the runner generic. `_runDatasetCommand(sourceId, cmd, label)` doesn't care whether the command is `-clip`, `-erase`, `-dissolve`, or `-buffer`. Only the wrapper builds the string. This is what mapshaper's CLI does too, so command syntax stays identical between emap calls and the documented mapshaper reference.

## Risks / Trade-offs

- **Risk: `copyDataset` is mapshaper-internal and could change shape in a future version.**
  - Mitigation: same risk profile as every other `internal.*` we already depend on. Pinned in `mapshaper.d.ts`; a version upgrade test would catch a removal or signature change.

- **Risk: an in-flight async clip and another edit racing.**
  - Mitigation for v1: the operation is atomic from the user's POV (await before next click). The runner does not artificially serialize concurrent calls; if a caller fires two clips before the first resolves, the second snapshots a partially-mutated dataset and the result is undefined. Document that `clipLayer` / `eraseLayer` should be awaited; revisit only if a real use-case demands queueing.

- **Trade-off: the "history barrier" loses the prior undo chain.**
  - Acceptable: a clip is a destructive op and most editors mark them as such. A user who wants to keep their fine-grained drag history should clip last, not first. Documented in the public JSDoc.

## Migration Plan
None. Additive change. Existing commands continue to work; the `historychange` listener on `HistoryControl` automatically reflects the post-clip state because we fire the event after the swap.

## Open Questions
- Should `_runDatasetCommand` be a public method? Defer — exposing it invites callers to hand-craft mapshaper command strings, which couples public API to internal command syntax. Keep it private; expose it only through typed wrappers (`clipLayer`, `eraseLayer`, future `dissolveLayer`, …).
