---
id: editing
slug: /guides/editing
title: 编辑
api: ["AffineMatrix","AppendedArc","BulkFeatureDeleteCommand","BulkFeatureDeleteCommandOptions","composeMatrix","CompositeCommand","DatasetReplaceCommand","DatasetReplaceCommandOptions","EditCommand","EditHistory","EditHistoryOptions","Emap","FeatureAffineCommand","FeatureAffineCommandOptions","FeatureCreateCommand","FeatureDeleteCommand","FeatureDeleteCommandOptions","FeaturePropertyChangeCommand","FeaturePropertyChangeCommandOptions","FeatureTranslateCommand","FeatureTranslateCommandOptions","FieldAddCommand","FieldAddCommandOptions","FieldRemoveCommand","FieldRemoveCommandOptions","FieldRenameCommand","FieldRenameCommandOptions","HistoryStateSnapshot","IDENTITY_MATRIX","invertMatrix","planSharedArcSplit","planSharedNodeSplit","rotateMatrix","scaleMatrix","SplitSharedArcsCommand","SplitSharedArcsCommandOptions","SplitSharedArcsRemap","SplitSharedNodeCommand","SplitSharedNodePlan","TopologySource.fromBytes","Transaction","TranslatedPointFeature","VertexDeleteCommand","VertexInsertCommand","VertexMoveCommand"]
examples: ["attribute-editing","china-editing","draw-snap-clear","draw-snap-edge","export-roundtrip","feature-rotate-scale","feature-translate","rebuild-topology","snapshot","transaction","undo-redo","vertex-editing"]
stability: stable
verifiedVersion: 0.5.0
---

# 编辑

Emap 的编辑由命令驱动。命令保存恢复数据所需的状态，因此数据修改、撤销/重做、
渲染缓存和选择变化可以保持一致。

## 编辑入口

| 需求 | 推荐入口 |
|---|---|
| 修改单个属性 | 属性编辑 API 或 `FeaturePropertyChangeCommand` |
| 移动要素 | `transformFeature` Handler 或 translate edit session |
| 旋转、缩放要素 | `transformFeature` Handler 或 affine edit session |
| 编辑顶点 | `vertexEdit` Handler / `VertexEditControl` |
| 绘制新要素 | `drawFeature` Handler / `DrawFeatureControl` |
| 删除选择 | `map.deleteSelected()` |
| 批量拓扑处理 | `map.ops.*` |
| 合并多个步骤 | Transaction |

不要直接修改 `source.getDataset()`。绕过命令系统会跳过撤销快照、缓存失效和选择维护。

## 编辑模式

公开模式包括：

- `'none'`
- `'vertex'`
- `'draw'`
- `'transform'`

```ts
map.setEditMode('vertex');
console.log(map.getEditMode());
```

模式变化会触发 `editmodechange`：

```ts
map.on('editmodechange', ({ mode }) => {
  updateActiveTool(mode);
});
```

离开 `vertex` 或 `draw` 模式时，对应的临时编辑状态会自动清理。

## 使用内置编辑控件

```ts
map.addControl(new EditToolbar(), 'top-left');
map.addControl(new VertexEditControl(), 'top-left');
map.addControl(new DrawFeatureControl(), 'top-left');
```

控件只提供 UI 和模式切换，真实指针处理仍由地图 Handler 完成。已有业务工具栏时，
可以直接启用 `map.vertexEdit`、`map.drawFeature` 或 `map.transformFeature`。

## 撤销与重做

```ts
if (map.canUndo()) {
  map.undo();
}

if (map.canRedo()) {
  map.redo();
}
```

`undo()` 和 `redo()` 在没有可用历史项时返回 `false`，成功时返回 `true`。

加入历史控件：

```ts
map.addControl(new HistoryControl(), 'top-right');
```

绑定键盘快捷键：

```ts
const unbindHistory = map.bindHistoryShortcuts();

// 页面销毁或需要接管快捷键时
unbindHistory();
```

默认支持 Ctrl/Cmd+Z 撤销，以及 Ctrl/Cmd+Shift+Z 或 Ctrl+Y 重做。

## 事务

多个操作需要作为一个用户动作提交时使用 transaction。事务不支持嵌套：

```ts
const tx = map.beginTransaction();

const simplified = await map.ops.simplifyLayer({
  source: 'main',
  percentage: 0.4,
});

if (!simplified.ok) {
  tx.rollback();
  showError(simplified.error);
} else {
  const cleaned = await map.ops.cleanLayer({
    source: 'main',
  });

  if (!cleaned.ok) {
    tx.rollback();
    showError(cleaned.error);
  } else {
    const committed = await tx.commit('简化并清理');
    if (!committed.ok) {
      showError(committed.error);
    }
  }
}
```

`commit(label)` 把已执行的子命令压成一条历史记录。`rollback()` 恢复首次修改前的
dataset 和选择。事务提交或回滚后不能再次使用。

## 自定义命令

需要内置 API 没有覆盖的可撤销编辑时，实现 `EditCommand`。命令的 `do()` 用于 redo，
`undo()` 用于恢复旧状态，可选 `label` 会显示在历史快照中。

调用 `map.pushCommand(command)` 前，调用方必须已经执行修改；`pushCommand` 只把命令加入
历史，不会调用 `command.do()`。命令必须在创建时捕获完整 memento，不能在 undo 时
依赖后来变化的实时 dataset。

## 数据集替换与历史屏障

简化、投影、裁剪等操作可能整体替换 dataset。它们应通过 `map.ops` 执行，让历史知道
哪些较早命令已经不能安全地作用于新 dataset。不要自行替换 source 内部引用。

## 验证

after-commit validator 可以在编辑提交后检查拓扑或业务约束。失败会触发
`validationfailed`，但不会自动撤销：

```ts
map.on('validationfailed', ({ results, label }) => {
  showValidationResults(label, results);
});
```

应用需要决定是提示用户、允许继续，还是主动撤销。

## 常见问题

### 一次拖拽产生多条历史

连续指针更新应由 edit session 累积，在手势结束时提交一次，而不是每个 pointermove
都 push 一条命令。

### 事务失败后历史状态异常

任一步返回失败时立即 `rollback()`，不要继续执行后续 operation。提交和回滚都是终态。

### UI 模式与地图模式不同步

以 `getEditMode()` 和 `editmodechange` 为状态源，不要只维护按钮自己的布尔值。

## API

- [EditCommand](/emap/api/interfaces/index.EditCommand.html)
- [EditHistory](/emap/api/classes/index.EditHistory.html)
- [Transaction](/emap/api/classes/index.Transaction.html)
- [EditToolbar](/emap/api/classes/index.EditToolbar.html)

## 可运行示例

- [综合编辑](/emap/examples/china-editing/)
- [顶点编辑](/emap/examples/vertex-editing/)
- [要素平移](/emap/examples/feature-translate/)
- [旋转与缩放](/emap/examples/feature-rotate-scale/)
- [事务](/emap/examples/transaction/)
- [撤销与重做](/emap/examples/undo-redo/)
