---
slug: /data/formats
title: 数据格式
---

# 数据格式

核心导入支持 GeoJSON、TopoJSON、Shapefile ZIP、KML 和 mapshaper project。可选 formats 入口提供 GeoParquet 与 GeoArrow 导入导出。

## 行为说明

从 bytes 加载时传入 `filename`，因为解析器按扩展名选择。GeoParquet 与 GeoArrow 需要初始化 formats 入口中的可选 WASM。

## API

- [src.TopologySource](https://zwishing.github.io/emap/api/classes/index.TopologySource.html)
- [src_formats.importGeoParquet](https://zwishing.github.io/emap/api/functions/src_formats.importGeoParquet.html)
- [src_formats.exportGeoArrow](https://zwishing.github.io/emap/api/functions/src_formats.exportGeoArrow.html)

## 可运行示例

- [geoparquet-viewer](https://zwishing.github.io/emap/examples/geoparquet-viewer/)
- [export-geoparquet](https://zwishing.github.io/emap/examples/export-geoparquet/)
- [export-roundtrip](https://zwishing.github.io/emap/examples/export-roundtrip/)

## 最小片段

```ts
await source.setData({ filename: "districts.geojson", content })
await initParquetWasm({ module })
```
