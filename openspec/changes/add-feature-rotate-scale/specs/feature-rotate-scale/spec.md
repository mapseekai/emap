## ADDED Requirements

### Requirement: FeatureAffineCommand
The system SHALL provide a `FeatureAffineCommand` `EditCommand` that applies a 2x3 affine matrix to a fixed set of arcs and point shapes, and reverses it on undo via the analytically-computed inverse matrix.

#### Scenario: Identity translate matrix matches FeatureTranslateCommand semantics
- **WHEN** a `FeatureAffineCommand` with matrix `{a:1,b:0,c:0,d:1,tx:10,ty:20}` is run against an arc
- **THEN** every vertex of that arc is offset by `(10, 20)`
- **AND** `undo()` restores the original positions

#### Scenario: Rotate-90 matrix
- **WHEN** a `FeatureAffineCommand` with `rotateMatrix(Math.PI/2, 0, 0)` runs against a vertex at `(1, 0)`
- **THEN** the vertex is at `(0, 1)` (within floating-point epsilon)

#### Scenario: Scale-2 matrix from origin (5, 5)
- **WHEN** a `FeatureAffineCommand` with `scaleMatrix(2, 2, 5, 5)` runs against a vertex at `(7, 7)`
- **THEN** the vertex is at `(9, 9)` (origin invariant)

#### Scenario: refreshDisplayArcs called once per pass
- **WHEN** `do()` (or `undo()`) is called
- **THEN** `source.refreshDisplayArcs()` is invoked exactly once

### Requirement: Affine matrix helpers
The system SHALL provide `rotateMatrix(angleRad, ox, oy)`, `scaleMatrix(sx, sy, ox, oy)`, and `invertMatrix(m)` helpers exposed alongside `FeatureAffineCommand`.

#### Scenario: invertMatrix is the analytical inverse
- **WHEN** `m` is any non-degenerate 2x3 matrix
- **AND** `inv = invertMatrix(m)`
- **THEN** applying `m` then `inv` to any point returns the original point (within floating-point epsilon)

### Requirement: Emap.rotateSelected
The system SHALL provide `Emap.rotateSelected(angleDegrees, origin?): boolean` that rotates the currently-selected features by the supplied angle, recorded as one undoable history entry.

#### Scenario: Empty selection / zero angle returns false
- **WHEN** `rotateSelected(45)` is called with an empty selection
- **THEN** the call returns `false`
- **WHEN** `rotateSelected(0)` is called with any selection
- **THEN** the call returns `false`
- **AND** no command is pushed in either case

#### Scenario: Default origin is the bbox centroid
- **WHEN** `rotateSelected(angleDegrees)` is called without `origin`
- **THEN** the rotation pivot is the centre of the bounding box of every vertex affected by the rotation

#### Scenario: Custom origin is honoured
- **WHEN** `rotateSelected(angleDegrees, [ox, oy])` is called
- **THEN** the rotation pivot is `(ox, oy)`

#### Scenario: Selection survives, single historychange
- **WHEN** `rotateSelected(...)` succeeds
- **THEN** `getSelection()` returns the same refs it did before
- **AND** exactly one `historychange` event is fired

### Requirement: Emap.scaleSelected
The system SHALL provide `Emap.scaleSelected(sx, sy?, origin?): boolean` that scales the currently-selected features uniformly (when `sy` is omitted) or non-uniformly, recorded as one undoable history entry.

#### Scenario: Uniform scale from one argument
- **WHEN** `scaleSelected(2)` is called
- **THEN** the X and Y axes are both scaled by 2

#### Scenario: Non-uniform scale
- **WHEN** `scaleSelected(2, 0.5)` is called
- **THEN** the X axis is scaled by 2 and Y by 0.5

#### Scenario: Empty selection / no-op scale returns false
- **WHEN** `scaleSelected(2)` is called with an empty selection
- **THEN** the call returns `false`
- **WHEN** `scaleSelected(1)` is called with any selection
- **THEN** the call returns `false`
- **WHEN** `scaleSelected(1, 1)` is called with any selection
- **THEN** the call returns `false`

#### Scenario: Default origin is the bbox centroid
- **WHEN** `scaleSelected(sx, sy?)` is called without `origin`
- **THEN** the scaling pivot is the centre of the bounding box of every vertex affected

### Requirement: Multi-source selections wrap in CompositeCommand
When the selection spans more than one source, both rotate and scale SHALL build one `FeatureAffineCommand` per source and wrap them in a single `CompositeCommand`, so one undo reverses every source's changes together.

#### Scenario: Cross-source rotate
- **WHEN** the selection includes features from two sources and `rotateSelected(...)` returns `true`
- **THEN** the pushed history entry is a `CompositeCommand` whose children are one `FeatureAffineCommand` per source
- **AND** a single `undo()` reverses both sources' rotations
