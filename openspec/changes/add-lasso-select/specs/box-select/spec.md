## ADDED Requirements

### Requirement: LassoSelectControl
The system SHALL provide a `LassoSelectControl` UI control that performs feature selection by shift+dragging a free-form polygon over the map.

#### Scenario: Shift+drag draws a lasso path
- **WHEN** the user shift+presses inside the canvas container, drags through several pixel positions, and releases
- **THEN** an SVG overlay is shown during the drag, with a `<polyline>` whose `points` attribute reflects every captured pixel position
- **AND** the overlay is hidden on mouseup

#### Scenario: Shift-drag selects features whose first-vertex pixel is inside the closed lasso polygon
- **WHEN** the released path has at least 3 points AND a diagonal at or above the threshold
- **THEN** `map.queryRenderedFeatures(bbox)` is invoked with the lasso's pixel bbox
- **AND** for each returned candidate, a representative pixel (first arc's first vertex for path features, or the point itself for points) is tested against the closed lasso polygon via even-odd ray-casting
- **AND** survivors are deduplicated by `(source, layer, id)` and passed to `map.select(refs, { mode })`

#### Scenario: shift only → replace mode
- **WHEN** the user shift+drags without other modifiers
- **THEN** `map.select(refs, { mode: 'replace' })` is invoked

#### Scenario: shift+ctrl/meta → add mode
- **WHEN** the user shift+ctrl or shift+meta drags
- **THEN** `map.select(refs, { mode: 'add' })` is invoked

#### Scenario: shift+alt → toggle mode
- **WHEN** the user shift+alt drags
- **THEN** `map.select(refs, { mode: 'toggle' })` is invoked

#### Scenario: Path with fewer than 3 points is a no-op
- **WHEN** the released path has only 1 or 2 points
- **THEN** `map.select` is NOT invoked
- **AND** the overlay is hidden

#### Scenario: Drag below threshold is a no-op
- **WHEN** the released path has 3+ points but its bbox diagonal is below `dragThreshold` (default 4 px)
- **THEN** `map.select` is NOT invoked

#### Scenario: Plain (non-shift) mousedown is left for pan
- **WHEN** the user presses without shift
- **THEN** the lasso overlay is NOT shown
- **AND** `map.select` is NOT invoked

#### Scenario: disable() makes shift+drag a no-op
- **WHEN** `lassoControl.disable()` has been called
- **AND** the user shift+drags
- **THEN** no overlay is shown and `map.select` is NOT invoked

#### Scenario: Dedupe across visible layers of the same source
- **WHEN** a source has multiple visible layers backed by the same feature
- **AND** the lasso covers the feature
- **THEN** each unique `(source, layer, id)` triple appears at most once in the `refs` argument to `map.select`

### Requirement: LassoSelectControl coexistence with BoxSelectControl
Both `LassoSelectControl` and `BoxSelectControl` consume the shift+drag gesture; they are designed as exclusive alternatives. Each control exposes `enable()` / `disable()` / `isEnabled()` so applications can switch between them at runtime via a toolbar.

#### Scenario: Two controls installed, one disabled — only the enabled one fires
- **WHEN** both controls are added to the same `Emap` instance
- **AND** `lasso.disable()` has been called
- **AND** the user shift+drags
- **THEN** `LassoSelectControl` does NOT capture the gesture
- **AND** `BoxSelectControl` runs normally

#### Scenario: Switching the active tool via disable/enable
- **WHEN** an application toggles between rect and lasso by calling `box.disable() + lasso.enable()` (or the inverse)
- **THEN** the next shift+drag is handled by exactly the enabled control
