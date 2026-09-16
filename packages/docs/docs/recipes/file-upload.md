---
id: file-upload
slug: /recipes/file-upload
title: 文件上传
api: ["TopologySource.fromBytes", "TopologySource", "TopologySourceFromBytesOptions"]
examples: ["flatgeobuf-viewer", "geoparquet-viewer", "getting-started/points"]
stability: stable
verifiedVersion: 0.12.0
---

# 文件上传

使用 `TopologySource.fromBytes` 导入浏览器 `File`，并将成功返回的 source 加入 `Emap`。

```ts
const file = input.files?.[0] // 读取浏览器选中的文件
if (!file) return // 未选择文件时停止

const source = await TopologySource.fromBytes("upload", await file.arrayBuffer(), {
  filename: file.name, // 用扩展名选择导入器
  formats: map.formats, // 包含已注册的格式插件
  resourceLimits: {
    maxInputBytes: 50 * 1024 * 1024, // 限制原始输入
  },
  zipLimits: {
    maxCompressedBytes: 50 * 1024 * 1024, // 限制 ZIP 输入
    maxBytes: 200 * 1024 * 1024, // 限制解压字节
    maxEntries: 1_000, // 限制 ZIP 条目
    maxRatio: 100, // 拒绝 ZIP 炸弹
  },
})
await map.addSource(source.id, source) // 添加导入的 source
```



## 核心参数

### `TopologySource.fromBytes(id, bytes, options?)`

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 必填 | 返回 source 的标识。 |
| `bytes` | `Uint8Array \| ArrayBuffer` | 必填 | 原始文件字节；`ArrayBuffer` 转为 `Uint8Array`。 |
| `options` | `TopologySourceFromBytesOptions` | 省略 | 导入器、格式注册表和资源阈值。 |

## 更多导入选项

`TopologySourceFromBytesOptions` 为不含 `data` 的 `TopologySourceOptions` 增加 `filename`；其余选项也可传给构造函数。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `filename` | `string` | `` `${id}.geojson` `` | 导入文件名，扩展名选择格式；上传时保留 `file.name`。核心扩展名为 `.geojson`、`.topojson`、`.json`、`.zip`、`.shp`、`.kml`、`.msx`。 |
| `formats` | `FormatRegistryContract` | 独立空 `FormatRegistry` | 格式插件注册表；插件格式传入 `map.formats`。 |
| `resourceLimits` | `Partial<ImportResourceLimits>` | 按字段合并默认值 | 原始输入资源阈值。 |
| `resourceLimits.maxInputBytes` | `number` | `2 * 1024 ** 3`（2 GiB） | 单个逻辑导入的原始字节上限，URL、内存和插件导入共享；`setData` 数组按全部文件合计。 |
| `zipLimits` | `ZipExtractionLimits` | 按字段合并下列默认值 | Shapefile ZIP 解压阈值。 |
| `zipLimits.maxCompressedBytes` | `number` | `2 * 1024 ** 3`（2 GiB） | ZIP 压缩输入上限。 |
| `zipLimits.maxBytes` | `number` | `2 * 1024 ** 3`（2 GiB） | 保留 ZIP 条目的解压总字节上限。 |
| `zipLimits.maxEntries` | `number` | `5000` | ZIP 条目数上限。 |
| `zipLimits.maxRatio` | `number` | `100` | 解压字节与压缩输入的最大比值，防护 ZIP 炸弹。 |
| `adapter` | `MapshaperAdapter` | 默认 mapshaper 适配器 | 核心格式导入、导出、变换和范围计算的适配器。 |

## 替换 source 数据

`setData` 用新外部数据重新导入 source，返回 `Promise<TopologySource>`；提交并触发 `data` 后 resolve，异常通过 Promise 和 `error` 事件报告。连续调用由最新调用拥有后续 `data` / `error` 结果，避免快速换文件时的过期结果。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `data` | `TopologySourceInput` | 必填 | URL、单个文件或文件数组；沿用 source 的 `formats`、`resourceLimits` 和 `zipLimits`。 |
| `data`（URL） | `string` | — | URL 导入；路径扩展名选择格式，缺少时可由响应 `Content-Type` 推断。 |
| `data.filename` | `string` | 必填 | 文件名；扩展名选择核心导入器或插件。 |
| `data.content` | `Uint8Array` | 必填 | 文件字节；`setData` 接受 `Uint8Array`。 |
| `data[]` | `Array<{ filename: string; content: Uint8Array }>` | — | 多文件导入；每个文件成为同一 dataset 的 layer，ZIP 展开主 Shapefile 文件。 |

## 创建可复用 source

构造函数可复用 source，并通过 `setData` 接收上传。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 必填 | source 标识。 |
| `options` | `TopologySourceOptions` | 省略 | 支持上表的 `formats`、`resourceLimits`、`zipLimits`、`adapter` 和 `data`。 |
| `options.data` | `TopologySourceInput` | 省略 | 构造时启动导入；需要结果时 `await source.setData(data)`。 |

## API

- `TopologySource`
- `TopologySourceFromBytesOptions`

## 可运行示例

- [GeoParquet 查看器](/mapseekai/emap/examples/geoparquet-viewer/)
- [FlatGeobuf 查看器](/mapseekai/emap/examples/flatgeobuf-viewer/)
- [点图层入门](/mapseekai/emap/examples/getting-started/points/)
