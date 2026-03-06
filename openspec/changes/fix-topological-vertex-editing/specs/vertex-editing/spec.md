## MODIFIED Requirements

### Requirement: Vertex Drag-to-Move (Topological)

The system SHALL move ALL vertices sharing the same topological node when the user drags a vertex, preserving topology across features that share boundary nodes.

#### Scenario: Dragging a shared vertex
- **WHEN** the user drags a vertex that is shared by two or more arcs (topological node)
- **THEN** ALL coincident vertices in the ArcCollection MUST move to the new position simultaneously, preserving topological consistency

#### Scenario: Live view update during drag
- **WHEN** the user is dragging a vertex
- **THEN** the data layer MUST repaint on each drag frame so the user sees the geometry reshape in real time

#### Scenario: Arc bounding box recalculation after drag
- **WHEN** the user releases the mouse button after dragging a vertex
- **THEN** the ArcCollection MUST recalculate its internal bounding boxes so that subsequent rendering and hit-testing use the updated extents

---

### Requirement: Unified Canvas Rendering

The system SHALL render vertex dots on the same canvas as the data layer, not on a separate overlay canvas.

#### Scenario: Vertex dots on main canvas
- **WHEN** vertex editing mode is active and a feature is hovered
- **THEN** the vertex dots MUST be rendered on the main data canvas as part of the render pipeline, after the data paths are drawn

#### Scenario: Hover highlight on main canvas
- **WHEN** the pointer is within 10px of a vertex during editing
- **THEN** the enlarged highlight dot MUST appear on the main data canvas, matching Mapshaper's behavior of drawing the `vertex_overlay` on the same canvas context

#### Scenario: No separate overlay canvas
- **WHEN** vertex editing mode is active
- **THEN** the system SHALL NOT use a separate overlay canvas for vertex rendering; all rendering MUST occur on the single main canvas
