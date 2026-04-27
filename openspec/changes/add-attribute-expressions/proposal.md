# Change: Add `applyExpression` — bulk attribute updates via JS expressions

## Why
The lightweight attribute-editing methods (`setFeatureProperty`, `addField`, `removeField`, `renameField`) cover per-feature and per-field structural changes. They do not cover **expression-based bulk updates** like:

- `density = pop / area` (compute a derived field across every record)
- `name = name.toUpperCase()` (normalize an existing field)
- `state_fips = CNTY_FIPS.substr(0, 2)` (parse a substring out)

mapshaper has exactly the right command for this: `-each "expr"`. This proposal wraps it through the existing `_runDatasetCommand` runner so users get the full power of mapshaper's expression engine with one method call.

## What Changes
- Add `Emap.applyExpression({ source, target, expression, where? }): Promise<boolean>` that builds the mapshaper command `-target "<TARGET>" -each "<EXPR>" [where="<WHERE>"]` and delegates to `_runDatasetCommand`.
- `expression` is mapshaper's standard per-feature JS expression: `this.foo = ...`, multiple comma-separated assignments, calls to mapshaper's built-in feature context (`this.id`, `this.area`, `this.bounds`, etc.).
- Optional `where` is a filter expression — only records matching it are mutated. Mirrors mapshaper CLI's `-each EXPR where=...`.
- Add `ApplyExpressionOptions` interface in `src/map/map.ts`; re-export from `src/index.ts`.
- Add `test/examples/attribute-expressions.html`.

## Impact
- Affected specs: `attribute-expressions` (new capability)
- Affected code: `src/map/map.ts` (one new public method), `src/map/map.test.ts` (new integration tests), `src/index.ts` (re-export), new example
- No new commands files, no new helpers. Pure runner-reuse.

## Notes — relationship to `add-attribute-editing`
- `setFeatureProperty` / `setFeatureProperties` mutate **one** record at a time on the lightweight in-place path. Composes with vertex/draw/delete commands in one undo timeline.
- `applyExpression` runs across **every** record (or filtered subset), and does so via mapshaper's expression engine — which can change record count (mapshaper's `-each` doesn't add/remove records, but in principle the runner is robust to that). Routes through `_runDatasetCommand`, so it inherits the dataset-replace history barrier.
- The two methods are complementary: pick the per-record one for tiny edits inside an editing session, pick the bulk one when you want power and accept that prior fine-grained history will be cleared.
