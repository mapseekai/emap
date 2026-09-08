---
id: faq
slug: /reference/faq
title: FAQ
api: ["Emap","MapOptions","TopologySource","SourceLoadError"]
examples: ["geoparquet-viewer","web-worker"]
stability: stable
verifiedVersion: 0.9.0
---

# FAQ

## 为什么地图空白？

确认地图容器及其父级有非零宽度和高度；导入 `@mapseekai/emap/style.css`；等待 `TopologySource` 加载完成后调用 `map.addSource(...)`；使图层的 `source` 与注册的 source ID 一致；并用 `map.setExtent(source.getExtent())` 或相机方法将视图移动到数据范围。

## 如何加载自己的文件？

从 URL 创建数据源：

```ts
const source = await TopologySource.fromUrl("roads", "/data/roads.geojson")
await map.addSource("roads", source)
map.setExtent(source.getExtent())
```

URL 必须可被浏览器访问；跨域 URL 必须返回允许应用访问的 CORS 响应头。二进制内容可通过 `new TopologySource(id)` 后的 `setData({ filename, content })` 载入。`filename` 的扩展名决定导入格式。

## 为什么图层没有显示？

图层的 `type` 必须匹配 source layer 的几何类型，`source` 必须匹配 source ID。source 可以对应多个渲染图层，后添加的图层位于更靠上的绘制顺序。

## 何时需要 Worker？

仅在将较重的数据处理移出主线程时设置 `useWorker` 和 `workerUrl`。应用将 `emap-worker.js` 和同目录的 `mapshaper-vendor.js` 发布为页面可访问的资源。

## 如何使用 Arrow、GeoParquet 或 DuckDB？

从 `@mapseekai/emap/arrow` 导入 Arrow、GeoArrow 和 GeoParquet API，并安装 `apache-arrow`；GeoParquet 还安装 `parquet-wasm`。从 `@mapseekai/emap/duckdb` 导入 DuckDB API，并安装 `@duckdb/duckdb-wasm` 和 `apache-arrow`。各入口的 peer 依赖见[兼容性](./compatibility.md)。

## 如何处理操作失败？

检查 `OpResult` 的 `ok` 字段；失败时按 `error.kind` 显示恢复操作或记录诊断。source 预检和加载错误以 `SourceLoadError` 的 `code` 和 `diagnostics` 提供详情。

## API

- [src.Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [src.TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)
- [src.SourceLoadError](/mapseekai/emap/api/classes/emap.SourceLoadError.html)

## 可运行示例

- [geoparquet-viewer](/mapseekai/emap/examples/geoparquet-viewer/)
- [web-worker](/mapseekai/emap/examples/web-worker/)
