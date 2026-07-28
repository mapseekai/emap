---
id: file-upload
slug: /recipes/file-upload
title: 文件上传
api: ["TopologySource.fromBytes"]
examples: ["geoparquet-viewer","getting-started/points"]
stability: stable
verifiedVersion: 0.5.0
---

# 文件上传

浏览器文件输入使用 `TopologySource.fromBytes`。保留原始 filename，让 mapshaper 能选择导入器并处理格式相关的 sidecar 行为。

## 行为说明

捕获加载错误，展示可重试消息，并只在 Promise 成功后添加 source/layer。

## API

- [src.TopologySource](/emap/api/classes/index.TopologySource.html)
- [src.TopologySourceFromBytesOptions](/emap/api/interfaces/index.TopologySourceFromBytesOptions.html)

## 可运行示例

- [geoparquet-viewer](/emap/examples/geoparquet-viewer/)
- [getting-started/points](/emap/examples/getting-started/points/)

## 最小片段

```ts
const file = input.files?.[0]
const source = await TopologySource.fromBytes("upload", await file.arrayBuffer(), { filename: file.name })
```
