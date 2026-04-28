## 1. mosaicLayer
- [x] 1.1 Add `calc?: string` to `MosaicOptions` in `src/map/map.ts`.
- [x] 1.2 Append `calc=<value>` (quoted) when set, in the same parts-array build path.

## 2. snapLayer
- [x] 2.1 Add `fixGeometry?: boolean` to `SnapOptions`.
- [x] 2.2 Append `fix-geometry` flag when truthy.

## 3. dissolveLayer
- [x] 3.1 Expand `DissolveOptions` with `fields?, sumFields?, copyFields?, calc?, where?, multipart?, name?, noReplace?`.
- [x] 3.2 Refactor method body from string-concat to a parts array (matches every other wrapper).
- [x] 3.3 Validation:
  - `field` and `fields` mutually exclusive.
  - `fields[i]` / `sumFields[i]` / `copyFields[i]` filter out comma-bearing entries (consistent with `filterFields`).
  - empty `fields` array → treated as if unset.
- [x] 3.4 Token assembly:
  - When `field` set → positional bare token (existing behaviour).
  - When `fields` set → positional `a,b,c` token.
  - Optional flags / value options appended after.

## 4. cleanLayer
- [x] 4.1 Expand `CleanOptions` with the 10 new options.
- [x] 4.2 Refactor method body to parts-array pattern.
- [x] 4.3 Validation:
  - `gapFillArea` / `sliverControl` / `snapInterval` reject NaN / negative.
  - `overlapRule` rejects values outside `'min-id' | 'max-id' | 'min-area' | 'max-area'`.

## 5. Tests
- [x] 5.1 In `src/map/map.test.ts`, add test cases:
  - mosaicLayer: command shape with calc=.
  - snapLayer: command shape with fix-geometry flag.
  - dissolveLayer: each new option's emit form, mutually-exclusive `field`+`fields`, comma-bearing filter.
  - cleanLayer: each new option's emit form, invalid overlapRule rejected, negative numerics rejected.

## 6. Validation
- [x] 6.1 `npm test` passes; existing tests for the four wrappers stay green.
