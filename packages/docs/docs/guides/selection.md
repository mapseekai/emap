---
id: selection
slug: /guides/selection
title: 选择
api: ["BoxSelectHandler", "BoxSelectHandlerOptions", "BoxSelectStyle", "ClickSelectHandler", "DragPanHandler", "DragPanOptions", "DrawFeatureHandler", "DrawFeatureOptions", "DrawGeometryType", "Emap", "featureMatchesLasso", "LassoSelectHandler", "LassoSelectHandlerOptions", "LassoSelectStyle", "MergeSelectedOptions", "ModifierCombo", "pointInPolygon", "resolveMode", "ScrollZoomHandler", "ScrollZoomOptions", "SelectHandlerOptions", "Selection", "SelectionDiff", "SelectionSnapshot", "SelectMode", "TransformFeatureHandler", "TransformFeatureOptions", "VertexEditHandler", "VertexEditOptions", "FeatureQuery"]
examples: ["box-select","feature-rotate-scale","feature-selection","feature-translate","lasso-select","merge-selected"]
stability: stable
verifiedVersion: unreleased
---

# 选择

Emap 用 `{ source, layer, id }` 标识已选要素。`source` 是地图 source ID，`layer` 是 source 内的图层名，`id` 是该图层中的要素索引。

## 使用选择 API

`select()` 默认替换选择；`add` 添加，`toggle` 切换成员。查询结果可直接传给 `select()`。

```ts
map.select([{ source: 'parcels', layer: 'lots', id: 42 }]);

const hits = map.queryFeatures([240, 160], { layers: ['parcel-fill'] });
map.select(hits, { mode: 'add' });

map.deselect([{ source: 'parcels', layer: 'lots', id: 42 }]);
map.clearSelection();
const selected = map.getSelection();
```

`queryFeatures()` 的 `layers` 过滤器使用渲染图层 ID；选择引用和要素事件过滤器使用 source layer 名称。

## 启用点击、框选或套索

这些 Handler 默认关闭。用 `setOptions()` 限制可选渲染图层或设置修饰键，然后启用：

```ts
map.clickSelect.setOptions({
  layers: ['parcel-fill'],
  modifiers: { replace: 'none', add: 'shift', toggle: 'shift+alt' },
});
map.clickSelect.enable();

map.boxSelect.setOptions({ layers: ['parcel-fill'], dragActivator: 'shift' });
map.boxSelect.enable();
```

`boxSelect` 和 `lassoSelect` 都消费拖拽手势，不能同时启用。切换前先关闭已启用的 Handler：

```ts
map.boxSelect.disable();
map.lassoSelect.setOptions({ layers: ['parcel-fill'], includeIntersecting: true });
map.lassoSelect.enable();
```

## 监听选择变化

选择集合实际变化时，`selectionchange` 提供完整选择、添加项和移除项：

```ts
map.on('selectionchange', ({ selected, added, removed }) => {
  const selectionUpdate = { selected, added, removed };
});
```

批量数据操作应通过 `map.ops` 执行，使地图能更新选择、空间索引和渲染。

## 可运行示例

- [要素选择](/mapseekai/emap/examples/feature-selection/)
- [框选](/mapseekai/emap/examples/box-select/)
- [套索选择](/mapseekai/emap/examples/lasso-select/)
