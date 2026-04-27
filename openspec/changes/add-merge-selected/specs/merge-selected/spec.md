## ADDED Requirements

### Requirement: Emap.mergeSelected
The system SHALL provide `Emap.mergeSelected(): Promise<boolean>` that combines the currently-selected features (when they all live in the same source/layer) into a single feature, recorded as one undoable history entry.

#### Scenario: Empty selection is a no-op
- **WHEN** `mergeSelected()` is called with an empty selection
- **THEN** the promise resolves with `false`
- **AND** no command runs
- **AND** no events fire

#### Scenario: Cross-layer selection returns false
- **WHEN** the selection contains features from two or more different layers
- **THEN** `mergeSelected()` resolves with `false`
- **AND** no command runs

#### Scenario: Cross-source selection returns false
- **WHEN** the selection contains features from two or more different sources
- **THEN** `mergeSelected()` resolves with `false`
- **AND** no command runs

#### Scenario: Same-layer multi-feature selection produces one merged feature
- **WHEN** the selection contains N features from one source/layer and `mergeSelected()` resolves with `true`
- **THEN** the source's dataset has been replaced with mapshaper's dissolve result
- **AND** the resulting layer contains the unselected features unchanged plus exactly one new merged feature
- **AND** the merged feature inherits the FIRST selected feature's attribute values
- **AND** exactly one entry is added to the undo history with label `Merge N features`

#### Scenario: Selection is cleared on success
- **WHEN** a merge succeeds and the selection was non-empty
- **THEN** `getSelection()` returns an empty array after the promise resolves

#### Scenario: Successful merge is reversible by one undo
- **WHEN** `mergeSelected()` resolves with `true`
- **AND** `Emap.undo()` is called once
- **THEN** the source's dataset is restored to the reference that was active before the merge

### Requirement: Attribute preservation via copy-fields
The merge operation SHALL preserve every attribute field present on the original layer, by listing them in mapshaper's `-dissolve copy-fields=` option.

#### Scenario: Layer with attributes
- **WHEN** the target layer has fields `name, pop, area`
- **THEN** the constructed mapshaper command includes `copy-fields=name,pop,area`
- **AND** the temp discriminator field (`__emap_merge`) is removed from the result

#### Scenario: Layer without a data table
- **WHEN** the target layer has no `data` property
- **THEN** the constructed command omits the `copy-fields=` option
- **AND** dissolve still runs successfully

### Requirement: Discriminator expression references this.id
The temp-field expression SHALL reference mapshaper's standard `this.id` (feature row index) so that the per-feature ids in the discriminator match emap's own `FeatureRef.id`.

#### Scenario: Selected ids are embedded as a JSON array literal
- **WHEN** features with ids `2, 5, 7` are selected and `mergeSelected()` is called
- **THEN** the constructed `-each` expression contains the literal `[2,5,7]` (sorted ascending) and tests `this.id` against it

### Requirement: Dataset-replace barrier
The merge operation SHALL clear prior undo history before pushing its own command, matching every other dataset-replace operation.

#### Scenario: Prior history is wiped
- **WHEN** the user has performed several vertex / draw / attribute edits and then calls `mergeSelected()` successfully
- **THEN** the undo history holds exactly one entry (the merge)
- **AND** `historychange` is fired with `canUndo: true, canRedo: false`
