## Context
Translation is the simplest geometric edit beyond vertex-level work — every editor has it, mapshaper does not (its `-affine` is whole-dataset, not selection-driven). We implement it directly against the in-memory data model rather than going through the heavy `_runDatasetCommand` runner: translating in place is O(vertices touched) and fully reversible by negating the offset, so the dataset-replace machinery (deep copy, history barrier, selection clear) is overkill.

## Goals / Non-Goals
- Goals
  - One synchronous call: `Emap.translateSelected(dx, dy): boolean`.
  - O(touched-vertices) cost on both `do()` and `undo()`.
  - Single undoable history entry per call. Composes freely with vertex / draw / delete / attribute commands in one timeline (NOT a history barrier).
  - Selection survives — feature ids are unchanged because we mutate geometry in place, not replace the dataset.
- Non-Goals
  - Topology-aware translation (cutting shared arcs at the selection boundary). Documented v1 limitation, tracked as a follow-up.
  - Rotate / scale. Same shape of command, different math; deferred to keep this proposal small.
  - Snap-while-drag UX. The command is the bottom layer; a UI control that calls it on mouse move belongs to a separate `add-translate-control` proposal.

## Decisions

- **Decision: lightweight in-place mutation, not `_runDatasetCommand`.**
  - Rationale: translation does not change feature count, ids, attributes, or arc layout. Going through the runner would force a `copyDataset` (typically MB), clear history, and require a render's worth of work to swap. Direct mutation costs O(vertices in the affected arcs).

- **Decision: deduplicate arc IDs across selected features (one offset per arc).**
  - Rationale: two adjacent polygons share an arc. If we naively offset every arc per feature, the shared arc would move twice. `absArcId`-based dedup ensures each arc moves exactly once, which is also the only mathematically correct outcome.

- **Decision: do NOT clear the selection on success.**
  - Rationale: ids are stable. The selected refs still point at the same features, which the user probably wants — natural for repeated nudges (multiple arrow-key presses, multiple drag steps).

- **Decision: one `FeatureTranslateCommand` per source; multi-source selections wrap them in `CompositeCommand`.**
  - Rationale: each source owns its own `ArcCollection` and `setDataset`/`refreshDisplayArcs` plumbing. Cleaner to scope each command to one source than to thread cross-source logic through one mega-command.

- **Decision: known limitation — translating a selection that shares arcs with unselected neighbours distorts those neighbours.**
  - Rationale: the "correct" behaviour requires cutting shared arcs at the selection boundary first (`internal.divideArcsAtNodes`-style). That is meaningful new infrastructure; doing it inline would balloon this proposal. Documented loudly in the proposal + spec; safe in the common cases (isolated features, contiguous polygon subsets).

- **Decision: do not require any new mapshaper internal symbols.**
  - Rationale: `arcs.getVertexData()` and `arcs.updateArcBounds(arcId)` already exist in the type stub (added by the audit pass). All point shapes live as `[[x,y]]` in `layer.shapes` — pure JS array mutation. No new dependencies.

## Risks / Trade-offs

- **Risk: arcs.updateArcBounds is missing on a future mapshaper version.**
  - Mitigation: typed in `mapshaper.d.ts` and used by other commands already (`VertexInsertCommand`'s implicit dependency via `internal.insertVertex`'s internal call). A removal would break much more than this command.

- **Risk: very large selections produce large per-command memory.**
  - The command stores `dx, dy, arcIds[], pointFeatures[]` — small fixed-size data even for a 100k-feature selection.

- **Trade-off: shared-arc distortion is unintuitive on first encounter.**
  - Mitigation: documented in proposal + spec. `add-arc-cut-on-translate` is the obvious follow-up when there is a real complaint.

## Migration Plan
None. Additive.

## Open Questions
- Should the same command class also handle rotate / scale, parameterized by a 2x3 matrix? Defer — a generic `AffineTransformCommand` is a refactor for when rotate / scale actually land; the YAGNI cost of a translate-specific class is one file.
