# Change: Add `LassoSelectControl` — free-form polygon feature selection

## Why
`BoxSelectControl` (`add-box-select`) gives users axis-aligned rectangular selection. That's necessary but not sufficient — real editing workflows include "select all parks along this curving river" or "exclude this notch from the selection", where a freeform path is the natural gesture. Every GIS app, every design tool, every selection-oriented UI ships both rect AND lasso.

Lasso also lets users avoid features they don't want — a rectangle drag will always grab everything inside its bbox; a lasso lets the user trace around obstacles.

## What Changes
- New `LassoSelectControl` (`src/ui/lasso-select-control.ts`):
  - Implements the `Control` interface; returns a 0×0 anchor; appends an absolutely-positioned `<svg>` containing a `<polyline>` to the map's canvas container as the visible drawing.
  - Same activation gesture as `BoxSelectControl`: shift+drag.
  - Same modifier conventions:
    - shift only → mode `'replace'`
    - shift + ctrl/meta → mode `'add'`
    - shift + alt → mode `'toggle'`
  - Path is recorded in pixel coordinates as the user drags. On mouseup:
    1. Reject paths shorter than 3 points or with a tiny pixel diagonal (default 4 px) — same threshold idea as BoxSelect.
    2. Close the polygon (append starting point).
    3. Compute axis-aligned bbox; call `map.queryRenderedFeatures(bbox)` for candidates.
    4. For each candidate, look up a representative pixel (first arc's first vertex for path features; the point itself for point features) via a small helper that walks the source's arc collection.
    5. Ray-cast point-in-polygon against the lasso path.
    6. Dedupe surviving refs by `source|layer|id` and call `map.select(refs, { mode })`.
  - `enable()` / `disable()` / `isEnabled()` for runtime tool switching with `BoxSelectControl`.
  - Constructor options: `{ layers?: string[], style?: { stroke?, strokeWidth?, fill? }, dragThreshold?: number }`.

- Re-export `LassoSelectControl`, `LassoSelectControlOptions` from `src/index.ts`.
- Add `.emap-lasso-select` CSS in `src/ui/controls.css`.
- Add `test/examples/lasso-select.html` showing rect-vs-lasso tool switching via two toolbar buttons.

## Impact
- Affected specs: `box-select` (modified — extended with two new requirements covering Lasso and tool coexistence).
- Affected code:
  - `src/ui/lasso-select-control.ts` — new
  - `src/ui/lasso-select-control.test.ts` — new (JSDOM-based)
  - `src/ui/controls.css` — small style block
  - `src/index.ts` — re-exports
  - `test/examples/lasso-select.html` — new example
- Reuses `Emap.queryRenderedFeatures(bbox)` and `Emap.select`. No new infrastructure on the Emap side.

## Notes
- **Why first-vertex test, not centroid**: centroid computation requires walking every vertex of every arc the feature uses — O(n) per feature, expensive on large datasets. First-vertex is O(1) and matches user intuition for typical small features. For long thin polygons whose first vertex sits outside the lasso, this misses them; documented limitation. v2 can add an opt-in centroid mode.
- **Why ray-cast in pixel space**: the lasso polygon and feature pixel positions are both already in the same coordinate system; no need to invert through the viewport transform. Self-intersecting lassos give standard ray-cast results (inside/outside per even-odd rule) which usually matches user intuition.
- **Coexistence with BoxSelectControl**: both consume shift+drag. The pool decision is "install one OR call `disable()` on the other when you want the active tool to switch". The example HTML demonstrates the pattern.
- **DragPanHandler unchanged**: the shift-skip already landed in `add-box-select`. Lasso piggy-backs on it.
- **Path resolution**: every mousemove appends a new pixel point; for fast/long drags this can grow to thousands of points. Not a perf issue for the SVG render (browsers handle this fine) but the point-in-polygon test scales O(path-length × candidates). Worst-case ~few-million ops, sub-second on modern CPUs. If profiling shows this dominating, we can subsample the path before testing.
