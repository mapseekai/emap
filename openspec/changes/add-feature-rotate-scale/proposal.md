# Change: Add `rotateSelected` / `scaleSelected` via a general affine command

## Why
`translateSelected` covers one-third of the standard 2D editor transform set; rotate and scale are the other two. Every desktop GIS / vector editor offers all three. This proposal adds them via a general 2x3 affine matrix command — the same primitive can later support shear or arbitrary user-supplied matrices.

## What Changes
- Add `FeatureAffineCommand` (`src/edit/commands/feature-affine.ts`): records a 2x3 affine matrix `[a, b, c, d, tx, ty]` plus the same `arcIds` / `pointFeatures` shape `FeatureTranslateCommand` uses. `do()` applies the matrix in place; `undo()` applies the analytically computed inverse matrix.
- Add small matrix helpers in the same file: `rotateMatrix(angleRad, ox, oy)`, `scaleMatrix(sx, sy, ox, oy)`, `invertMatrix(m)`. Tested in isolation.
- Add `Emap.rotateSelected(angleDegrees, origin?): boolean` and `Emap.scaleSelected(sx, sy?, origin?): boolean`. Both walk the current selection (same grouping logic as `translateSelected`), build a `FeatureAffineCommand` per source, wrap in a `CompositeCommand` for multi-source, and execute synchronously.
- `origin` defaults to the **bounding-box centroid of the affected vertices** — the natural "rotate / scale around the centre of what I picked" expectation. Callers can override.
- `scaleSelected(sx)` (one arg) → uniform scale `(sx, sx)`; `scaleSelected(sx, sy)` → non-uniform.
- Re-export `FeatureAffineCommand`, `AffineMatrix` from `src/index.ts`.
- Add `test/examples/feature-rotate-scale.html` showing select + arrow keys to nudge, `[` `]` to rotate, `+` `-` to scale.

## Impact
- Affected specs: `feature-rotate-scale` (new capability)
- Affected code:
  - new: `src/edit/commands/feature-affine.ts`, `src/edit/commands/feature-affine.test.ts`
  - modified: `src/map/map.ts` (two new public methods + a centroid helper), `src/map/map.test.ts` (new integration tests), `src/index.ts` (re-export)
  - new: `test/examples/feature-rotate-scale.html`
- No public API breaks. `FeatureTranslateCommand` and `translateSelected` continue to work unchanged.

## Notes

### Matrix convention
A 2x3 matrix `{ a, b, c, d, tx, ty }` applied as:
```
x' = a*x + c*y + tx
y' = b*x + d*y + ty
```

Same convention as SVG / Canvas `transform()`. Inverse is computable analytically:
```
det = a*d - b*c
inv = {
  a:  d/det, b: -b/det,
  c: -c/det, d:  a/det,
  tx: (c*ty - d*tx)/det,
  ty: (b*tx - a*ty)/det
}
```
(For pure rotate / scale matrices `det != 0`.)

### Inherited limitation from translate
Same shared-arc caveat applies: rotating / scaling a selection that shares arcs with unselected neighbours will distort those neighbours. Documented in the spec; long-term fix is the same `add-arc-cut-on-translate`-style infrastructure.

### Why a new command class instead of reusing `FeatureTranslateCommand`
`FeatureTranslateCommand` is already shipped public API with passing tests; refactoring it to be matrix-shaped would risk regressions for no functional benefit. The two classes share ~30 lines of vertex-walking logic but have different storage shapes (offset pair vs full matrix). Future cleanup can unify if it ever becomes a pain.
