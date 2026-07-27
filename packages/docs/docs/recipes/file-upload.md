---
slug: /recipes/file-upload
title: 文件上传
---

# 文件上传

浏览器文件输入使用 `TopologySource.fromBytes`。保留原始 filename，让 mapshaper 能选择导入器并处理格式相关的 sidecar 行为。

## 行为说明

捕获加载错误，展示可重试消息，并只在 Promise 成功后添加 source/layer。

## API

- [src.TopologySource](https://zwishing.github.io/emap/api/classes/index.TopologySource.html)
- [src.TopologySourceFromBytesOptions](https://zwishing.github.io/emap/api/interfaces/index.TopologySourceFromBytesOptions.html)

## 可运行示例

- [geoparquet-viewer](https://zwishing.github.io/emap/examples/geoparquet-viewer/)
- [getting-started/points](https://zwishing.github.io/emap/examples/getting-started/points/)

## 最小片段

```ts
const file = input.files?.[0]
const source = await TopologySource.fromBytes("upload", await file.arrayBuffer(), { filename: file.name })
```
