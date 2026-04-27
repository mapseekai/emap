## 1. DragPanHandler tweak
- [x] 1.1 In `src/core/drag-pan-handler.ts`, early-return from `_onMouseDown` when `e.shiftKey === true`.
- [x] 1.2 New `src/core/drag-pan-handler.test.ts`: assert plain mousedown fires `panstart` and shift-mousedown does not.

## 2. BoxSelectControl
- [x] 2.1 New `src/ui/box-select-control.ts` implementing `Control`. Constructor options `{ layers?, style?, dragThreshold? }`. Default style stroke `#0078ff`, fill `rgba(0, 120, 255, 0.1)`, drag threshold 4 px.
- [x] 2.2 Lifecycle:
  - `onAdd(map)`: stash `map`, create overlay div appended to `map.getCanvasContainer()` (display: none initially), register mousedown handler on the canvas container that fires only for `shiftKey && button === 0`. Bind mousemove + mouseup to `window` (so drag doesn't lose tracking when leaving the canvas).
  - `onRemove()`: unbind, remove overlay, clear refs.
- [x] 2.3 Drag logic:
  - mousedown: capture pixel position, show overlay sized 0×0 at start.
  - mousemove: update overlay rect.
  - mouseup:
    - If diagonal < `dragThreshold`, hide overlay and bail.
    - Else convert pixel bbox to map-space via `viewport.unproject` (or whatever the existing transform helper is — probably `map.unproject(point)` since the map already exposes that).
    - Call `map.queryRenderedFeatures([[x1,y1],[x2,y2]])` (pixel bbox; the existing API takes pixels, not map coords — matches `queryRenderedFeatures(point)`).
    - Dedupe to `FeatureRef[]` by `source|layer|id`.
    - Compute mode: shift only → `'replace'`; shift + ctrl/meta → `'add'`; shift + alt → `'toggle'`.
    - Call `map.select(refs, mode)`.
    - Hide overlay.
- [x] 2.4 `enable()` / `disable()` / `isEnabled()` toggles whether mousedown is captured at all.
- [x] 2.5 Re-export from `src/index.ts`.
- [x] 2.6 Add `.emap-box-select` CSS in `src/ui/controls.css`.

## 3. Testing
- [x] 3.1 `src/ui/box-select-control.test.ts` — JSDOM-based tests:
  - shift+mousedown + mousemove + mouseup creates one selection call with the expected bbox and `'replace'` mode.
  - Plain (non-shift) mousedown does NOT trigger box-select.
  - Below-threshold drag does NOT trigger selection.
  - Shift+ctrl mode → `'add'`; shift+alt mode → `'toggle'`.
  - Dedupe: two visible layers backed by the same source/feature → one ref in the select call.
  - `disable()` makes shift+mousedown a no-op.

## 4. Example
- [x] 4.1 Add `test/examples/box-select.html` — load data, shift+drag to box-select, header shows "已选 N 个要素" and list of refs.

## 5. Validation
- [x] 5.1 `npm test` — all tests pass.
