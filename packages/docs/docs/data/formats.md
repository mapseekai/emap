---
id: formats
slug: /data/formats
title: 数据格式
api: ["buildGeoMetadata","crsStringToProjjson","DatasetFormatPlugin","decodeWkb","detectGeometryColumn","Emap","ExportedFormatFile","exportGeoArrow","ExportGeoArrowOptions","exportGeoParquet","ExportGeoParquetOptions","fromArrowTable","FromArrowTableOptions","GeoColumnMetadata","GeoEncoding","GeoMetadata","GeometryColumnInfo","importGeoArrow","ImportGeoArrowOptions","importGeoParquet","ImportGeoParquetOptions","initParquetWasm","InitParquetWasmOptions","ParquetWasmModule","ParquetWasmTable","parseGeoMetadata","projjsonToCrsString","registerArrowFormats","registerFormat","setArrowTable","setParquetWasm","toArrowTable","toArrowTableFromSource","ToArrowTableOptions","TopologySource.export","TopologySource.fromBytes","TopologySource.fromUrl","WkbGeometry","WkbWriter","TopologySource","ExportOptions"]
examples: ["export-formats","getting-started/kml-viewer","flatgeobuf-viewer","geoparquet-viewer"]
stability: stable
verifiedVersion: 0.9.1
---

# 数据格式

Emap 使用 `TopologySource` 在浏览器中加载、保存和导出地理数据。核心格式随 `@mapseekai/emap` 提供；GeoParquet、GeoArrow 和 FlatGeobuf 按需启用。

## 支持的格式

| 格式 | 文件扩展名 | 导入 | 导出 | 要求 |
| --- | --- | --- | --- | --- |
| GeoJSON | `.geojson`、`.json` | 是 | 是 | core |
| TopoJSON | `.topojson`、`.json` | 是 | 是 | core |
| Shapefile ZIP | `.zip` | 是 | 是，ZIP Blob | core |
| KML | `.kml` | 是 | 否 | core |
| mapshaper snapshot | `.msx` | 是 | 是 | core |
| GeoParquet | `.parquet`、`.geoparquet` | 是 | 是 | `@mapseekai/emap/arrow` |
| GeoArrow | `.arrow`、`.arrows`、`.feather` | 是 | 是 | `@mapseekai/emap/arrow` |
| FlatGeobuf | `.fgb` | 注册后 | 注册后 | 应用本地插件 |

GeoJSON、TopoJSON 和 KML 在数据未携带坐标系元数据时使用 `EPSG:4326`。KML 只能导入。

## 加载 URL 或 bytes

`TopologySource.fromUrl()` 从 URL 加载数据；文件路径或响应的 Content-Type 用于识别格式。

```ts
import { TopologySource } from '@mapseekai/emap';

const source = await TopologySource.fromUrl(
  'districts',
  '/data/districts.geojson',
);
```

上传文件时，把原始文件名传给 `fromBytes()`。扩展名选择导入器。

```ts
const bytes = new Uint8Array(await file.arrayBuffer());
const source = await TopologySource.fromBytes('upload', bytes, {
  filename: file.name,
});
```

`setData()` 用新的 URL、文件或文件数组重新加载 source；它在 dataset 填充并触发 `data` 事件后完成。后发起的加载取代尚未完成的加载。

```ts
await source.setData({
  filename: 'roads.topojson',
  content: bytes,
});
```

Shapefile 应传入完整 ZIP。ZIP 至少包含 `.shp`，属性、索引和坐标系通常分别来自同名的 `.dbf`、`.shx` 和 `.prj`。`TopologySource` 对压缩输入、解压总量、条目数和压缩比应用 ZIP 限制；通过 `zipLimits` 调整应用的阈值。

## GeoParquet 与 GeoArrow

在导入、导出或 Arrow Table 互操作前导入可选子入口：

```ts
import '@mapseekai/emap/arrow';
```

该导入注册 GeoParquet 和 GeoArrow 格式。GeoParquet 首次使用时加载 `parquet-wasm`；也可以提供 WASM URL 或已初始化模块：

```ts
import { initParquetWasm, setParquetWasm } from '@mapseekai/emap/arrow';

await initParquetWasm({ wasmInput: '/assets/parquet_wasm_bg.wasm' });
setParquetWasm(parquetModule);
```

`TopologySource.export()` 返回一个 `Blob`。GeoParquet 默认使用 WKB 编码，GeoArrow 默认使用 native 坐标编码；两者每次导出一个 layer。

```ts
const blob = await source.export({
  format: 'geoparquet',
  layer: 'districts',
  encoding: 'wkb',
});
```

## FlatGeobuf

FlatGeobuf 由应用安装 `flatgeobuf`，并使用模块级 `registerFormat()` 注册格式插件。插件提供导入器、导出器和 `.fgb` 扩展名；注册完成后使用 `fromBytes()` 或 `export({ format: 'flatgeobuf' })`。完整集成可参考 [FlatGeobuf 查看器](/mapseekai/emap/examples/flatgeobuf-viewer/)。

## 导出和下载

核心格式直接导出：

```ts
const blob = await source.export({ format: 'geojson' });
const url = URL.createObjectURL(blob);
const link = document.createElement('a');
link.href = url;
link.download = 'districts.geojson';
link.click();
URL.revokeObjectURL(url);
```

Shapefile 的 `.shp`、`.shx`、`.dbf` 和可选 `.prj` 文件会打包到一个 ZIP Blob。导出始终使用完整精度的几何。

## API

- [TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)
- [ExportOptions](/mapseekai/emap/api/interfaces/emap.ExportOptions.html)
- [registerFormat](/mapseekai/emap/api/functions/emap.registerFormat.html)
- [DatasetFormatPlugin](/mapseekai/emap/api/interfaces/emap.DatasetFormatPlugin.html)
- [initParquetWasm](/mapseekai/emap/api/functions/arrow.initParquetWasm.html)
- [setParquetWasm](/mapseekai/emap/api/functions/arrow.setParquetWasm.html)

## 可运行示例

- [导出格式](/mapseekai/emap/examples/export-formats/)
- [FlatGeobuf 查看器](/mapseekai/emap/examples/flatgeobuf-viewer/)
- [GeoParquet 查看器](/mapseekai/emap/examples/geoparquet-viewer/)
- [KML 查看器](/mapseekai/emap/examples/getting-started/kml-viewer/)
