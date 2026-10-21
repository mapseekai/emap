---
id: selection
slug: /guides/selection
title: 选择
api: ["BoxSelectHandler", "BoxSelectHandlerOptions", "BoxSelectStyle", "ClickSelectHandler", "DragPanHandler", "DragPanOptions", "DrawFeatureHandler", "DrawFeatureOptions", "DrawGeometryType", "Emap", "featureMatchesLasso", "LassoSelectHandler", "LassoSelectHandlerOptions", "LassoSelectStyle", "MergeSelectedOptions", "ModifierCombo", "pointInPolygon", "resolveMode", "ScrollZoomHandler", "ScrollZoomOptions", "SelectHandlerOptions", "Selection", "SelectionDiff", "SelectionSnapshot", "SelectMode", "TransformFeatureHandler", "TransformFeatureOptions", "VertexEditHandler", "VertexEditOptions", "FeatureQuery"]
examples: ["lasso-select","feature-rotate","feature-scale","feature-selection","feature-translate","merge-selected"]
stability: stable
verifiedVersion: 0.14.0
---

# 选择

Emap 支持程序化选择、点击、框选和套索选择，以 `{ source, layer, id }` 标识要素；选择可跨 source 和 source layer，并通过事件提供集合与增量。

```ts
const refs = [{ source: 'parcels', layer: 'lots', id: 42 }]; // 标识要素
map.select(refs, { mode: 'add' }); // 加入选择
map.deselect(refs); // 移除指定要素
map.clearSelection(); // 清空全部选择
const selected = map.getSelection(); // 读取当前选择
```

## 核心方法

### 要素引用
`FeatureRef` 是选择方法和 `selectionchange` 事件共用的引用：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `source` | `string` | 必填 | 地图 source ID。 |
| `layer` | `string` | 必填 | source 内的 layer ID 或名称。 |
| `id` | `number` | 必填 | layer 内的要素索引。 |

### 变更和读取


`select(features, options?)`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `features` | `ReadonlyArray<FeatureRef>` | 必填 | 要加入、替换或切换的引用；单次调用自动去重。 |
| `options.mode` | `SelectMode` | `'replace'` | `'replace'` 替换，`'add'` 合并，`'toggle'` 切换成员关系。 |

其余方法：

| API | 签名 | 说明 |
| --- | --- | --- |
| `deselect` | `(features: ReadonlyArray<FeatureRef>) => void` | 移除指定引用。 |
| `clearSelection` | `() => void` | 清空全部选择。 |
| `getSelection` | `() => FeatureRef[]` | 按 source、layer、插入顺序返回引用。 |

`queryFeatures()` 的 `layers` 过滤器接受 source layer ID 或名称；省略时查询可见渲染图层对应的 layer。

## 更多选择手势

三个 Handler 均默认关闭，共用：

| API | 签名 | 说明 |
| --- | --- | --- |
| `enable()` / `disable()` | `handler.enable(): void` | 启用手势（框选和套索显示十字光标）/ 关闭手势和进行中的预览。 |
| `isEnabled` | `handler.isEnabled(): boolean` | 当前启用状态。 |
| `setOptions` | `handler.setOptions(options: Partial<Options>): void` | 浅合并顶层配置；`modifiers` 和 `style` 整体替换。 |
| `getOptions` | `handler.getOptions(): Readonly<Options>` | 当前合并配置。 |

`SelectHandlerOptions` 提供范围和组合键配置：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `layers` | `string[]` | `undefined`（全部可见 source layer） | 参与命中的 source layer ID 或名称。 |
| `source` | `string` | `undefined` | 预留 source 标识；查询范围由 `layers` 控制。 |
| `modifiers` | `Partial<Record<SelectMode, ModifierCombo>>` | 见各 Handler | 映射到 `'replace'`、`'add'`、`'toggle'`；未匹配为 `'replace'`。 |

`ModifierCombo` 为 `'none'`，或按 `shift+ctrl+alt+meta` 顺序拼接；`meta` 与 `ctrl` 等价。

### 点击选择

`map.clickSelect` 处理主键点击；命中按模式写入选择，空白处的 `'replace'` 点击清空选择。默认组合键：`replace: 'none'`、`add: 'shift'`、`toggle: 'shift+alt'`。

```ts
map.clickSelect.setOptions({
  layers: ['lots'],
  modifiers: { replace: 'none', add: 'shift', toggle: 'shift+alt' },
});
map.clickSelect.enable();
```


### 框选

`map.boxSelect` 用主键拖拽绘制矩形，查询像素包围盒内的要素。默认组合键：`replace: 'none'`、`add: 'shift'`、`toggle: 'shift+alt'`。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `dragThreshold` | `number` | `4` | 触发选择的最小拖拽对角线（CSS 像素）。 |
| `dragActivator` | `ModifierCombo` | `'none'` | 按下主键时所需组合键。 |
| `style` | `BoxSelectStyle` | 见下表 | 矩形预览样式。 |

模式匹配先从松开时的组合键移除 `dragActivator`，再查 `modifiers`。

| `style` 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `stroke` | `string` | 当前主题主色 | 虚线边框颜色。 |
| `strokeWidth` | `number` | `1.5` | 边框宽度（CSS 像素）。 |
| `fill` | `string` | `'transparent'` | 矩形填充色。 |

```ts
map.boxSelect.setOptions({
  layers: ['lots'],
  dragActivator: 'shift',
  modifiers: { replace: 'none', add: 'ctrl', toggle: 'alt' },
});
map.boxSelect.enable();
```

### 套索

`map.lassoSelect` 将自由拖拽闭合为多边形：先按包围盒查询，再按套索筛选。默认启动键 `'shift'`；默认组合键为 `replace: 'none'`、`add: 'ctrl'`、`toggle: 'alt'`。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `dragThreshold` | `number` | `4` | 最小套索包围盒对角线（CSS 像素）。 |
| `dragActivator` | `ModifierCombo` | `'shift'` | 主键按下时启动套索的组合键。 |
| `includeIntersecting` | `boolean` | `true` | `true` 选择相交要素；`false` 仅选择完全包含的要素。 |
| `style` | `LassoSelectStyle` | 见下表 | SVG 套索预览样式。 |

| `style` 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `stroke` | `string` | 当前主题主色 | 折线颜色。 |
| `strokeWidth` | `number` | `1.5` | 折线宽度（CSS 像素）。 |
| `fill` | `string` | `'none'` | 闭合区域填充色。 |
| `strokeDasharray` | `string` | `'4 3'` | SVG 虚线节奏。 |

框选和套索共用拖拽手势；切换时先关闭当前 Handler：

```ts
map.boxSelect.disable();
map.lassoSelect.setOptions({ layers: ['lots'], includeIntersecting: true });
map.lassoSelect.enable();
```

## 监听选择变化

三个 Handler 通过 `map.select()` 写入结果；订阅 `selectionchange` 可观察程序调用和手势造成的集合变化：

```ts
map.on('selectionchange', ({ selected, added, removed }) => {
  const selectionUpdate = { selected, added, removed };
});
```

| 事件字段 | 类型 | 说明 |
| --- | --- | --- |
| `selected` | `FeatureRef[]` | 变更后的完整选择。 |
| `added` | `FeatureRef[]` | 本次新增引用。 |
| `removed` | `FeatureRef[]` | 本次移除引用。 |

批量数据操作通过 `map.ops` 执行，以更新选择、空间索引和渲染。

## 可运行示例

- [要素选择](/mapseekai/emap/examples/feature-selection/)
- [框选](/mapseekai/emap/examples/lasso-select/)
- [套索选择](/mapseekai/emap/examples/lasso-select/)
