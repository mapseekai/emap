## ADDED Requirements

### Requirement: BoxSelectControl
The system SHALL provide a `BoxSelectControl` UI control that performs feature selection by shift+dragging a rubber-band rectangle over the map.

#### Scenario: Plain shift+drag selects with replace mode
- **WHEN** the user shift+presses inside the canvas container, drags 50 px diagonally, and releases
- **THEN** `Emap.queryRenderedFeatures` is invoked with the resulting pixel bbox
- **AND** `Emap.select(refs, 'replace')` is invoked with the deduplicated `FeatureRef[]`

#### Scenario: shift+ctrl+drag selects with add mode
- **WHEN** the user shift+ctrl-drags
- **THEN** `Emap.select(refs, 'add')` is invoked

#### Scenario: shift+meta+drag selects with add mode (Mac)
- **WHEN** the user shift+meta-drags
- **THEN** `Emap.select(refs, 'add')` is invoked

#### Scenario: shift+alt+drag selects with toggle mode
- **WHEN** the user shift+alt-drags
- **THEN** `Emap.select(refs, 'toggle')` is invoked

#### Scenario: Plain (non-shift) mousedown is left for pan
- **WHEN** the user presses without shift
- **THEN** `Emap.queryRenderedFeatures` is NOT invoked
- **AND** no rubber-band rectangle is rendered
- **AND** the existing `DragPanHandler` is free to handle the pan

#### Scenario: Below-threshold drag is a no-op
- **WHEN** the user shift+drags less than `dragThreshold` (default 4 px) diagonally
- **THEN** `Emap.select` is NOT invoked
- **AND** the rubber-band overlay is hidden on mouseup

#### Scenario: Dedupe across multiple visible layers of the same source
- **WHEN** a source has two visible layers (e.g. fill + line) backed by the same features
- **AND** the box-select bbox covers them both
- **THEN** each unique `(source, layer, id)` triple appears at most once in the `refs` argument to `Emap.select`

#### Scenario: disable() makes shift+drag a no-op
- **WHEN** `boxSelectControl.disable()` has been called
- **AND** the user shift+drags
- **THEN** `Emap.select` is NOT invoked
- **AND** no rubber-band overlay is shown

#### Scenario: Mouse leaves the canvas during drag
- **WHEN** the user shift+presses inside the container, drags outside the container, and releases anywhere
- **THEN** the drag completes correctly and `Emap.select` is invoked with the final bbox
- **AND** the rubber-band is hidden on release

### Requirement: DragPanHandler skips shift-modified mousedowns
The `DragPanHandler` SHALL ignore mousedown events whose `shiftKey` flag is true, leaving the gesture for higher-level controls (e.g. `BoxSelectControl`).

#### Scenario: Plain mousedown still pans
- **WHEN** mousedown fires without shift
- **THEN** `panstart` is emitted and `isDragging()` returns `true`

#### Scenario: shift+mousedown does not pan
- **WHEN** mousedown fires with `shiftKey === true`
- **THEN** `panstart` is NOT emitted and `isDragging()` returns `false`
