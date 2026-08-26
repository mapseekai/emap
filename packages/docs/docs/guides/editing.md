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

### `DatasetReplaceCommand` 的信任边界

`DatasetReplaceCommand` 是供高级历史集成使用的可信低层 escape hatch。它不会归一化
CRS 元数据、重投影坐标，也不会校验 source 是否属于某个地图。地图内的批量修改应优先
使用 `map.ops.*`，整图 CRS 变更使用 `map.reproject()`。只有在 `before`、`after` 已经与
所属地图 CRS 对齐，或 source 完全 detached 时，才应直接构造该命令。

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

## 整形选中要素

`reshapeFeature` 让用户画一条替换路径片段的线；它把完成的草图提交给
`map.ops.reshapeSelected()`，可用于选中的线要素和面要素。

```ts
const result = await map.ops.reshapeSelected({
  line: [
    [116.38, 39.90],
    [116.40, 39.91],
  ],
});

if (!result.ok) showError(result.error);
else console.log(result.value.reshapedCount);

map.reshapeFeature.setOptions({ snapThreshold: 12 });
map.reshapeFeature.enable();
```

启用前至少选择一个同 source、同 layer 的路径要素。左键依次放置替换线的顶点，
右键在至少两个顶点后完成，Esc 放弃当前草图。`reshapeFeature` 进入 `'reshape'`
编辑模式；启用另一编辑模式会使它退出。

`map.ops.reshapeSelected()` 返回 `OpResult`。校验失败（`kind: 'validation'`）的错误形状为
`{ kind, field, reason }`，其中 `field` 可为 `selection`、`line`、`layer` 或 `geometry`：
草图至少要有两个有限坐标且不能只重复同一点；草图必须实际整形至少一个选中要素。无接触
的草图会以 `line` 校验错误被拒绝，面整形还会拒绝自交或无效的结果。找不到 source 或
layer 时错误形状为 `{ kind: 'not-found', what, id }`；并发修改使预备 mutation 过期时为
`{ kind: 'stale-operation', sourceId, operation }`，两者都没有 `field`。

## 顶点批量操作

`vertexEdit` 支持框选、整体拖动和批量删除拓扑节点：

```ts
map.vertexEdit.setOptions({
  layers: ['roads'],
  snapThreshold: 12,
  snapToVertex: true,
  snapToEdge: true,
  polygonFillColor: '#6ea8fe', // 面要素悬停填充色
});
map.vertexEdit.enable();
```

在未悬停顶点处拖拽以框选顶点；按住 Shift 拖拽可把框选结果追加到现有选择。拖动任一
已选顶点会整体移动选中的节点。按 Delete 或 Backspace 批量删除；Esc 清除框选。未框选
时，右键顶点可执行单点删除（共享节点可先拆分）。`vertexEdit` 使用 `'vertex'` 编辑
模式，不能与其他编辑模式同时工作。

批量删除仍遵守拓扑删除校验：不能删除会令路径或环退化的节点；共享节点按一个拓扑单元
处理，并且不合法的删除不会提交部分修改。

## 挖洞和删洞

`ringEdit` 为一个选中面要素添加或删除内环（洞），底层 API 是
`map.ops.addRing()` 和 `map.ops.deleteRing()`：

```ts
const added = await map.ops.addRing({
  ring: [
    [116.39, 39.90],
    [116.40, 39.90],
    [116.40, 39.91],
    [116.39, 39.90],
  ],
});

const removed = await map.ops.deleteRing({ point: [116.395, 39.905] });

map.ringEdit.setOptions({ mode: 'add', snapThreshold: 12 });
map.ringEdit.enable();
```

`ringEdit` 要求恰好选择一个面要素。`mode: 'add'` 时左键画洞、右键完成、Esc 取消；
`mode: 'delete'` 时点击洞内任一点删除该洞。它使用 `'ring'` 编辑模式，切换到其他编辑
模式会自动退出。

`map.ops.addRing()` 和 `map.ops.deleteRing()` 的校验失败（`kind: 'validation'`）形状为
`{ kind, field, reason }`，`field` 为 `selection` 或 `ring`：洞必须闭合并围成面积，不能
自交、接触或穿过面边界，且必须严格位于同一个面外环内；点击未落在洞内也会被拒绝。
找不到资源时形状为 `{ kind: 'not-found', what, id }`，预备 mutation 因并发修改过期时为
`{ kind: 'stale-operation', sourceId, operation }`；这两种错误没有 `field`。

## 加和删部分

`partEdit` 为一个选中的线或面要素添加或删除独立 part，底层 API 是
`map.ops.addPart()` 和 `map.ops.deletePart()`：

```ts
const added = await map.ops.addPart({
  coordinates: [
    [116.41, 39.90],
    [116.42, 39.91],
  ],
});

const removed = await map.ops.deletePart({
  point: [116.415, 39.905],
  tolerance: 0.0001,
});

map.partEdit.setOptions({ mode: 'delete', snapThreshold: 12 });
map.partEdit.enable();
```

`partEdit` 要求恰好选择一个路径要素。`mode: 'add'` 时左键画新 part、右键完成、Esc
取消；面 part 自动闭合，线 part 至少需要两个顶点。`mode: 'delete'` 时点击目标 part；
对线要素，handler 会用 `snapThreshold` 换算为 `tolerance`。它使用 `'part'` 编辑模式，
切换到其他编辑模式会自动退出。

`map.ops.addPart()` 和 `map.ops.deletePart()` 的校验失败（`kind: 'validation'`）形状为
`{ kind, field, reason }`，`field` 为 `selection` 或 `part`：新 part 不能自交或接触、相交
已有几何；面 part 还不能重叠已有面、把已有外环包在内部，且方向必须匹配现有外环。单一
part 的要素不可删除 part，面要素点击必须落在该 part 内，线要素必须在 `tolerance` 范围内。
找不到资源时形状为 `{ kind: 'not-found', what, id }`，预备 mutation 因并发修改过期时为
`{ kind: 'stale-operation', sourceId, operation }`；这两种错误没有 `field`。

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

- [EditCommand](/mapseekai/emap/api/interfaces/emap.EditCommand.html)
- [EditHistory](/mapseekai/emap/api/classes/emap.EditHistory.html)
- [Transaction](/mapseekai/emap/api/classes/emap.Transaction.html)
- [EditToolbar](/mapseekai/emap/api/classes/emap.EditToolbar.html)

## 可运行示例

- [综合编辑](/mapseekai/emap/examples/china-editing/)
- [顶点编辑](/mapseekai/emap/examples/vertex-editing/)
- [整形、批量顶点、洞和 part 编辑](/mapseekai/emap/examples/reshape-ring-part/)
- [要素平移](/mapseekai/emap/examples/feature-translate/)
- [旋转与缩放](/mapseekai/emap/examples/feature-rotate-scale/)
- [事务](/mapseekai/emap/examples/transaction/)
- [撤销与重做](/mapseekai/emap/examples/undo-redo/)
