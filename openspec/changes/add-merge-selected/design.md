## Context
mapshaper's CLI has no first-class "merge these specific features" command — `-dissolve` always operates on a whole layer. Editor users need the per-selection variant constantly. We supply it by composing existing mapshaper primitives behind one method.

## Goals / Non-Goals
- Goals
  - One sync-feeling call (`Promise<boolean>`) that consumes the current selection and produces one merged feature.
  - Output is byte-equivalent to running the same field-discriminator + dissolve recipe through the mapshaper CLI by hand.
  - Single undoable history entry; reuses every existing primitive.
- Non-Goals
  - Cross-layer / cross-source merge — has no mapshaper equivalent and forces moving features between layers, which is a different operation.
  - Geometry-type-specific behaviour. mapshaper's `-dissolve` already handles polygon / polyline / point differently; we just pass through.
  - Custom attribute-aggregation rules (`sum-fields=area`, `calc=`). v1 uses the default `copy-fields` semantics (keep the first feature's value). Aggregation is a follow-up that fits the existing `DissolveOptions` shape.

## Decisions

- **Decision: field-discriminator + `-dissolve` + cleanup, instead of a new mapshaper internal call.**
  - Rationale: keeps every byte of the recipe inside the public mapshaper command surface. If mapshaper's dissolve semantics evolve, our merge inherits the change for free. There is no `internal.mergeSelectedFeatures` we could be calling instead.

- **Decision: discriminator field is hard-coded `__emap_merge` and removed at the end.**
  - Rationale: a constant name keeps the command string deterministic (testable). The double-underscore prefix is the standard "transient internal field" convention used by mapshaper itself (`$.id`, `$.bbox`, etc.). The `-each "delete this.__emap_merge"` pass at the end ensures the temp field never leaks into the dataset.

- **Decision: `copy-fields=` lists every original field explicitly.**
  - Rationale: without `copy-fields`, mapshaper's `-dissolve` strips all non-grouping fields (`data-aggregation.mjs:88` only writes the listed fields). Listing every field preserves attributes for both the merged group AND every unselected single-feature group (each becomes its own dissolve group with size 1).

- **Decision: merged group inherits the FIRST selected feature's attributes.**
  - Rationale: that is what mapshaper does for `copy-fields` (`data-aggregation.mjs:88`: `rec[copyFields[j]] = first[copyFields[j]]`). Surfaced unchanged so anyone familiar with the CLI gets the result they expect.

- **Decision: cross-layer selection returns `false`, not "merge per layer".**
  - Rationale: ambiguous semantics — should we merge each layer's subset separately or refuse? Refusing is cheaper and matches the principle of least surprise. Callers can iterate layers themselves if they want per-layer merges.

- **Decision: discriminator expression embeds the selected id list as a JSON array literal, not via mapshaper `-define`.**
  - Rationale: simpler — one command string, no defs to manage. The expression runs once per record at dissolve time; for a 100k-feature layer the `Array.indexOf` cost is negligible vs the dissolve itself.

## Risks / Trade-offs

- **Risk: layer name or field names contain characters that need shell-style escaping.**
  - Mitigation: same `quoteMapshaperArg` helper that clip / erase / dissolve already use. Field names in `copy-fields=A,B,C` are comma-separated; mapshaper does NOT quote individual entries there. emap rejects merges where any original field name contains a comma (extremely rare; documented as a v1 limitation).

- **Risk: dataset-replace history barrier wipes the prior fine-grained edit chain.**
  - Inherited (and acceptable) from `_runDatasetCommand`. Documented in the parent design.

- **Trade-off: result feature ids are renumbered.**
  - Acceptable — same as every other dataset-replace op. Selection is cleared on success precisely because it would point at stale ids.

## Migration Plan
None. Additive change.

## Open Questions
- Should we expose the recipe as `MergeSelectedCommand` for reuse? Defer — there is no current second caller. Building the command inline keeps the surface area minimal.
