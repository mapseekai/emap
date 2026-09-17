---
id: events
slug: /guides/events
title: 事件
api: ["CameraEvent", "Emap", "EmapEventMap", "EventDispatcher", "EventListener", "FeatureEvent", "FeatureEventFilter"]
examples: ["feature-attributes","interaction-handlers"]
stability: stable
verifiedVersion: 0.12.0
---

# 事件

`Emap` 继承 `EventDispatcher`：已知事件从 `EmapEventMap` 推导载荷，字符串事件使用 `EventListener<T>`。

```ts
const onMoveEnd = (event: { type: 'moveend'; center: [number, number]; zoom: number }) => {
  const view = { center: event.center, zoom: event.zoom }; // 保存稳定视图
};
map.on('moveend', onMoveEnd); // 持续订阅
map.once('data', () => map.getSelection()); // 首次数据事件后移除
map.off('moveend', onMoveEnd); // 用同一函数移除监听
```

## 核心方法

`on`、`once` 和 `off` 均返回 `this`：

```ts
map.on<K extends keyof EmapEventMap>(
  type: K,
  listener: (event: { type: K } & EmapEventMap[K]) => void,
): this;

map.once<K extends keyof EmapEventMap>(
  type: K,
  listener: (event: { type: K } & EmapEventMap[K]) => void,
): this;

map.off<K extends keyof EmapEventMap>(
  type: K,
  listener: (event: { type: K } & EmapEventMap[K]) => void,
): this;

map.on<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
map.once<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
map.off<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
```

`type` 为 `keyof EmapEventMap` 事件名，字符串重载支持自定义事件；`listener` 接收带 `type` 的载荷。`on` 持续订阅；`once` 首次投递前移除自身；`off` 用同一原始函数移除或取消一次订阅。

## 更多订阅方式

### 要素事件过滤

四个要素事件支持以下重载；省略 `options` 时监听可见要素：

```ts
map.on(type: string, listener: (event: FeatureEvent) => void): this;
map.on(type: string, options: FeatureEventFilter, listener: (event: FeatureEvent) => void): this;
map.once(type: string, listener: (event: FeatureEvent) => void): this; // 同样接受 options 过滤
map.off(type: string, listener: (event: FeatureEvent) => void): this;
```

```ts
const showFeature = (event: FeatureEvent) => {
  map.setHighlightedFeatures([event.ref]);
};

map.on('feature:click', { layers: ['lots'] }, (event) => map.select([event.ref]));
map.once('feature:enter', { source: 'parcels' }, showFeature);
map.off('feature:enter', showFeature);
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `type` | `'feature:click' \| 'feature:hover' \| 'feature:enter' \| 'feature:leave'` | — | 要素事件名。 |
| `options` | `FeatureEventFilter` | 省略 | 命中过滤：`source` 匹配 `FeatureRef.source`，`layers` 匹配 `FeatureRef.layer` 并收敛查询。 |
| `listener` | `(event: FeatureEvent) => void` | — | 接收要素、坐标和原始 DOM 事件。 |

`FeatureEvent` 为 `{ type, feature, ref, point, lngLat, modifiers, originalEvent }`：`ref` 是 `{ source, layer, id }`，`point` 是本地像素，`lngLat` 是源数据坐标，`modifiers` 包含四个修饰键，`originalEvent` 是 DOM `Event`。

## 事件载荷

除 `mousemove` 外，以下 `EmapEventMap` 事件载荷均带 `type`。

### 相机

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `movestart` | `CameraEvent`: `center: [number, number]`, `zoom: number`, `originalEvent: MouseEvent \| null` | 相机移动或缩放开始。 |
| `move` | `Partial<CameraEvent>`: `center`、`zoom`、`originalEvent` 可选 | 平移过程；可仅含 `type`。 |
| `moveend` | `CameraEvent` | 稳定后的中心和缩放。 |
| `zoomstart` / `zoom` / `zoomend` | `CameraEvent` | 缩放开始、过程和结束。 |

`CameraEvent.zoom` 为 `log2(scale)`；程序化调用的 `originalEvent` 为 `null`。

### 生命周期、数据与图层

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `crschange` | `{ type: 'crschange' }` | CRS 更新。 |
| `resize` | `{ type: 'resize' }` | 画布尺寸更新。 |
| `data` | `{ sourceId?: string; reason?: 'edit' \| 'load' \| 'replace' \| 'reproject'; origin?: 'external' }` | 数据变更；`origin: 'external'` 标识外部替换。 |
| `layerchange` | `{ reason: 'add' \| 'remove' \| 'visibility' \| 'effective' \| 'filter'; layerId?: string; layers: readonly LayerSpecification[] }` | 图层变更。 |

### 编辑、诊断与选择

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `editmodechange` | `{ mode: 'none' \| 'vertex' \| 'draw' \| 'split' \| 'measure' \| 'transform' \| 'reshape' \| 'auto-complete' \| 'ring' \| 'part' }` | 编辑模式变更。 |
| `historychange` | `Partial<{ canUndo: boolean; canRedo: boolean; label?: string; staleCount: number; topIsStale: boolean; skippedStale?: boolean }>` | 历史状态变更；可仅含 `type`。 |
| `selectionchange` | `{ selected: FeatureRef[]; added: FeatureRef[]; removed: FeatureRef[] }` | 选择集与增量变更。 |
| `validationfailed` | `{ results: ValidatorResult[]; label: string }`；每项为 `{ validator: string; report: { ok: boolean; issues: Array<{ severity: 'error' \| 'warning'; message: string; ref?: FeatureRef }> } }` | 验证诊断。 |
| `error` | `{ error: Error; layerId?: string; filterExpression?: StyleExpression; valueType?: string }` | 操作或样式表达式错误。 |
| `warning` | `{ layerId: string; buckets?: number; error?: unknown }` | 样式诊断。 |

### 其他地图运行时事件

字符串重载也接收以下地图运行时事件。

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `feature_created` | `{ id: number; source: string; layer: string; geometryType: 'polygon' \| 'polyline' \| 'point'; properties: Record<string, unknown> }` | 新要素提交。 |
| `vertex_moved` | `{ id: number; source: string; layer: string; vertexIndex: number \| null; vertexIds: number[]; coords: [number, number] }` | 顶点拖动完成。 |
| `workerjobstart` | `{ id: number; cmd: string; label: string; datasetVertexCount: number }` | Worker 任务开始。 |
| `workerjobend` | `{ id: number; ok: boolean; durationMs: number; errorMessage?: string }` | Worker 任务完成。 |

### 指针与要素

`mousemove` 使用专用重载：

```ts
map.on(type: 'mousemove', listener: (event: PointerMoveEvent) => void): this;
map.once(type: 'mousemove', listener: (event: PointerMoveEvent) => void): this;
map.off(type: 'mousemove', listener: (event: PointerMoveEvent) => void): this;
```

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `mousemove` | `PointerMoveEvent`: `point: { x, y }`, `mapCoord: [number, number]`, `originalEvent: Event` | 指针坐标；无 `type`，不做命中测试。 |
| `feature:click` / `feature:hover` / `feature:enter` / `feature:leave` | `FeatureEvent` | 命中要素的点击、经过、进入和离开。 |

## 高频事件

`move`、`zoom`、`mousemove` 和 `feature:hover` 可高频触发；用 `requestAnimationFrame` 合并 DOM 更新。

## 可运行示例

- [要素属性](/mapseekai/emap/examples/feature-attributes/)
- [交互 Handler](/mapseekai/emap/examples/interaction-handlers/)
