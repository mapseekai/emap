---
id: events
slug: /reference/events
title: 事件参考
api: ["Emap", "EmapEventMap", "CameraEvent", "LayerChangeEvent", "EventListener", "FeatureEvent", "FeatureEventFilter", "PointerMoveEvent"]
examples: ["feature-selection","web-worker"]
stability: stable
verifiedVersion: 0.12.0
---

# 事件参考

`Emap` 用 `on`、`once` 和 `off` 订阅事件；已知事件名会推断 payload 类型。

```ts
map.once('moveend', (event) => {
  // 仅监听下一次移动结束
  console.log(event.center, event.zoom); // 读取最终视图
}); // 自动取消监听
```

## 核心方法

| 方法 | 参数 | 说明 |
| --- | --- | --- |
| `on(type, listener)` / `once(type, listener)` | `keyof EmapEventMap \| string`、`EventListener<T>` | 注册持续 / 一次性监听；已知名称推断 payload。 |
| `off(type, listener)` | `keyof EmapEventMap \| string`、`EventListener<T>` | 按函数引用移除监听。 |

`EventListener<T>` 接收 `{ type: string } & T`；`EmapEventMap` 可通过声明合并扩展。

## 核心事件

| 事件 | payload | 触发时机 |
| --- | --- | --- |
| `movestart` / `move` / `moveend` | `CameraEvent` / `Partial<CameraEvent>` / `CameraEvent` | 相机移动开始 / 改变 / 结束。 |
| `zoomstart` / `zoom` / `zoomend` | `CameraEvent` | 缩放开始 / 改变 / 结束。 |

### 相机 payload

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `type` | 对应事件名的字面量类型 | — | 事件名。 |
| `center` | `[number, number]` | `move` 中可选 | 相机中心坐标。 |
| `zoom` | `number` | `move` 中可选 | `log2(scale)`。 |
| `originalEvent` | `MouseEvent \| null` | `move` 中可选；编程式移动为 `null` | 触发移动的鼠标事件。 |

除 `move` 外的相机事件始终提供完整 `CameraEvent`。

## 更多地图状态事件

| 事件 | payload | 触发时机 |
| --- | --- | --- |
| `crschange` | `Record<never, never>` | 地图坐标参考系改变。 |
| `resize` | `Record<never, never>` | 地图容器尺寸改变。 |
| `data` | 数据源变更信息 | 数据源加载、编辑、替换或重投影。 |
| `layerchange` | `LayerChangeEvent` | 图层添加、移除、显示状态、有效图层集或显示过滤改变。 |
| `editmodechange` | 编辑模式 | 编辑模式改变。 |
| `selectionchange` | 选择集差异 | 选择集改变。 |
| `historychange` | `Partial<HistoryStateSnapshot>` | 历史记录改变或历史栈清空。 |
| `validationfailed` | 验证失败结果 | 提交后的验证返回失败结果。 |
| `warning` | 样式诊断 | 样式解析产生诊断。 |
| `error` | 错误诊断 | 地图操作或监听器报告错误。 |

### 状态 payload

所有状态事件含对应字面量 `type`；`crschange` 和 `resize` 没有其他 payload。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `data.sourceId` | `string` | 省略 | 变更 source ID。 |
| `data.reason` | `'edit' \| 'load' \| 'replace' \| 'reproject'` | 省略 | 变更类别。 |
| `data.origin` | `'external'` | 省略 | 外部输入替换标记。 |
| `layerchange.reason` | `'add' \| 'remove' \| 'visibility' \| 'effective' \| 'filter'` | — | 图层变更原因。 |
| `layerchange.layerId` | `string` | 省略 | 直接操作的图层 ID。 |
| `layerchange.layers` | `readonly LayerSpecification[]` | — | 变更后的图层快照。 |
| `editmodechange.mode` | `'none' \| 'vertex' \| 'draw' \| 'split' \| 'measure' \| 'transform' \| 'reshape' \| 'auto-complete' \| 'ring' \| 'part'` | — | 当前编辑模式。 |
| `selectionchange.selected` | `FeatureRef[]` | — | 完整选择集。 |
| `selectionchange.added` | `FeatureRef[]` | — | 新增要素引用。 |
| `selectionchange.removed` | `FeatureRef[]` | — | 移除要素引用。 |
| `historychange.canUndo` | `boolean` | 省略 | 是否可撤销。 |
| `historychange.canRedo` | `boolean` | 省略 | 是否可重做。 |
| `historychange.label` | `string` | 省略 | 最近命令标签。 |
| `historychange.staleCount` | `number` | 省略 | stale 命令数。 |
| `historychange.topIsStale` | `boolean` | 省略 | 下一次撤销是否 stale。 |
| `historychange.skippedStale` | `boolean` | 省略 | 跨越 stale 命令后的提示。 |
| `validationfailed.results` | `ValidatorResult[]` | — | 失败验证器结果。 |
| `validationfailed.results[].report.ok` | `boolean` | — | 仅 warning 或无 issue 时为 `true`。 |
| `validationfailed.results[].report.issues` | `ValidationIssue[]` | — | 验证问题列表。 |
| `validationfailed.label` | `string` | — | 触发验证的命令标签。 |
| `warning.layerId` | `string` | — | 样式诊断图层 ID。 |
| `warning.buckets` | `number` | 省略 | 样式桶数量。 |
| `warning.error` | `unknown` | 省略 | 样式表达式错误。 |
| `error.error` | `Error` | — | 原始错误。 |
| `error.layerId` | `string` | 省略 | 关联图层 ID。 |
| `error.filterExpression` | `StyleExpression` | 省略 | 失败的过滤表达式。 |
| `error.valueType` | `string` | 省略 | 触发错误的值类型。 |

## 更多指针与要素事件

| 事件 | payload | 用途 |
| --- | --- | --- |
| `mousemove` | `PointerMoveEvent` | 读取容器像素坐标、地图坐标和原始 DOM 事件。 |
| `feature:click` | `FeatureEvent` | 处理命中的要素点击。 |
| `feature:hover` | `FeatureEvent` | 持续响应指针位于要素上方的移动。 |
| `feature:enter` / `feature:leave` | `FeatureEvent` | 处理指针进入 / 离开命中的要素。 |

### 指针与要素 payload

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `mousemove.point` | `{ x: number; y: number }` | — | 容器 CSS 像素坐标。 |
| `mousemove.mapCoord` | `[number, number]` | — | `unproject()` 的数据坐标。 |
| `mousemove.originalEvent` | `Event` | — | 原始 DOM 事件。 |
| `feature.type` | `string` | — | 要素事件名。 |
| `feature.feature` | `Feature` | — | 命中要素的只读视图。 |
| `feature.ref` | `FeatureRef` | — | 命中要素引用。 |
| `feature.point` | `{ x: number; y: number }` | — | 命中处 CSS 像素坐标。 |
| `feature.lngLat` | `[number, number]` | — | 命中处数据坐标。 |
| `feature.modifiers` | `{ shift: boolean; ctrl: boolean; alt: boolean; meta: boolean }` | — | 修饰键状态。 |
| `feature.originalEvent` | `Event` | — | 原始 DOM 事件。 |

### 要素事件过滤

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `source` | `string` | 省略时匹配全部 source | 按 `ref.source` 过滤。 |
| `layers` | `string[]` | 省略时匹配全部可见 source layer | 按 `ref.layer` 过滤。 |

`FeatureRef` 为 `{ source, layer, id }` 要素标识。

```ts
map.on('feature:click', { source: 'parcels', layers: ['lots'] }, (event) => {
  // 仅监听 parcels 的 lots
  console.log(event.ref, event.lngLat); // 读取要素和命中坐标
}); // 注册持续监听
```

## API

- [src.EmapEventMap](/mapseekai/emap/api/interfaces/emap.EmapEventMap.html)
- [src.EventListener](/mapseekai/emap/api/types/emap.EventListener.html)
- [src.FeatureEvent](/mapseekai/emap/api/interfaces/emap.FeatureEvent.html)

## 可运行示例

- [feature-selection](/mapseekai/emap/examples/feature-selection/)
- [web-worker](/mapseekai/emap/examples/web-worker/)
