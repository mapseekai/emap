---
id: formats
slug: /data/formats
title: 数据格式
api: ["buildGeoMetadata","crsStringToProjjson","decodeWkb","detectGeometryColumn","Emap","exportGeoArrow","ExportGeoArrowOptions","exportGeoParquet","ExportGeoParquetOptions","fromArrowTable","FromArrowTableOptions","GeoColumnMetadata","GeoEncoding","GeoMetadata","GeometryColumnInfo","importGeoArrow","ImportGeoArrowOptions","importGeoParquet","ImportGeoParquetOptions","initParquetWasm","InitParquetWasmOptions","ParquetWasmModule","ParquetWasmTable","parseGeoMetadata","projjsonToCrsString","registerArrowFormats","setArrowTable","setParquetWasm","toArrowTable","toArrowTableFromSource","ToArrowTableOptions","TopologySource.fromBytes","WkbGeometry","WkbWriter"]
examples: ["duckdb-geoparquet-query","export-geoparquet","export-roundtrip","geoparquet-viewer"]
stability: stable
verifiedVersion: 0.5.0
---

# 数据格式

emap 把核心格式和可选格式分开，避免只加载 GeoJSON 的应用承担 Arrow、Parquet
和 WASM 依赖。

## 支持矩阵

| 格式 | 常见扩展名 | 导入 | 导出 | 入口 |
|---|---|---|---|---|
| GeoJSON | `.json`、`.geojson` | 是 | 是 | core |
| TopoJSON | `.topojson`、`.json` | 是 | 是 | core |
| Shapefile ZIP | `.zip` | 是 | 是，输出 ZIP | core |
| KML | `.kml` | 是 | 否 | core |
| mapshaper snapshot | `.msx` | 是 | 是 | core |
| GeoParquet | `.parquet`、`.geoparquet` | 是 | 是 | `@zwishing/emap/arrow` |
| GeoArrow | `.arrow`、`.arrows`、`.feather` | 是 | 是 | `@zwishing/emap/arrow` |

## 从 URL 加载

```ts
const source = await TopologySource.fromUrl(
  'districts',
  '/data/districts.geojson',
);
```

URL 路径或响应 Content-Type 用于推断格式。通用
`application/octet-stream` 无法表达真实扩展名时，优先使用保留文件名的 bytes API。

## 从 bytes 加载

```ts
const bytes = new Uint8Array(await file.arrayBuffer());
const source = await TopologySource.fromBytes('upload', bytes, {
  filename: file.name,
});
```

`filename` 决定导入器。不要把所有上传内容统一命名为 `data.bin`。

也可以复用 source：

```ts
await source.setData({
  filename: 'roads.topojson',
  content: bytes,
});
```

`setData` 在 dataset 已填充且 `data` 事件发出后 resolve。较晚开始的新加载会取代旧加载。

## Shapefile ZIP

ZIP 中至少应包含 `.shp`，通常还包括：

- `.dbf`：属性
- `.shx`：索引
- `.prj`：CRS

emap 对 ZIP 设置 entry 数量、总解压大小和压缩比限制，避免浏览器解压异常归档。
上传时保留完整 ZIP，不要只把 `.shp` 内容传给 `fromBytes`。

## 启用 GeoParquet 和 GeoArrow

在任何 parquet/arrow `setData` 或 export 之前导入：

```ts
import '@zwishing/emap/arrow';
```

该导入注册格式插件。GeoArrow 不需要 WASM；GeoParquet 第一次使用时会懒加载
`parquet-wasm`。Vite 和 webpack 5 等能输出 WASM asset 的 bundler 通常无需额外配置。

显式指定 WASM 地址：

```ts
import { initParquetWasm } from '@zwishing/emap/arrow';

await initParquetWasm({
  wasmInput: '/assets/parquet_wasm_bg.wasm',
});
```

如果应用已经初始化模块：

```ts
import { setParquetWasm } from '@zwishing/emap/arrow';

setParquetWasm(parquetModule);
```

旧示例中的 `initParquetWasm({ module })` 不符合当前签名；选项名是 `wasmInput`，
或使用 `setParquetWasm(module)` 注入。

## Arrow Table 互操作

```ts
import {
  fromArrowTable,
  setArrowTable,
  toArrowTable,
} from '@zwishing/emap/arrow';

setArrowTable(source, duckdbResultTable);
const table = toArrowTable(source.getDataset()!);
const dataset = fromArrowTable(table);
```

这条路径直接转换坐标 buffers，不需要先序列化成 GeoJSON。

## 导出

`TopologySource.export` 始终返回一个 `Blob`：

```ts
const blob = await source.export({
  format: 'geojson',
});
```

Shapefile 的多文件结果会打包成一个 ZIP Blob。

GeoParquet：

```ts
const blob = await source.export({
  format: 'geoparquet',
  layer: 'districts',
  encoding: 'wkb',
});
```

GeoParquet 默认 WKB，适合 DuckDB、GeoPandas 和 GDAL。GeoArrow 默认 native
coordinate encoding。两种可选格式一次导出一个 layer，`layer` 可用名称或索引。

## 下载 Blob

```ts
const url = URL.createObjectURL(blob);
const link = document.createElement('a');
link.href = url;
link.download = 'districts.geojson';
link.click();
URL.revokeObjectURL(url);
```

## 常见问题

### 提示需要 Arrow module

确保 `import '@zwishing/emap/arrow'` 在第一次调用前执行，并确认 bundler 没有把
该 side-effect import 移除。

### Parquet WASM 404

让 bundler 管理默认 WASM asset，或通过 `wasmInput` 传入最终公开 URL。

### Shapefile 没有属性或 CRS

确认 ZIP 同时包含匹配 basename 的 `.dbf` 和 `.prj`。

## API

- [TopologySource](/emap/api/classes/index.TopologySource.html)
- [ExportOptions](/emap/api/interfaces/index.ExportOptions.html)
- [initParquetWasm](/emap/api/functions/arrow.initParquetWasm.html)
- [setParquetWasm](/emap/api/functions/arrow.setParquetWasm.html)
- [toArrowTable](/emap/api/functions/arrow.toArrowTable.html)

## 可运行示例

- [GeoParquet 查看器](/emap/examples/geoparquet-viewer/)
- [导出 GeoParquet](/emap/examples/export-geoparquet/)
- [导出往返](/emap/examples/export-roundtrip/)
