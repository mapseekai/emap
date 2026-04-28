# Change: Add `splitLayer` — partition a layer into multiple layers by field/expression

## Why
Inverse of `mergeLayers`: take one layer with a categorical field (e.g. `STATE`, `category`, `class`) and produce one output layer per distinct value. Common workflows:
- Per-state extraction from a national dataset.
- Per-feature export when each feature needs its own file.
- Pre-step before per-category styling.

mapshaper's `-split` is the canonical command. The output layer names are derived from the field value (or from the JS expression result).

## What Changes
- Add `Emap.splitLayer({ source, target, expression, noReplace? }): Promise<boolean>` in `src/map/map.ts`.
- Build `-target "<target>" -split <expression> [no-replace]` and delegate to `_runDatasetCommand`.
- Validate that the source resolves and `target` resolves to a layer in it; `expression` must be a non-empty string (either a bare field name or a JS expression).
- Add `SplitLayerOptions` interface; re-export from `src/index.ts`.
- Add `test/examples/split-layer.html` — file upload, target select, expression input, "拆分" button.

## Impact
- Affected specs: `split-layer` (new capability)
- Affected code: `src/map/map.ts`, `src/map/map.test.ts`, `src/index.ts`, new example
- No new infrastructure.

## Notes
- Bare field name vs JS expression: mapshaper auto-detects — if the string is a valid field reference it's used as-is; otherwise it's evaluated as JS. We pass through verbatim and let mapshaper decide.
- v1 omits the `apart` flag (saves outputs to independent **datasets**, not layers). That conflicts with emap's "one source = one dataset" model and would require new infrastructure to surface the new datasets as additional sources.
- v1 omits the `ids` numbers list (used internally by mapshaper's GUI to split on a manually-chosen feature subset).
- Expressions with shell-special characters: we quote the expression argument to survive `splitShellTokens`.
