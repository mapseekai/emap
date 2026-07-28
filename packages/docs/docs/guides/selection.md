---
id: selection
slug: /guides/selection
title: 选择
api: ["BoxSelectHandler","BoxSelectHandlerOptions","BoxSelectStyle","ClickSelectHandler","DragPanHandler","DragPanOptions","DrawFeatureHandler","DrawFeatureOptions","DrawGeometryType","Emap","featureMatchesLasso","LassoSelectHandler","LassoSelectHandlerOptions","LassoSelectStyle","LassoStyle","ModifierCombo","pointInPolygon","resolveMode","ScrollZoomHandler","ScrollZoomOptions","SelectHandlerOptions","Selection","SelectionDiff","SelectionSnapshot","SelectMode","TransformFeatureHandler","TransformFeatureOptions","VertexEditHandler","VertexEditOptions"]
examples: ["box-select","feature-rotate-scale","feature-selection","feature-translate","lasso-select","merge-selected"]
stability: stable
verifiedVersion: 0.5.0
---

# 选择

选择项使用 `{ source, layer, id }` 标识，其中 `source` 是地图 source ID，
`layer` 是 dataset 中的 source layer 名称，`id` 是该 source layer 内的要素索引。
选择状态独立于渲染图层样式。

## 使用 API 选择

替换当前选择：

```ts
map.select([
  {
    source: 'main',
    layer: 'districts',
    id: 3,
  },
]);
```

默认 mode 是 `'replace'`。还支持：

```ts
map.select(features, { mode: 'add' });
map.select(features, { mode: 'toggle' });
```

| mode | 行为 |
|---|---|
| `replace` | 用传入要素替换整个选择 |
| `add` | 保留已有选择并加入新要素 |
| `toggle` | 已选中的移除，未选中的加入 |

移除指定要素或清空：

```ts
map.deselect([{ source: 'main', layer: 'districts', id: 3 }]);
map.clearSelection();
```

读取和判断：

```ts
const selected = map.getSelection();
const active = map.isSelected({
  source: 'main',
  layer: 'districts',
  id: 3,
});
```

## 从查询结果建立选择

`queryFeatures` 返回的对象与 `FeatureRef` 结构兼容，可以直接传给 `select`：

```ts
const hits = map.queryFeatures([240, 180], {
  layers: ['district-fill'],
});

map.select(hits);
```

## 监听变化

```ts
map.on('selectionchange', ({ selected, added, removed }) => {
  updateSelectionCount(selected.length);
  updatePropertyPanel(selected);
  console.log({ added, removed });
});
```

只有集合实际改变时才触发事件。对已选择要素重复执行 `add` 不会产生无意义通知。

## 点击选择

点击选择 Handler 默认关闭：

```ts
map.clickSelect.setOptions({
  layers: ['district-fill'],
});
map.clickSelect.enable();
```

检查和关闭：

```ts
if (map.clickSelect.isEnabled()) {
  map.clickSelect.disable();
}
```

应用工具栏应直接切换 Handler，不要额外注册一套 Canvas click 逻辑。

## 拉框与套索

可直接使用 Handler：

```ts
map.boxSelect.enable();
map.lassoSelect.disable();
```

也可以使用内置控件：

```ts
map.addControl(new BoxSelectControl(), 'top-left');
map.addControl(new LassoSelectControl(), 'top-left');
```

拉框、套索、绘制和编辑都是有手势所有权的模式。应用在切换工具时应只保留当前模式
需要的 Handler，避免同一指针动作表达多个意图。

## 删除选择

```ts
const deleted = map.deleteSelected();

if (deleted) {
  console.log('已删除，且可以撤销');
}
```

删除的所有要素组成一次历史记录；一次撤销会恢复整批要素。成功后选择自动清空。
选择为空时返回 `false`，不会增加历史项。

## 选择与数据操作

数据操作可能改变要素数量、拓扑、属性或 CRS。emap 根据 operation effect 决定选择
是保留、重映射还是清空。所有批量操作都应通过 `map.ops`，否则选择引用可能指向
错误的 feature ID。

## 常见问题

### 事件过滤没有命中

要素事件 filter 的 `layers` 使用 source layer 名称；`queryFeatures` 的 `layers`
使用渲染图层 ID。先确认当前 API 需要哪一种。

### 删除后仍使用旧 ID

feature ID 是 source layer 内的索引，删除或 shape-count 操作可能改变后续 ID。
数据变化后使用事件或新的查询结果刷新应用缓存。

### 工具切换后仍在选择

切换模式时显式调用旧 Handler 的 `disable()`。是否清空已有选择取决于业务意图，
不要把禁用工具和清空结果隐式绑定。

## API

- [Emap](/emap/api/classes/index.Emap.html)
- [Selection](/emap/api/classes/index.Selection.html)
- [FeatureRef](/emap/api/interfaces/index.FeatureRef.html)
- [BoxSelectControl](/emap/api/classes/index.BoxSelectControl.html)
- [LassoSelectControl](/emap/api/classes/index.LassoSelectControl.html)

## 可运行示例

- [要素选择](/emap/examples/feature-selection/)
- [拉框选择](/emap/examples/box-select/)
- [套索选择](/emap/examples/lasso-select/)
- [合并已选要素](/emap/examples/merge-selected/)
