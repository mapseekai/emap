## ADDED Requirements

### Requirement: EditCommand abstraction
The system SHALL provide an `EditCommand` interface with `do()` and `undo()` methods, an optional human-readable `label`, and an optional `mergeable(prev)` predicate.

#### Scenario: Implementing a custom command
- **WHEN** a developer creates a class with `do()` and `undo()` methods
- **THEN** the class is acceptable as input to `Emap.pushCommand`

### Requirement: Linear undo / redo history
The system SHALL maintain a per-map linear history of pushed commands, supporting `undo()`, `redo()`, `canUndo()`, `canRedo()`, and `clearHistory()`.

#### Scenario: Undo invokes the command's reverse operation
- **WHEN** a command has been pushed and `Emap.undo()` is called
- **THEN** the command's `undo()` method is invoked exactly once
- **AND** `canUndo()` becomes `false` (no more history) or remains `true` (more available)
- **AND** `canRedo()` becomes `true`

#### Scenario: Redo replays the command's forward operation
- **WHEN** a command was undone and `Emap.redo()` is called
- **THEN** the command's `do()` method is invoked exactly once
- **AND** `canRedo()` becomes `false` (no more) or remains `true`
- **AND** `canUndo()` becomes `true`

#### Scenario: Pushing a new command clears the redo stack
- **WHEN** the user undoes one or more commands
- **AND** then pushes a new command
- **THEN** the previously-undone commands are no longer reachable via `redo()`
- **AND** `canRedo()` is `false`

#### Scenario: clearHistory empties both stacks
- **WHEN** the history contains commands and `clearHistory()` is called
- **THEN** `canUndo()` and `canRedo()` are both `false`

### Requirement: Bounded history size
The history SHALL evict oldest entries when the configured `maxSize` (default 200) is exceeded, never growing unbounded.

#### Scenario: Eviction at capacity
- **WHEN** `maxSize` commands have been pushed and one more is pushed
- **THEN** the oldest command is dropped
- **AND** the new command is at the top of the undo stack

### Requirement: historychange event
The system SHALL fire a `historychange` event with `{ canUndo, canRedo, label? }` after every push, undo, redo, or clearHistory call that affects the stacks.

#### Scenario: Push fires historychange
- **WHEN** a command is pushed
- **THEN** a `historychange` event is fired with `canUndo: true` and the command's `label` (if any)

#### Scenario: Undo fires historychange
- **WHEN** `undo()` is called and a command exists to undo
- **THEN** a `historychange` event is fired with the new `canUndo` / `canRedo` state

### Requirement: Vertex edits dispatch commands
`VertexEditControl` SHALL dispatch undoable commands for vertex move, vertex insert, and vertex delete operations.

#### Scenario: Undo reverses a vertex drag
- **WHEN** the user drags a vertex from position P1 to P2 and releases
- **AND** then calls `Emap.undo()`
- **THEN** the affected vertex (and all topologically shared vertices) is restored to P1

#### Scenario: Undo reverses a vertex insertion
- **WHEN** the user clicks an interpolated edge point, inserting a new vertex
- **AND** then calls `Emap.undo()`
- **THEN** the inserted vertex is removed from the arc and the arc returns to its prior point count

#### Scenario: Undo reverses a vertex deletion
- **WHEN** the user deletes a vertex via the right-click context menu
- **AND** then calls `Emap.undo()`
- **THEN** the deleted vertex is re-inserted at its original index with its original coordinates

### Requirement: Drawing dispatches commands
`DrawFeatureControl` SHALL push a `FeatureCreateCommand` whenever a feature is committed.

#### Scenario: Undo reverses a drawn feature
- **WHEN** the user finishes drawing a polyline / polygon / point
- **AND** then calls `Emap.undo()`
- **THEN** the new shape is removed from `layer.shapes`
- **AND** the corresponding data record is removed from `layer.data`
- **AND** for path features, the new arc is removed from the source's `ArcCollection`
- **AND** `source.refreshDisplayArcs()` is called so the LOD copy stays in sync

### Requirement: Opt-in keyboard shortcuts
The system SHALL provide `Emap.bindHistoryShortcuts(target?)` that wires Ctrl/Cmd+Z to undo and Ctrl/Cmd+Shift+Z (or Ctrl+Y) to redo on the given DOM element.

#### Scenario: Default target is the canvas container
- **WHEN** `bindHistoryShortcuts()` is called without an argument
- **THEN** shortcuts are bound to the map's canvas container
- **AND** keystrokes outside that element do not trigger undo / redo
