---
id: editing
slug: /guides/editing
title: 编辑
api: ["AffineMatrix","AppendedArc","AutoCompletePolygonHandler","AutoCompletePolygonOptions","AutoCompletePolygonResult","BulkFeatureDeleteCommand","BulkFeatureDeleteCommandOptions","composeMatrix","CompositeCommand","DatasetReplaceCommand","DatasetReplaceCommandOptions","EditCommand","EditHistory","EditHistoryOptions","Emap","FeatureAffineCommand","FeatureAffineCommandOptions","FeatureAppendCommand","FeatureAppendCommandOptions","FeatureCreateCommand","FeatureDeleteCommand","FeatureDeleteCommandOptions","FeaturePropertyChangeCommand","FeaturePropertyChangeCommandOptions","FeatureTranslateCommand","FeatureTranslateCommandOptions","FieldAddCommand","FieldAddCommandOptions","FieldRemoveCommand","FieldRemoveCommandOptions","FieldRenameCommand","FieldRenameCommandOptions","HistoryStateSnapshot","IDENTITY_MATRIX","invertMatrix","planSharedArcSplit","planSharedNodeSplit","rotateMatrix","scaleMatrix","SplitSharedArcsCommand","SplitSharedArcsCommandOptions","SplitSharedArcsRemap","SplitSharedNodeCommand","SplitSharedNodePlan","TopologySource.fromBytes","Transaction","TranslatedPointFeature","VertexDeleteCommand","VertexInsertCommand","VertexMoveCommand","AddPartOptions","AddRingOptions","DeletePartOptions","DeleteRingOptions","FillRingOptions","PartEditHandler","PartEditOptions","ReshapeFeatureHandler","ReshapeFeatureOptions","ReshapeSelectedOptions","ReshapeSelectedResult","RingEditHandler","RingEditOptions","DrawFeatureHandler","VertexEditHandler","SplitFeatureHandler","TransformFeatureHandler"]
examples: ["attribute-editing","china-editing","draw-snap-clear","draw-snap-edge","feature-rotate-scale","feature-translate","rebuild-topology","reshape-ring-part","snapshot","split-features","transaction","undo-redo","vertex-editing"]
stability: stable
verifiedVersion: 0.9.0
---

# 编辑

Emap 将交互编辑和可撤销命令连接到同一份地图状态。先配置 Handler，再启用它；结束工具时调用 `disable()`。

## 启用编辑工具

所有编辑 Handler 默认关闭。绘制工具需要目标 source 和几何类型：

```ts
map.drawFeature.setOptions({
  source: 'parcels',
  sourceLayer: 'lots',
  type: 'polygon',
  snapThreshold: 12,
  snapToVertex: true,
  snapToEdge: true,
});
map.drawFeature.enable();
```

常用工具如下：

| Handler | 用途 | 启用前条件 |
|---|---|---|
| `drawFeature` | 绘制 point、polyline 或 polygon | `source` 和 `type` |
| `vertexEdit` | 选择、拖动和删除拓扑顶点 | 可编辑图层 |
| `splitFeature` | 用点或折线切割已选要素 | 同一 source layer 中的有效选择 |
| `reshapeFeature` | 用草图替换路径片段 | 与草图相交的路径 |
| `autoCompletePolygon` | 沿现有边界绘制相邻面 | 起点和终点接触已有面 |
| `ringEdit` | 添加或删除 polygon 内环 | 选中的面 |
| `partEdit` | 添加或删除线或面的 part | 符合工具模式的选择 |
| `transformFeature` | 拖动、旋转或缩放已选要素 | 选中的要素 |

例如，切换到顶点编辑后，在切换工具前关闭它：

```ts
map.vertexEdit.setOptions({ layers: ['parcel-fill'] });
map.vertexEdit.enable();

// 切换到其他工具前
map.vertexEdit.disable();
```

`boxSelect` 和 `lassoSelect` 不能同时启用；编辑工具也应在启用另一个需要相同手势的工具前关闭。

## 撤销、重做和快捷键

编辑命令进入历史记录。用返回值决定是否更新应用 UI：

```ts
if (map.canUndo()) map.undo();
if (map.canRedo()) map.redo();

const unbind = map.bindHistoryShortcuts();
// 组件卸载时调用 unbind()
```

`undo()` 和 `redo()` 在没有可执行项时返回 `false`。`historychange` 事件提供按钮状态同步所需的信息。

## 将多个操作作为一个动作

`beginTransaction()` 暂存期间产生的操作和命令。`commit(label)` 将它们合并为一个历史项；失败时调用 `rollback()` 恢复数据和选择。事务不能嵌套。

```ts
const tx = map.beginTransaction();
const clipped = await map.ops.clipLayer({ source: 'parcels', target: 'lots', mask: 'boundary' });
if (!clipped.ok) {
  tx.rollback();
} else {
  await tx.commit('裁剪地块');
}
```

## 自定义可撤销编辑

当公开的地图操作不覆盖业务编辑时，实现 `EditCommand`，先完成数据修改，再通过 `map.pushCommand(command)` 记录可重做的命令。`do()` 执行重做，`undo()` 恢复修改前的数据。

## 可运行示例

- [顶点编辑](/mapseekai/emap/examples/vertex-editing/)
- [撤销与重做](/mapseekai/emap/examples/undo-redo/)
- [事务](/mapseekai/emap/examples/transaction/)
