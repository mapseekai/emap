# Tasks: Fix Topological Vertex Editing

## Ordered Task List

### Phase 1: Unified Canvas Rendering

1. **Remove `_overlayCanvas` from `map.ts`**
   - Remove `_overlayCanvas` creation in constructor
   - Remove `getOverlayCanvas()` and `clearOverlay()` methods
   - Add `_editVertexState` to store hover shapes/arcs/vertex for render pipeline
   - Add `setEditVertexState(state)` and `clearEditVertexState()` methods

2. **Integrate vertex drawing into `render()` in `map.ts`**
   - After all data layers are drawn, check if `_editMode === 'vertex'` && `_editVertexState` exists
   - Call `painter.drawVertexDots(...)` on the main canvas (no separate canvas argument)

3. **Simplify `drawVertexDots` in `canvas-painter.ts`**
   - Remove the `canvas` parameter — use `this._ctx` (the main canvas context)
   - Draw vertex dots after paths in the same frame

### Phase 2: Topological Vertex Discovery

4. **Replace single-vertex tracking with multi-vertex IDs in `vertex-edit-control.ts`**
   - Replace `_hoverArcId` + `_hoverVertexIdx` with `_hoverVertexIds: number[]`
   - Replace `_findNearestVertex()` with `mapshaper.internal.findNearestVertices(p, shape, arcs)` call
   - Use `arcs.getVertex2(ids[0])` for hover coordinates

### Phase 3: Fix Drag Logic

5. **Fix `_handleDrag` to use topology-aware API in `vertex-edit-control.ts`**
   - Use `mapshaper.internal.snapVerticesToPoint(ids, [x, y], arcs)` to move all shared vertices
   - Update `_editVertexState` on the map so render pipeline draws updated dots
   - Call `map.render()` each drag frame

6. **Fix `_onMouseUp` for dragend in `vertex-edit-control.ts`**
   - Call `arcs.transformPoints(function(){})` for bbox recalculation
   - Fire `vertex_moved` event with full vertex IDs

7. **Remove overlay canvas calls from `vertex-edit-control.ts`**
   - Replace `_drawOverlay()` calls with `map.setEditVertexState({...})` + `map.render()`
   - Remove `map.clearOverlay()` calls, replace with `map.clearEditVertexState()` + `map.render()`

### Phase 4: Verification

8. **Manual verification**
   - Load polygon GeoJSON with shared boundaries
   - Drag shared node → both polygons deform together
   - Verify live repaint during drag
   - Verify vertex dots render on the same canvas as data

## Dependencies

- Phase 1 → Phase 3 (canvas changes must be done before drag logic references them)
- Phase 2 can run in parallel with Phase 1
- Phase 4 validates everything
