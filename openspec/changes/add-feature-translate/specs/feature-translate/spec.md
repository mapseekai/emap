## ADDED Requirements

### Requirement: FeatureTranslateCommand
The system SHALL provide a `FeatureTranslateCommand` `EditCommand` that offsets a fixed set of arcs and point shapes by `(dx, dy)` and reverses the offset on undo.

#### Scenario: do() offsets every vertex of the listed arcs
- **WHEN** a `FeatureTranslateCommand` with `dx=10, dy=20, arcIds=[3]` has its `do()` called
- **THEN** every vertex within arc 3's range in `arcs.xx` / `arcs.yy` is increased by 10 / 20 respectively
- **AND** `arcs.updateArcBounds(3)` is invoked exactly once

#### Scenario: do() offsets point shape coordinates
- **WHEN** the command is constructed with `pointFeatures: [{ layer, featureId: 0 }]` whose shape is `[[5, 7]]` and `dx=1, dy=2`
- **THEN** after `do()` the shape is `[[6, 9]]`

#### Scenario: undo() exactly reverses do()
- **WHEN** `do()` is called and then `undo()` is called
- **THEN** `arcs.xx`, `arcs.yy`, and every point shape coordinate are bit-equal to their pre-do values

#### Scenario: refreshDisplayArcs is called once per pass
- **WHEN** `do()` (or `undo()`) is called
- **THEN** `source.refreshDisplayArcs()` is invoked exactly once on the source

### Requirement: Emap.translateSelected
The system SHALL provide `Emap.translateSelected(dx, dy): boolean` that translates the currently-selected features by `(dx, dy)` in source-data coordinates, recorded as a single undoable history entry.

#### Scenario: Empty selection returns false
- **WHEN** `translateSelected(10, 0)` is called with an empty selection
- **THEN** the call returns `false`
- **AND** no command is pushed
- **AND** no events fire

#### Scenario: Zero offset returns false
- **WHEN** `translateSelected(0, 0)` is called with any selection
- **THEN** the call returns `false`
- **AND** no command is pushed

#### Scenario: Selection of one path feature collects its arc ids
- **WHEN** the selection has one polygon feature whose shape is `[[3, ~7, 9]]`
- **AND** `translateSelected(1, 1)` is called
- **THEN** the constructed `FeatureTranslateCommand` has `arcIds` equal to `[3, 7, 9]` (signs absolutized, deduplicated, order does not matter)

#### Scenario: Multi-source selection produces a CompositeCommand
- **WHEN** the selection contains features from two different sources
- **AND** `translateSelected(dx, dy)` returns `true`
- **THEN** the pushed history entry is a `CompositeCommand` whose children are one `FeatureTranslateCommand` per source

#### Scenario: Selection survives translation
- **WHEN** `translateSelected(...)` succeeds
- **THEN** `getSelection()` returns the same refs it returned before the call
- **AND** no `selectionchange` event is fired

#### Scenario: Single historychange per call
- **WHEN** `translateSelected(...)` succeeds
- **THEN** exactly one `historychange` event is fired with the command's label

#### Scenario: Single Ctrl+Z reverses the entire translation
- **WHEN** `translateSelected(dx, dy)` has been called and `Emap.undo()` is called once
- **THEN** every affected vertex is at its pre-translation position
- **AND** every affected point shape is at its pre-translation position

### Requirement: Compositional with other edits (not a history barrier)
Translation SHALL NOT clear the prior history. It composes with vertex / draw / delete / attribute commands in a single undo timeline.

#### Scenario: Translate after a vertex move
- **WHEN** the user moves a vertex (pushed as `VertexMoveCommand`)
- **AND** then translates a selection (pushed as `FeatureTranslateCommand`)
- **THEN** the undo stack contains both entries
- **AND** two consecutive `undo()` calls reverse the translation first, then the vertex move
