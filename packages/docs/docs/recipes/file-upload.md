---
id: file-upload
slug: /recipes/file-upload
title: 文件上传
api: ["TopologySource.fromBytes","TopologySource","TopologySourceFromBytesOptions"]
examples: ["flatgeobuf-viewer", "geoparquet-viewer", "getting-started/points"]
stability: stable
verifiedVersion: 0.9.0
---

# 文件上传

使用 `TopologySource.fromBytes` 导入浏览器 `File`。文件名的扩展名用于选择导入格式；导入成功后，返回的 source 可以加入 `Emap`。

## 上传并限制 ZIP 解压

为 ZIP 上传设置 `zipLimits`，限制压缩输入大小、解压后的总字节数、文件数量和压缩比。导入失败时 `fromBytes` 会 reject，因此在应用边界显示错误并保持地图可用。

```ts
const file = input.files?.[0]
if (!file) return

const source = await TopologySource.fromBytes("upload", await file.arrayBuffer(), {
  filename: file.name,
  zipLimits: {
    maxCompressedBytes: 50 * 1024 * 1024,
    maxBytes: 200 * 1024 * 1024,
    maxEntries: 1_000,
    maxRatio: 100,
  },
})
await map.addSource(source.id, source)
```

`filename` 应保留用户选择的名称。核心导入支持 GeoJSON、TopoJSON、Shapefile ZIP、KML、MSX 和其他已注册格式；GeoParquet 与 GeoArrow 由 `@mapseekai/emap/arrow` 提供，FlatGeobuf 需要应用注册其格式插件。

## API

- `TopologySource`
- `TopologySourceFromBytesOptions`

## 可运行示例

- [GeoParquet 查看器](/mapseekai/emap/examples/geoparquet-viewer/)
- [FlatGeobuf 查看器](/mapseekai/emap/examples/flatgeobuf-viewer/)
- [点图层入门](/mapseekai/emap/examples/getting-started/points/)