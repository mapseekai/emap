# Change: Add `BoxSelectControl` — shift+drag rubber-band feature selection

## Why
Selection-driven edit ops (`translateSelected`, `rotateSelected`, `scaleSelected`, `mergeSelected`, `deleteSelected`) currently require **clicking features one at a time**. Realistic editing workflows need batch selection — a 30-state translate or a multi-feature dissolve is unworkable through individual clicks.

Mapshaper's GUI uses **shift+drag** for box-select; same convention as Photoshop / Figma / every selection tool the user has touched. The corresponding spatial query primitive `queryRenderedFeatures(bbox)` already exists in emap; what's missing is the UI control that wires shift+drag → bbox query → `Selection.apply`.

## What Changes
- **Tweak `DragPanHandler`**: skip mousedown events with `e.shiftKey === true`. This frees shift+drag for higher-level controls without the controls needing to know about `DragPanHandler`.
- **New `BoxSelectControl`** (`src/ui/box-select-control.ts`):
  - Implements the `Control` interface (returns a 0×0 anchor element; the visible overlay is appended directly to the map's canvas container).
  - On shift+mousedown inside the canvas container, captures pointer and starts drawing a rubber-band rectangle.
  - During drag, updates the rectangle's pixel rect every mousemove.
  - On mouseup: converts the pixel bbox to map-space coordinates, calls `map.queryRenderedFeatures(bbox)`, dedupes to `FeatureRef[]` keyed by source/layer/id, calls `map.select(refs, mode)`. Tiny drags (< 4 px diagonal) cancel without selecting.
  - **Modifier conventions** layered on top of shift:
    - shift only → mode `'replace'`
    - shift + ctrl/meta → mode `'add'`
    - shift + alt → mode `'toggle'`
  - Constructor options: `{ layers?: string[], style?: { stroke?, strokeWidth?, fill? }, dragThreshold?: number }`.
  - Exposes `enable()` / `disable()` / `isEnabled()` for runtime toggling.
- Re-export `BoxSelectControl`, `BoxSelectControlOptions` from `src/index.ts`.
- Add CSS for the rubber-band overlay (default: 1.5 px solid `#0078ff`, 10 % fill).
- Add `test/examples/box-select.html` — load data, shift+drag to box-select, status line shows the count and selected refs.

## Impact
- Affected specs: `box-select` (new capability)
- Affected code:
  - `src/core/drag-pan-handler.ts` — 1-line skip-on-shift
  - `src/core/drag-pan-handler.test.ts` — new file with 3 unit tests
  - `src/ui/box-select-control.ts` — new file
  - `src/ui/box-select-control.test.ts` — new file
  - `src/ui/controls.css` — rubber-band style
  - `src/index.ts` — re-exports
  - `test/examples/box-select.html` — new example
- No new infrastructure. Reuses `Emap.queryRenderedFeatures` (bbox form) and `Emap.select`.

## Notes
- The DragPanHandler change is a behaviour change for existing callers — shift+drag used to pan, now it's reserved for higher-level selection. Documented as part of this proposal. The fallback for users who want shift+pan: not in scope, given the shift+drag → box-select convention is universal.
- Tiny drags below the threshold (default 4 px) fall through without dispatching a selection change. Treats accidental shift+click+jitter as no-op rather than as "select empty bbox".
- `Emap.queryRenderedFeatures(bbox)` returns one entry per (visible-layer × feature) it intersects. We dedupe by `source|layer|id` because the same feature can appear in multiple visible layers if a source has both a fill layer and a line layer for the same data.
