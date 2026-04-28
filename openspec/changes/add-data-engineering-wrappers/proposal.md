# Change: Data-engineering wrapper batch — drop / sort / uniq / filter-fields / rename-fields

## Why
Five thin mapshaper-command wrappers that round out the editor's data-engineering surface. None individually warrants a standalone proposal; together they're the housekeeping kit users reach for after edits but before export:

| Command | Use case |
|---|---|
| `-drop` | Delete a single layer in place |
| `-sort` | Reorder features by a JS expression (controls render order, export order) |
| `-uniq` | Drop duplicate features by an id expression |
| `-filter-fields` | Keep / drop attribute columns en masse before export |
| `-rename-fields` | Bulk-rename multiple attribute fields in one command |

All five share the dataset-replace runner, the `-target` convention, and the OpenSpec proposal pattern of every other wrapper we've shipped.

## What Changes
- Five new public methods on `Emap`:
  - `dropLayer({ source, target }): Promise<boolean>` — `-target "T" -drop`
  - `sortFeatures({ source, target, expression, descending? }): Promise<boolean>` — `-target "T" -sort "<expr>" [descending]`
  - `uniqueFeatures({ source, target, expression, maxCount?, invert? }): Promise<boolean>` — `-target "T" -uniq "<expr>" [max-count=N] [invert]`
  - `filterFields({ source, target, fields, invert? }): Promise<boolean>` — `-target "T" -filter-fields "f1,f2" [invert]`
  - `renameFields({ source, target, mapping }): Promise<boolean>` — `-target "T" -rename-fields "old=new,old2=new2"`
- Five corresponding option interfaces; re-exported from `src/index.ts`.
- One example HTML covering all five in a tabbed interface (`test/examples/data-engineering.html`).

## Impact
- Affected specs: `data-engineering` (new capability)
- Affected code:
  - `src/map/map.ts` — five new methods + five interfaces
  - `src/map/map.test.ts` — one describe block per command
  - `src/index.ts` — re-exports
  - `test/examples/data-engineering.html`
- No new infrastructure. Reuses `_runDatasetCommand` and `quoteMapshaperArg`.

## Notes
- **`dropLayer` scope**: mapshaper's `-drop` is multi-modal (layer / geometry / holes / fields). v1 wraps only the "drop the entire layer" mode — the most common interpretation. The other modes are reachable via existing methods (`filterFields` for fields drop) or are niche (drop holes / drop geometry only).
- **`renameFields` mapping**: accepts a `Record<string, string>` (TS-friendly) and serializes to `old=new,old2=new2`. Keys with `,` or `=` are rejected up-front to avoid ambiguous serialization.
- **`uniqueFeatures` `expression`**: mapshaper's `-uniq` requires an id expression — there is no "all fields equal" mode. Users wanting full-record dedupe should pass `'JSON.stringify(this.properties)'`.
- **`filterFields` empty list**: `fields: []` returns `false` (a no-op `-filter-fields` would silently drop everything via mapshaper's `*` semantics). Use `fields: ['*']` explicitly for "drop all".
- **`sortFeatures` ordering**: defaults to ascending (mapshaper default). `descending: true` is the only inversion option exposed; `ascending` (the deprecated explicit form) is omitted.
