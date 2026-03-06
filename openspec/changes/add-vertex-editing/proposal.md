# Proposal: Add Vertex Editing to Emap

## Why

Emap currently supports only read-only rendering and feature inspection. Inline geometry editing (moving existing vertices) is a core GIS capability needed for spatial data correction workflows. Mapshaper already has a well-designed interactive vertex editing system in its browser GUI that can be adapted cleanly for emap's architecture, giving emap users the ability to reshape features directly on the map.

## Summary

This change ports Mapshaper's GUI vertex editing UX into emap as a `VertexEditControl`. Users click "✏ Edit" to enter edit mode, hover over polygon/polyline features to reveal vertex dots, then drag individual vertices to reshape geometry.

## New Capabilities

- `vertex-editing`: Interactive toolbar mode that exposes vertex handle dots on hovered features and enables drag-to-move on individual vertices.

## Modified Capabilities

- `map-interaction`: Extend the existing interaction model to support an "edit" mode alongside pan/zoom and feature-inspection.

## Impact

- **New files**: `src/ui/vertex-edit-control.ts`, `src/ui/edit-toolbar.ts`, `test/examples/vertex-editing.html`
- **Modified files**: `src/map/map.ts` (overlay canvas, edit mode API), `src/renderer/canvas-painter.ts` (vertex dot rendering)
- **Dependencies**: No new dependencies; relies on existing `mapshaper` internal APIs
