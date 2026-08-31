---
id: file-upload
slug: /recipes/file-upload
title: 文件上传
api: ["TopologySource.fromBytes"]
examples: ["flatgeobuf-viewer","geoparquet-viewer","getting-started/points"]
stability: stable
verifiedVersion: 0.8.1
---

# 文件上传

浏览器文件输入使用 `TopologySource.fromBytes`。保留原始 filename，让 mapshaper 能选择导入器并处理格式相关的 sidecar 行为。

## 行为说明

捕获加载错误，展示可重试消息，并只在 Promise 成功后添加 source/layer。

上传 FlatGeobuf `.fgb` 前，应用必须先注册本地 `flatgeobuf` 格式插件；该插件不是 core
或 `@mapseekai/emap/arrow` 的包入口。请按[数据格式](../data/formats.md)中的安装和
`installFlatGeobufFormat(emap)` 步骤完成注册；这里的 `emap` 是模块命名空间，不是
`Emap` 地图实例。注册完成后再调用 `fromBytes`。可参考
[FlatGeobuf 查看器](/mapseekai/emap/examples/flatgeobuf-viewer/)。

## API

- [src.TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)
- [src.TopologySourceFromBytesOptions](/mapseekai/emap/api/interfaces/emap.TopologySourceFromBytesOptions.html)

## 可运行示例

- [geoparquet-viewer](/mapseekai/emap/examples/geoparquet-viewer/)
- [flatgeobuf-viewer](/mapseekai/emap/examples/flatgeobuf-viewer/)
- [getting-started/points](/mapseekai/emap/examples/getting-started/points/)

## 最小片段

```ts
const file = input.files?.[0]
if (!file) throw new Error("请选择文件")
const source = await TopologySource.fromBytes("upload", await file.arrayBuffer(), {
  filename: file.name,
})
```
