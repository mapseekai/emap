## 1. Single-feature property writes
- [x] 1.1 Create `src/edit/commands/feature-property-change.ts` exporting `FeaturePropertyChangeCommand`. Stores `{ layer, featureId, prev, next }` where `prev` / `next` are sparse patches (key → value; absent key means "key did not / should not exist"). `do()` and `undo()` walk the diff to set or `delete` keys on the record.
- [x] 1.2 Add `Emap.setFeatureProperty(ref, key, value): boolean`. Resolves the layer / record, builds the minimal `prev` / `next` diff, applies it, pushes a `FeaturePropertyChangeCommand`, fires `historychange`, schedules a render. Returns `false` for unresolvable refs.
- [x] 1.3 Add `Emap.setFeatureProperties(ref, props): boolean`. Same shape, but `next` is the multi-key patch. No-op (returns `false`) when every key already has the requested value.

## 2. Field-level operations
- [x] 2.1 Create `src/edit/commands/field-add.ts` exporting `FieldAddCommand`. `do()` sets `record[field] = defaultValue` on every record that does not already have the key; `undo()` deletes the key from every record where the command added it.
- [x] 2.2 Create `src/edit/commands/field-remove.ts` exporting `FieldRemoveCommand`. Snapshots each record's value at construction time (`Map<index, value>`); `do()` deletes the key from every record; `undo()` restores the snapshotted values.
- [x] 2.3 Create `src/edit/commands/field-rename.ts` exporting `FieldRenameCommand`. `do()` renames `from` → `to` on every record (preserves value, deletes old key); `undo()` reverses. Returns immediately if `from` and `to` collide on any record (we don't silently overwrite).
- [x] 2.4 Add `Emap.addField(opts)`, `Emap.removeField(opts)`, `Emap.renameField(opts)` that resolve the layer, instantiate the matching command, call `cmd.do()` once, push it onto history, fire `historychange`, schedule render. Each returns `boolean`.

## 3. Re-exports
- [x] 3.1 Re-export the four new command classes (and their option types) from `src/index.ts`.

## 4. Testing
- [x] 4.1 Add `src/edit/commands/feature-property-change.test.ts` covering: setting a new key, overwriting an existing key, deleting a key (when `next` omits one that was in `prev`), undo restores both kinds, multi-key patches, no-op patches.
- [x] 4.2 Add `src/edit/commands/field-add.test.ts` covering: adds the key with default value to every record, leaves records that already had the key untouched, undo removes only the keys this command added.
- [x] 4.3 Add `src/edit/commands/field-remove.test.ts` covering: snapshotting per-record values, removing the key, undo restoring exact prior values.
- [x] 4.4 Add `src/edit/commands/field-rename.test.ts` covering: renames on every record, undo reverses, refuses to rename when the target key already exists on any record (returns false / no-op).
- [x] 4.5 Add Emap-level integration tests in `src/map/map.test.ts` (`Emap attribute editing` describe block): each public method composes with vertex / delete commands in one history (no barrier), fires `historychange` once per call, and undo / redo round-trips preserve the original record content.

## 5. Example
- [x] 5.1 Add `test/examples/attribute-editing.html`. Loads a dataset, lets the user click a feature to open an attribute panel, edit values, click "Save", and Ctrl+Z to revert. Buttons for "Add field" / "Remove field" / "Rename field" demonstrate the schema ops.

## 6. Validation
- [x] 6.1 `npm test` — all tests pass. *(161 / 161 across 16 files.)*
