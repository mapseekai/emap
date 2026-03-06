# Proposal: Fix Topological Vertex Editing

## Why

Current vertex editing has three issues:
1. **No topological editing**: Only one vertex per arc is moved. Shared topological nodes (same coordinates in multiple arcs) are not updated together, causing topology breaks.
2. **No live view update during drag**: The map doesn't repaint during drag, so users get no visual feedback until mouse release.
3. **Separate overlay canvas for vertices**: Vertex dots are drawn on a separate `_overlayCanvas` above the main canvas. Mapshaper draws vertices on the same canvas as the data layer (via `drawStyledLayerToCanvas` → `drawVertices()`). Using a separate canvas causes visual inconsistencies and added complexity.

## Summary

Fix three issues in vertex editing:
1. Use `mapshaper.internal.findNearestVertices()` → `findVertexIds()` to discover ALL topologically-shared vertex indices, then `snapVerticesToPoint()` to move them all.
2. Call `map.render()` during each drag frame for live visual feedback.
3. Remove `_overlayCanvas` and draw vertex dots on the main canvas as part of the render pipeline, matching Mapshaper's approach.

## Modified Capabilities

- `vertex-editing`: Fix topology-aware editing, live drag rendering, and unified canvas rendering

## Impact

- **Modified files**: `src/ui/vertex-edit-control.ts` (topology-aware logic, remove overlay usage), `src/map/map.ts` (integrate vertex rendering into main render pipeline, remove `_overlayCanvas`), `src/renderer/canvas-painter.ts` (adjust `drawVertexDots` to draw on main canvas context)
- **Dependencies**: Uses `mapshaper.internal.findNearestVertices`, `mapshaper.internal.snapVerticesToPoint`, `mapshaper.internal.findVertexIds`
