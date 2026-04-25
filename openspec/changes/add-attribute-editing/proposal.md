# Change: Add attribute (data table) editing

## Why
emap can already read feature properties via `queryRenderedFeatures` / `RenderedFeatureAttributes`, but every existing edit op touches geometry only. Attribute editing is the missing third side of the editor (alongside vertex editing and feature creation/deletion). Closing it makes emap a complete CRUD editor: read, write, undo, export.

This proposal stays deliberately on the **lightweight** path — direct in-place mutation of `layer.data.getRecords()` with small command snapshots. We do NOT wrap mapshaper's `-each` / `-filter-fields` / `-rename-fields` via `_runDatasetCommand` because:
- Attribute writes are O(records) at most, do not change geometry, and never invalidate prior commands.
- The dataset-replace path is a history barrier; we want attribute edits to compose freely with vertex edits, draws, and deletes in one undo timeline.

## What Changes

### Single-feature property writes
- `Emap.setFeatureProperty(ref, key, value)` — set or overwrite one key on one feature.
- `Emap.setFeatureProperties(ref, props)` — set multiple keys on one feature in a single history entry.
- Both push a `FeaturePropertyChangeCommand` that captures only the diff (changed keys' previous values + the new values), so memory usage is proportional to the patch size, not the record size.

### Field-level (schema) operations
- `Emap.addField({ source, target, field, defaultValue? })` — add a new column to every record in the layer; default is `null`.
- `Emap.removeField({ source, target, field })` — drop a column; snapshot all per-record values for undo.
- `Emap.renameField({ source, target, from, to })` — rename a column on every record.
- Each pushes a small dedicated command class (`FieldAddCommand`, `FieldRemoveCommand`, `FieldRenameCommand`).

### Behaviour
- All five methods are **synchronous** and return `boolean` — no Promise, no mapshaper command pipeline.
- On success they push exactly one history entry, fire `historychange`, and schedule a re-render (selection styling can depend on properties).
- They do not clear the selection — feature ids are unaffected.
- They are NOT a history barrier; they compose with vertex / draw / delete commands in a single undo timeline.

## Impact
- Affected specs: `attribute-editing` (new capability)
- Affected code:
  - new: `src/edit/commands/feature-property-change.ts`, `src/edit/commands/field-add.ts`, `src/edit/commands/field-remove.ts`, `src/edit/commands/field-rename.ts`, plus tests
  - modified: `src/map/map.ts` (five new public methods), `src/index.ts` (re-exports)
  - new: `test/examples/attribute-editing.html`
- No public API breaks.
