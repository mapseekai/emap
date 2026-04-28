## 1. Implementation
- [x] 1.1 New `src/ui/lasso-select-control.ts`. Constructor options `{ layers?, style?, dragThreshold? }`. Default style stroke `#0078ff`, fill `rgba(0, 120, 255, 0.1)`, stroke-dasharray `4 3`, drag threshold 4 px.
- [x] 1.2 Lifecycle:
  - `onAdd(map)`: stash map, create `<svg>` overlay (with one `<polyline>` child) appended to `map.getCanvasContainer()` — display: none initially. Register mousedown on the canvas container that fires only for `shiftKey && button === 0 && enabled`. Bind mousemove + mouseup to `window`.
  - `onRemove()`: unbind, remove overlay, clear refs.
- [x] 1.3 Drag logic:
  - mousedown: capture pixel position, init path, show overlay.
  - mousemove: append pixel point; update polyline `points` attribute.
  - mouseup:
    - If path length < 3 OR diagonal < threshold, hide overlay + bail.
    - Close path (push start as last point).
    - Compute bbox; `map.queryRenderedFeatures(bbox)` → candidates.
    - For each candidate, get representative pixel via a `featureRepresentativePixel` helper that walks the source's arc collection (first arc, first vertex for paths; point itself for points). Test ray-cast point-in-polygon.
    - Dedupe surviving refs by `source|layer|id`. Compute mode from modifier keys. Call `map.select(refs, { mode })`.
    - Hide overlay.
- [x] 1.4 `enable()` / `disable()` / `isEnabled()`.
- [x] 1.5 Re-export `LassoSelectControl` and `LassoSelectControlOptions` from `src/index.ts`.
- [x] 1.6 Add `.emap-lasso-select` CSS in `src/ui/controls.css`.

## 2. Helpers
- [x] 2.1 Module-private `pointInPolygon(point, polygon)` using even-odd ray-casting.
- [x] 2.2 Module-private `featureRepresentativePixel(map, ref): [number, number] | null`. Walks the source's dataset to find the feature's first vertex (or point); converts to pixel space via the viewport transform.

## 3. Tests
- [x] 3.1 `src/ui/lasso-select-control.test.ts` — JSDOM:
  - shift+drag along a path of 4+ points selects features whose first-vertex is inside the lasso polygon (with mocked map.queryRenderedFeatures + map.getSource fixture).
  - Path with < 3 points is no-op.
  - Tiny drag below threshold is no-op.
  - Plain (non-shift) mousedown does NOT trigger.
  - Modifier conventions: shift+ctrl → 'add', shift+alt → 'toggle'.
  - Dedupe across visible layers.
  - `disable()` makes shift+drag a no-op.
  - The point-in-polygon helper itself: a simple square polygon, points clearly in/out.

## 4. Example
- [x] 4.1 `test/examples/lasso-select.html`:
  - Loads a polygon dataset.
  - Two toolbar buttons: "矩形选择 (Box)" / "套索选择 (Lasso)" — toggle which tool is active by enable()/disable() pairing.
  - Header shows current tool + selection count.

## 5. Validation
- [x] 5.1 `npm test` — all tests pass.
