# Change: complete missing options on cleanLayer / dissolveLayer / mosaicLayer / snapLayer

## Why
The mapshaper-grammar audit (`fix(map): mapshaper-grammar audit follow-ups`) identified four wrappers whose Emap option surface covers far less than what the `parser.command()` definition exposes. Users hitting the gap can't reach common workflows without dropping down to a custom mapshaper command string.

Concretely:

| Wrapper          | Exposed | Missing                                                                            |
|------------------|---------|------------------------------------------------------------------------------------|
| `cleanLayer`     | 0 / 11  | gap-fill-area, sliver-control, snap-interval, no-snap, allow-overlaps, overlap-rule, allow-empty, rewind, only-arcs, no-arc-dissolve |
| `dissolveLayer`  | 1 / 9   | fields (multi), sum-fields, copy-fields, calc, where, multipart, name, no-replace  |
| `mosaicLayer`    | 4 / 5   | calc                                                                               |
| `snapLayer`      | 3 / 4   | fix-geometry                                                                       |

All four are pure additive expansions — existing call sites continue to work because every new option is optional with the mapshaper default applied when omitted.

## What Changes

### `cleanLayer` — `CleanOptions` expanded
```ts
interface CleanOptions {
  source: string;
  target: string;
  // NEW
  gapFillArea?: number;       // gap-fill-area=N
  sliverControl?: number;     // sliver-control=N (0..1 typical)
  snapInterval?: number;      // snap-interval=N
  noSnap?: boolean;           // no-snap flag
  allowOverlaps?: boolean;    // allow-overlaps flag
  overlapRule?: 'min-id' | 'max-id' | 'min-area' | 'max-area';  // overlap-rule=X
  allowEmpty?: boolean;       // allow-empty flag
  rewind?: boolean;           // rewind flag
  onlyArcs?: boolean;         // only-arcs flag
  noArcDissolve?: boolean;    // no-arc-dissolve flag
}
```

### `dissolveLayer` — `DissolveOptions` expanded
```ts
interface DissolveOptions {
  source: string;
  target: string;
  field?: string;             // existing — single field convenience
  // NEW
  fields?: string[];          // fields=a,b,c (multi-field group-by) — mutually exclusive with `field`
  sumFields?: string[];       // sum-fields=... aggregate sum
  copyFields?: string[];      // copy-fields=... carry attributes through
  calc?: string;              // calc=... custom JS aggregation
  where?: string;             // where=... filter records
  multipart?: boolean;        // multipart flag
  name?: string;              // name= rename output layer
  noReplace?: boolean;        // no-replace flag
}
```

(Skipped: `group-points`, `weight`, `planar` — point-specific aggregation options for niche workflows. Can be added later.)

### `mosaicLayer` — `MosaicOptions` expanded
Adds a single `calc?: string` option.

### `snapLayer` — `SnapOptions` expanded
Adds a single `fixGeometry?: boolean` option mapping to mapshaper's `fix-geometry` flag.

### Validation rules (consistent across all four)
- Multi-value list options (`fields`, `sumFields`, `copyFields`) reject entries containing `,` (same comma-injection guard as the existing `filterFields` / `renameFields`).
- `dissolveLayer`: `field` and `fields` are mutually exclusive — reject if both set.
- `cleanLayer`: `overlapRule` is validated against the four known values.
- `cleanLayer`: numeric options (`gapFillArea`, `sliverControl`, `snapInterval`) reject NaN / negative.
- `mosaicLayer.calc` / `dissolveLayer.calc` / `dissolveLayer.where`: forwarded as-is (mapshaper evaluates JS at runtime, can't pre-validate).

## Impact
- Affected specs: `wrapper-options` (new shared capability tracking the option-completion contract for these wrappers).
- Affected code:
  - `src/map/map.ts` — four interface expansions, four method bodies extended.
  - `src/map/map.test.ts` — new option-token tests + validation tests for each wrapper.
- No new infrastructure. No migration needed for callers.

## Notes
- **`dissolveLayer.field` kept for backward compatibility**: removing it would break every existing example that passes a single field name. The new `fields` array works alongside; the validator rejects setting both. Future iterations could deprecate `field` once docs / examples migrate.
- **`overlapRule` enum**: matches mapshaper's described set (`min-id|max-id|min-area|[max-area]`). The `[]` brackets in mapshaper's docstring suggest `max-area` is the default; we don't pre-set a default — let mapshaper apply its own.
- **No deprecation of `cleanLayer({ source, target })` minimal call**: every new option is optional, so the existing two-arg form keeps working with mapshaper's default cleanup heuristics.
- **Field-list comma stripping vs rejecting**: existing wrappers (`filterFields`) silently drop comma-bearing entries from the list. We follow the same pattern in the new list options for consistency. A future cleanup pass could promote these to hard-rejection across the board.
