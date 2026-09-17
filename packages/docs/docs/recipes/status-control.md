---
id: status-control
slug: /recipes/status-control
title: 状态控件
api: ["Emap", "StatusControl", "StatusOptions"]
examples: ["duckdb-geoparquet-query", "duckdb-query", "web-worker"]
stability: stable
verifiedVersion: 0.12.0
---

# 状态控件

`StatusControl` 显示鼠标坐标和地图 CRS。
```ts
await map.addControl(
  // 挂载控件
  new StatusControl({
    showMousePos: true, // 显示指针坐标
    showEPSG: true, // 显示地图 CRS
    alignment: 'right', // 对齐读数
  }),
  'bottom-left', // 选择控件角落
);
```

## 核心参数


### 控件参数

`new StatusControl(options?)` 接受可选 `StatusOptions`；省略时显示两类读数并左对齐。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `showMousePos` | `boolean` | `true` | 显示当前指针的 `mapCoord`（四位小数）；设为 `false` 显示紧凑的仅 CRS 状态栏 |
| `showEPSG` | `boolean` | `true` | 显示地图 CRS；挂载时读取并随 `crschange` 刷新，常见别名规范为 `EPSG:4326`、`EPSG:3857` 等 |
| `alignment` | `'left' \| 'right' \| 'center'` | `'left'` | 控件内容的水平对齐 |
| `className` | `string` | 未设置 | 追加到控件根元素的 CSS 类名 |

## 更多挂载选项

通过 `Emap` 挂载和移除控件；`removeControl()` 会释放订阅并移除 DOM。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `control` | `Control` | 必填 | 要挂载的控件实例；同一实例一次只能挂载在一个位置 |
| `position` | `'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'` | `'top-left'` | 控件区域；状态栏通常使用 `'bottom-left'` 或 `'bottom-right'` |

`map.addControl(control, position)` 和 `map.removeControl(control)` 都返回 `Promise<void>`；后者接收同一控件实例。

## API

- `Emap`
- `StatusControl`
- `StatusOptions`

## 可运行示例

- [DuckDB GeoParquet 查询](/mapseekai/emap/examples/duckdb-geoparquet-query/)
- [DuckDB 查询](/mapseekai/emap/examples/duckdb-query/)
- [Web Worker](/mapseekai/emap/examples/web-worker/)
