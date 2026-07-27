---
id: editing
slug: /guides/editing
title: Editing
api: ["AffineMatrix","AppendedArc","BulkFeatureDeleteCommand","BulkFeatureDeleteCommandOptions","composeMatrix","CompositeCommand","DatasetReplaceCommand","DatasetReplaceCommandOptions","EditCommand","EditHistory","EditHistoryOptions","Emap","FeatureAffineCommand","FeatureAffineCommandOptions","FeatureCreateCommand","FeatureDeleteCommand","FeatureDeleteCommandOptions","FeaturePropertyChangeCommand","FeaturePropertyChangeCommandOptions","FeatureTranslateCommand","FeatureTranslateCommandOptions","FieldAddCommand","FieldAddCommandOptions","FieldRemoveCommand","FieldRemoveCommandOptions","FieldRenameCommand","FieldRenameCommandOptions","HistoryStateSnapshot","IDENTITY_MATRIX","invertMatrix","planSharedArcSplit","rotateMatrix","scaleMatrix","SplitSharedArcsCommand","SplitSharedArcsCommandOptions","SplitSharedArcsRemap","TopologySource.fromBytes","Transaction","TranslatedPointFeature","VertexDeleteCommand","VertexInsertCommand","VertexMoveCommand"]
examples: ["attribute-editing","china-editing","draw-snap-clear","draw-snap-edge","export-roundtrip","feature-rotate-scale","feature-translate","rebuild-topology","snapshot","transaction","undo-redo","vertex-editing"]
stability: stable
verifiedVersion: 0.5.0
---

# Editing

Edits are command-backed so undo/redo, topology caches, and render invalidation stay synchronized.

## Behavior notes

Use edit sessions for pointer-driven translate/rotate/scale work, controls for mode switching, and transactions when several commands should commit as one user action.

## API

- [src.EditHistory](https://zwishing.github.io/emap/api/classes/index.EditHistory.html)
- [src.EditToolbar](https://zwishing.github.io/emap/api/classes/index.EditToolbar.html)
- [src.Transaction](https://zwishing.github.io/emap/api/classes/index.Transaction.html)

## Runnable examples

- [china-editing](https://zwishing.github.io/emap/examples/china-editing/)
- [vertex-editing](https://zwishing.github.io/emap/examples/vertex-editing/)
- [feature-translate](https://zwishing.github.io/emap/examples/feature-translate/)
- [transaction](https://zwishing.github.io/emap/examples/transaction/)

## Minimal snippet

```ts
const tx = map.beginTransaction("bulk edit")
tx.commit()
map.history.undo()
```
