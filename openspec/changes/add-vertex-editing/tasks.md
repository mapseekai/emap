# Tasks: Add Vertex Editing

## Ordered Task List

### Phase 1: Overlay Canvas Infrastructure

1. **Add overlay canvas to Emap class** (`src/map/map.ts`)
   - Create `_overlayCanvas: HTMLCanvasElement` positioned absolutely above `_canvas`
   - Create `_overlayCtx: CanvasRenderingContext2D`
   - Add `clearOverlay(): void` public method
   - Add `_editMode: 'none' | 'vertex'` state
   - Handle resize: update overlay canvas dimensions in `_updateSize()`

2. **Add `drawVertexDots()` to CanvasPainter** (`src/renderer/canvas-painter.ts`)
   - Add `drawVertexDots(canvas: HTMLCanvasElement, transform: Transform, shapes: any[], arcs: any, style: VertexDotStyle): void`
   - Draw all vertices as small filled circles (radius ≈ 3px × devicePixelRatio)
   - Draw hover vertex as larger circle (radius ≈ 6px) in highlight color
   - Reuse the same half-pixel snapping as existing arc drawing

### Phase 2: VertexEditControl

3. **Create `VertexEditControl`** (`src/ui/vertex-edit-control.ts`)
   - Implements `Control` interface (`onAdd(map)`, `onRemove(map)`)
   - Creates a button element (`✏ Edit`) with CSS class `emap-edit-btn`
   - On add: attaches `mousemove`, `mousedown`, `mousemove`, `mouseup` listeners to `map.getCanvasContainer()`
   - Tracks state: `_active`, `_hoveredFeature`, `_hoverVertexIndex`, `_dragging`

4. **Implement hover logic in VertexEditControl**
   - On `mousemove` (not dragging):
     - Call `map.queryRenderedFeatures([x, y])` → get first polygon/polyline hit
     - Get arcs from source's `getArcs()`
     - Find nearest vertex using `mapshaper.internal.findNearestVertices()`
     - Compute pixel distance; if < 10px → set `_hoverVertexIndex`
     - Draw vertex dots via `CanvasPainter.drawVertexDots()` on overlay canvas

5. **Implement drag logic in VertexEditControl**
   - On `mousedown` (if `_hoverVertexIndex >= 0`): set `_dragging = true`, stop pointer capture
   - On `mousemove` (dragging):
     - `map.unproject(x, y)` → data-space coords
     - `mapshaper.internal.snapVerticesToPoint([vertexId], p, arcs)` to update display coords
     - Re-draw vertex overlay
   - On `mouseup` (dragging):
     - Commit: write display coords back to source arcs
     - Fire `map.fire('vertex_moved', payload)`
     - Call `map.render()` to repaint main canvas
     - Set `_dragging = false`

6. **Add edit mode guard for pan** (`src/map/map.ts`)
   - Modify `_onMouseDown` to skip drag-pan when `_editMode === 'vertex'`
   - Add `setEditMode(mode: 'none' | 'vertex'): void` public method

### Phase 3: Toolbar UI

7. **Create `EditToolbar`** (`src/ui/edit-toolbar.ts`)
   - A `Control` that renders a small toolbar div
   - Creates and manages `VertexEditControl` internally
   - Handles button active/inactive styling

8. **Add CSS styles** (`src/ui/controls.css`)
   - `.emap-edit-btn` base, `:hover`, `.active` states
   - Cursor styles: `cursor: crosshair` on canvas container when edit mode is active

### Phase 4: Testing & Validation

9. **Create example HTML** (`test/examples/vertex-editing.html`)
   - Load a GeoJSON source
   - Add `EditToolbar` to the map
   - Show a `vertex_moved` event log in the page

10. **Manual verification checklist** (see Verification Plan below)

## Dependencies

- Task 1 must complete before tasks 3–6 (overlay canvas infrastructure)
- Task 2 must complete before task 5 (drawVertexDots needed for hover)
- Tasks 3–5 parallelizable internally; task 6 can be done alongside
- Task 7 wraps task 3 (depends on VertexEditControl existing)
- Task 9 integrates everything (depends on tasks 1–8)

## Verification Plan

### Manual Test Steps (test/examples/vertex-editing.html)

1. Open `test/examples/vertex-editing.html` in a browser (via local dev server or `file://`)
2. A map with GeoJSON data should render
3. Click "✏ Edit" button → button should highlight; cursor should become crosshair over features
4. Move mouse over a polygon → vertex dots should appear as small circles
5. Move mouse close to a specific vertex → it should highlight with a larger dot
6. Drag that vertex to a new position → shape should update in real time
7. Release → check the event log shows `vertex_moved` with correct coordinates
8. Click "✏ Edit" again → edit mode off, overlay cleared, pan works normally
9. Verify pan does NOT work while in edit mode (mouse drag should not pan map)
