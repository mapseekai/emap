## ADDED Requirements

### Requirement: Vertex Edit Mode Activation

The map SHALL provide an interactive mode for vertex editing that users can activate and deactivate via a toolbar button control.

#### Scenario: Activating vertex edit mode
- **WHEN** the user adds a `VertexEditControl` to the map and clicks the "✏ Edit" button
- **THEN** the map MUST enter vertex editing mode, the button appears active/highlighted, pan-drag is disabled, and the cursor changes to `crosshair` over features

#### Scenario: Deactivating vertex edit mode
- **WHEN** the user clicks the active "✏ Edit" button again
- **THEN** the map MUST exit vertex editing mode, the cursor reverts to default, pan-drag is re-enabled, and any vertex overlay is cleared

---

### Requirement: Vertex Hover Highlighting

When in vertex editing mode, the system SHALL display vertex dots on any polygon or polyline feature that the user hovers over.

#### Scenario: Hovering over a polygon feature
- **WHEN** the user moves the pointer over a polygon feature while in vertex editing mode
- **THEN** all vertices of the hovered feature MUST be rendered as small filled circles on the overlay canvas

#### Scenario: Hovering over a polyline feature
- **WHEN** the user moves the pointer over a polyline feature while in vertex editing mode
- **THEN** all vertices of the hovered polyline MUST be rendered as small filled circles on the overlay canvas

#### Scenario: Hovering near a specific vertex
- **WHEN** the pointer comes within 10 pixels (screen space) of a vertex
- **THEN** that vertex SHALL be highlighted with a larger circle in a distinct color to indicate it is the drag target

#### Scenario: Pointer leaves feature
- **WHEN** the user moves the pointer away from all features
- **THEN** the overlay canvas MUST be cleared and no vertex dots are visible

---

### Requirement: Vertex Drag-to-Move

The system SHALL allow users to reposition polygon and polyline vertices by dragging them while in vertex editing mode.

#### Scenario: Dragging a vertex
- **WHEN** the user presses the mouse button while a vertex is highlighted (pointer within 10px of vertex)
- **THEN** dragging the mouse MUST move both the visual position and the underlying arc coordinate of that vertex in real time

#### Scenario: Completing a drag
- **WHEN** the user releases the mouse button after dragging a vertex
- **THEN** the arc coordinate SHALL be committed to the source dataset, the map MUST fire a `vertex_moved` event, and the full data layer SHALL be repainted to reflect the updated geometry

#### Scenario: No drag when not on a vertex
- **WHEN** the user presses and drags the mouse while in edit mode but the pointer is not within 10px of any vertex
- **THEN** no vertex MUST be moved; pan navigation SHALL remain blocked while in edit mode

---

### Requirement: Overlay Canvas Rendering

The system SHALL render vertex dots and hover highlights on a separate overlay canvas above the main data canvas.

#### Scenario: Overlay canvas isolation
- **WHEN** the vertex overlay is being drawn (on hover or during drag)
- **THEN** only the overlay canvas SHALL be updated; the main data canvas MUST NOT be repainted, preserving performance for large datasets

#### Scenario: Overlay cleared on deactivation
- **WHEN** vertex editing mode is turned off
- **THEN** the overlay canvas MUST be fully cleared

---

### Requirement: Vertex Moved Event

After a vertex drag operation completes, the map SHALL emit a `vertex_moved` event.

#### Scenario: vertex_moved event payload
- **WHEN** a vertex drag completes successfully
- **THEN** the map MUST fire `vertex_moved` with a payload containing `{ id: number, source: string, layer: string, vertexIndex: number, coords: [number, number] }` in geographic data coordinates
