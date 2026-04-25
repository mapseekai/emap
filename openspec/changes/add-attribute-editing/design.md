## Context
emap had no write side for attributes. `queryRenderedFeatures` exposes properties read-only; the editor had no way to fix a typo, fill a missing value, or restructure a layer's columns. This proposal adds the missing third side (geometry create / delete / mutate already exists; attribute write closes the loop) without going through mapshaper's command pipeline.

## Goals / Non-Goals
- Goals
  - Five small synchronous methods covering ~95% of attribute editor needs.
  - Each operation is one undo entry that composes with vertex / draw / delete commands in the same timeline (NOT a history barrier).
  - Memory cost proportional to the change, not the dataset size.
- Non-Goals
  - Expression-based mass updates (mapshaper's `-each "newField = pop / area"`). That is a future `add-attribute-expressions` proposal that DOES go through `_runDatasetCommand` because expression results can be unpredictable in size.
  - Field type coercion (string → number etc). emap stores whatever JS values the caller passes. Type validation is the embedder's responsibility.
  - Bulk multi-feature property writes (e.g., "set field=X for selected features"). Trivially composable in user code with `selection.getAll().forEach(ref => map.setFeatureProperty(ref, ...))` and `pushCommand` of a `CompositeCommand`. Adding a dedicated method is cosmetic.

## Decisions

- **Decision: direct in-place mutation, not `_runDatasetCommand`.**
  - Rationale: attribute writes never change geometry, never invalidate prior commands' captured indices, never re-cut arcs. They are the cheapest possible edit. Going through the dataset-replace runner would force a deep `copyDataset`, clear the history, and break composition with vertex edits — for no benefit.

- **Decision: single-feature property writes use a sparse `prev` / `next` patch, not full record snapshots.**
  - Rationale: a record can carry dozens of fields. A typo fix on `name` should record one byte of "before", not the whole row. The patch shape mirrors the diff shape `Selection` already uses for `selectionchange`.

- **Decision: "missing key in patch" means "key should not exist".**
  - Rationale: `Record<string, unknown>` has two failure modes for round-trip — accidentally writing `undefined` and accidentally deleting a key the user had set to `undefined` deliberately. Using key-presence (rather than `=== undefined`) as the sentinel makes both directions of the round-trip lossless.

- **Decision: field-level commands snapshot what they actually changed, not the whole table.**
  - `FieldAddCommand` only undoes the records where the key was newly added (skips records that already had the key — `do()` is a no-op for those, so `undo()` should leave them alone).
  - `FieldRemoveCommand` snapshots per-record values in a `Map<index, value>` so missing keys (records that didn't have the field) are not "restored" with `undefined`.
  - `FieldRenameCommand` reverses each record exactly. If a record had no `from` key it stays untouched in both directions.

- **Decision: `renameField` refuses on collision.**
  - Rationale: if any record already has the destination key, renaming would silently overwrite. We return `false` and push nothing. The caller can choose to `removeField(to)` first.

- **Decision: methods schedule a render after success.**
  - Rationale: highlight / selection styling can depend on attribute values via user-provided color expressions in future. A re-render is cheap; rendering only on geometry changes would be a footgun for downstream consumers.

- **Decision: NOT a history barrier.**
  - Attribute writes don't replace the dataset, don't shift feature ids, don't cut arcs. Prior `VertexMoveCommand`, `FeatureDeleteCommand`, etc. continue to refer to valid layer / arc objects. Composing them in one undo timeline is safe and is the whole point of using small commands.

## Risks / Trade-offs

- **Risk: a future op renames a field via the dataset-replace pipeline (`-rename-fields` for cross-layer rename) and an in-flight `FieldRenameCommand` references the old name.**
  - Mitigation: dataset-replace clears history before pushing itself (existing barrier behaviour). The new field-level commands can't outlive a dataset-replace.

- **Trade-off: `setFeatureProperty(ref, key, undefined)` is interpreted as "delete this key", not "set to undefined".**
  - Acceptable: matches the conventional GeoJSON / mapshaper behaviour where `properties: { name: undefined }` round-trips as `properties: {}`. Documented in the JSDoc.

## Migration Plan
None. Additive change. Existing read-side APIs (`queryRenderedFeatures`, `feature.properties`) keep their shape — they always returned a snapshot and continue to do so.

## Open Questions
- Should `setFeatureProperty` accept the `RenderedFeatureAttributes` shape directly (which carries a `properties` object)? Yes — `RenderedFeatureAttributes` extends `FeatureRef` structurally, so it works without conversion. Documented in JSDoc; no code change needed.
