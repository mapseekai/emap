---
id: editing
slug: /guides/editing
title: 编辑
api: ["AffineMatrix","AppendedArc","BulkFeatureDeleteCommand","BulkFeatureDeleteCommandOptions","composeMatrix","CompositeCommand","DatasetReplaceCommand","DatasetReplaceCommandOptions","EditCommand","EditHistory","EditHistoryOptions","Emap","FeatureAffineCommand","FeatureAffineCommandOptions","FeatureCreateCommand","FeatureDeleteCommand","FeatureDeleteCommandOptions","FeaturePropertyChangeCommand","FeaturePropertyChangeCommandOptions","FeatureTranslateCommand","FeatureTranslateCommandOptions","FieldAddCommand","FieldAddCommandOptions","FieldRemoveCommand","FieldRemoveCommandOptions","FieldRenameCommand","FieldRenameCommandOptions","HistoryStateSnapshot","IDENTITY_MATRIX","invertMatrix","planSharedArcSplit","rotateMatrix","scaleMatrix","SplitSharedArcsCommand","SplitSharedArcsCommandOptions","SplitSharedArcsRemap","TopologySource.fromBytes","Transaction","TranslatedPointFeature","VertexDeleteCommand","VertexInsertCommand","VertexMoveCommand"]
examples: ["attribute-editing","china-editing","draw-snap-clear","draw-snap-edge","export-roundtrip","feature-rotate-scale","feature-translate","rebuild-topology","snapshot","transaction","undo-redo","vertex-editing"]
stability: stable
verifiedVersion: 0.5.0
---

# 编辑

编辑由命令驱动，因此撤销/重做、拓扑缓存和渲染失效能保持同步。

## 行为说明

指针驱动的平移、旋转、缩放使用 edit session；模式切换使用控件；多个命令需要作为一次用户动作提交时使用 transaction。

## API

- [src.EditHistory](https://zwishing.github.io/emap/api/classes/index.EditHistory.html)
- [src.EditToolbar](https://zwishing.github.io/emap/api/classes/index.EditToolbar.html)
- [src.Transaction](https://zwishing.github.io/emap/api/classes/index.Transaction.html)

## 可运行示例

- [china-editing](https://zwishing.github.io/emap/examples/china-editing/)
- [vertex-editing](https://zwishing.github.io/emap/examples/vertex-editing/)
- [feature-translate](https://zwishing.github.io/emap/examples/feature-translate/)
- [transaction](https://zwishing.github.io/emap/examples/transaction/)

## 最小片段

```ts
const tx = map.beginTransaction("bulk edit")
tx.commit()
map.history.undo()
```
