---
id: formats
slug: /data/formats
title: 数据格式
api: ["buildGeoMetadata", "crsStringToProjjson", "DatasetFormatPlugin", "decodeWkb", "detectGeometryColumn", "Emap", "ExportedFormatFile", "exportGeoArrow", "ExportGeoArrowOptions", "exportGeoParquet", "ExportGeoParquetOptions", "fromArrowTable", "FromArrowTableOptions", "GeoColumnMetadata", "GeoEncoding", "GeoMetadata", "GeometryColumnInfo", "importGeoArrow", "ImportGeoArrowOptions", "importGeoParquet", "ImportGeoParquetOptions", "initParquetWasm", "InitParquetWasmOptions", "ParquetWasmModule", "ParquetWasmTable", "parseGeoMetadata", "projjsonToCrsString", "registerArrowFormats", "registerFormat", "setArrowTable", "setParquetWasm", "toArrowTable", "toArrowTableFromSource", "ToArrowTableOptions", "TopologySource.export", "TopologySource.fromBytes", "TopologySource.fromUrl", "WkbGeometry", "WkbWriter", "TopologySource", "ExportOptions", "TopologySource.setData"]
examples: ["export-formats","getting-started/kml-viewer","flatgeobuf-viewer","geoparquet-viewer"]
stability: stable
verifiedVersion: 0.12.0
---

# 数据格式

本页描述矢量数据。GeoTIFF/BigTIFF 使用独立的[本地栅格集成](./geotiff.md)，不走 `TopologySource.fromBytes()`：原文件保持外部引用，超过 2GiB 必须具备金字塔。

Emap 通过 `TopologySource` 在浏览器中加载、保存和导出地理数据。核心格式开箱可用；可选入口提供 GeoPackage、GeoParquet、GeoArrow；FlatGeobuf 需注册插件。

```ts
const source = await TopologySource.fromUrl('districts', '/data/districts.geojson'); // 按 URL 和扩展名加载数据
await map.addSource('districts', source); // 将数据添加到地图
const blob = await source.export({ format: 'geojson' }); // 导出当前 dataset
```

## 核心方法

| 方法 | 参数 | 说明 |
| --- | --- | --- |
| `TopologySource.fromUrl(name, url)` | `string`, `string` | 从 URL 加载。 |
| `TopologySource.fromBytes(name, bytes, options?)` | `string`, `Uint8Array`, `TopologySourceOptions` | 从字节加载。 |
| `source.setData(data)` | URL、文件或文件数组 | 替换 source 数据。 |
| `source.export(options)` | `ExportOptions` | 导出 dataset 为 `Blob`。 |

## 核心格式

| 格式 | 文件扩展名 | 导入 | 导出 |
| --- | --- | --- | --- |
| GeoJSON | `.geojson`、`.json` | 是 | 是 |
| TopoJSON | `.topojson`、`.json` | 是 | 是 |
| Shapefile ZIP | `.zip` | 是 | 是，ZIP Blob |
| KML | `.kml` | 是 | 否 |
| mapshaper snapshot | `.msx` | 是 | 是 |

无 CRS 元数据的 GeoJSON、TopoJSON、KML 使用 `EPSG:4326`。

## 更多格式与插件

| 格式 | 文件扩展名 | 导入 | 导出 | 入口 |
| --- | --- | --- | --- | --- |
| GeoPackage | `.gpkg` | 是 | 否 | `@mapseekai/emap/geopackage` |
| GeoParquet | `.parquet`、`.geoparquet` | 是 | 是 | `@mapseekai/emap/arrow` |
| GeoArrow | `.arrow`、`.arrows`、`.feather` | 是 | 是 | `@mapseekai/emap/arrow` |
| FlatGeobuf | `.fgb` | 注册后 | 注册后 | 应用注册格式插件 |

## 加载数据

三个入口共享 `TopologySourceOptions`：

```ts
// 从 URL 加载；路径或响应 Content-Type 用于识别格式
const source = await TopologySource.fromUrl('districts', '/data/districts.geojson');

// 从字节加载；filename 的扩展名选择导入器
const source = await TopologySource.fromBytes('upload', bytes, { filename: file.name });

// 重新加载已存在的 source；后发起的加载取代尚未完成的加载
await source.setData({ filename: 'roads.topojson', content: bytes });
```

`setData()` 完成时触发 `data`；文件数组中的每个文件成为一个 layer。

`TopologySourceOptions` 的核心参数：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `formats` | `FormatRegistryContract` | 空注册表 | 插件格式注册表。 |
| `resourceLimits.maxInputBytes` | `number` | 2 GiB | 单次导入原始字节上限。 |
| `zipLimits` | `ZipExtractionLimits` | 见下表 | Shapefile ZIP 解压限制。 |
| `adapter` | `MapshaperAdapter` | 默认适配器 | mapshaper 适配器。 |

`zipLimits` 阈值：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `maxCompressedBytes` | 2 GiB | 压缩输入上限。 |
| `maxBytes` | 2 GiB | 保留条目解压总大小上限。 |
| `maxEntries` | 5000 | 条目数上限。 |
| `maxRatio` | 100 | 解压比上限，防御 ZIP 炸弹。 |

公开上传应收紧这些阈值。

## 导出数据

`TopologySource.export()` 将内存 dataset 序列化为完整精度的 `Blob`：

```ts
const blob = await source.export({ format: 'geojson' });
const url = URL.createObjectURL(blob);
const link = document.createElement('a');
link.href = url;
link.download = 'districts.geojson';
link.click();
URL.revokeObjectURL(url);
```

`ExportOptions` 的核心参数：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `format` | `ExportFormat` | 必填 | 导出格式。 |
| `layer` | `number \| string` | `0` | GeoParquet / GeoArrow 图层。 |
| `encoding` | `'wkb' \| 'native'` | 见下 | GeoParquet / GeoArrow 几何编码。 |
| `quantization` | `boolean` | `false` | TopoJSON 有损坐标量化。 |

- **GeoJSON**：单文件 `application/geo+json`。
- **TopoJSON**：默认不量化；`quantization: true` 以精度换体积。
- **Shapefile**：`.shp`、`.shx`、`.dbf` 和可选 `.prj` 的 ZIP Blob。
- **mapshaper snapshot**：`.msx`，`application/octet-stream`。
- **GeoParquet**：默认 `wkb`，每次一个 layer。
- **GeoArrow**：默认 `native`，每次一个 layer。

## 各格式说明

### GeoJSON、TopoJSON、KML

核心包直接解析这三种文本格式。

### Shapefile ZIP

传入至少含 `.shp` 的完整 ZIP；同名 `.dbf`、`.shx`、`.prj` 提供属性、索引和 CRS，重复 basename 报错。

### GeoParquet 与 GeoArrow

`/arrow` 提供两种格式；挂载 `arrowFormatsPlugin` 后当前地图可读写。需要 `apache-arrow`，GeoParquet 另需 `parquet-wasm`：

```bash
pnpm add apache-arrow
pnpm add parquet-wasm # 仅 GeoParquet 需要
```

```ts
import { arrowFormatsPlugin } from '@mapseekai/emap/arrow';
await map.ctx.plugin(arrowFormatsPlugin);
```

`parquet-wasm` 首次 GeoParquet 使用时加载；也可指定 WASM 或注入模块：

```ts
import { initParquetWasm, setParquetWasm } from '@mapseekai/emap/arrow';

await initParquetWasm({ wasmInput: '/assets/parquet_wasm_bg.wasm' });
setParquetWasm(parquetModule);
```

导入可用 `geometryColumn` 覆盖几何列探测；导出用 `layer` 和 `encoding`。

### FlatGeobuf

应用安装 `flatgeobuf` 后注册 `registerFormat(map.formats, codec)`；插件提供 `.fgb` 读写。参考 [FlatGeobuf 查看器](/mapseekai/emap/examples/flatgeobuf-viewer/)。

### GeoPackage

`/geopackage` 将矢量表从 SQLite/WKB 直接解码为 typed-buffer dataset，支持主线程、Worker、CRS 归一与取消：

```ts
import { geoPackagePlugin } from '@mapseekai/emap/geopackage';
await map.ctx.plugin(
  geoPackagePlugin({
    workerUrl: '/assets/emap-geopackage-worker.js',
    wasmUrl: '/assets/sql-wasm.wasm',
  }),
);
```

参数：`layers`、`targetCrs`、`wasmUrl`、`workerUrl`、`signal`、`onProgress`；写出请导出 GeoParquet。详见 [GeoPackage 直接导入](geopackage.md)。

## 高级格式注册

核心格式内置于 `TopologySource` 的 mapshaper 适配器；插件格式注册到实例级 `map.formats`。构造 `TopologySource` 时传入 `formats` 接入该注册表。

```text
导入                                      导出
文件 / URL / bytes                        export({ format, layer, encoding })
        │                                        │
        ▼ 按扩展名 getFormatForExtension         ▼ 按格式名 getExportHandler
  ┌──────────┐                            ┌──────────┐
  │ 命中插件？│                            │ 命中插件？│ ← 匹配 exportFormats 的键
  └────┬─────┘                            └────┬─────┘
    是 │      │ 否                          是 │      │ 否
       ▼      ▼                                ▼      ▼
   plugin   mapshaper                     handler   mapshaper
   importBinary 核心导入                  (dataset,  核心导出
       │      │                          options)     │
       └──┬───┘                            └───┬─────┘
          ▼                                    ▼
   MapshaperDataset                ExportedFormatFile[]
                                            │ MIME 取 mimeTypes[format]
                                            ▼
                                          Blob
```

### 注册与生命周期

- `register(plugin)` 要求全局唯一的插件名、扩展名和 `exportFormats` 键。
- 注册表冻结插件，并以 `AbortController` 管理调用；注销或销毁时等待调用以 AbortError 结束。
- `provider.formats` 随地图销毁释放注册表；`/arrow` 和 `/geopackage` 的 feature plugin 自动注销格式。
- 插件格式单文件导入；核心格式支持多文件混传。

### 格式插件契约

插件格式实现 `DatasetFormatPlugin`：

```ts
interface DatasetFormatPlugin {
  name: string; // 注册唯一键，用于注销与冲突检测
  extensions: readonly string[]; // 导入按扩展名匹配（不含点）
  importBinary(content: Uint8Array, filename: string): Promise<MapshaperDataset>;
  exportFormats: {
    // export({ format }) 按这里的键匹配
    [format: string]: (dataset, options?) => Promise<ExportedFormatFile[]>;
  };
  mimeTypes?: { [format: string]: string }; // 各导出格式对应的 Blob MIME
}
```

注册方式：

```ts
// 方式一：Cordis 插件，随插件生命周期自动注销（内置可选入口的做法）
import { arrowFormatsPlugin } from '@mapseekai/emap/arrow';
await map.ctx.plugin(arrowFormatsPlugin);

// 方式二：应用本地 codec 手动注册，返回注销函数
import { registerFormat } from '@mapseekai/emap';
const unregister = registerFormat(map.formats, myCodec);
```

独立 source 在构造时传入地图注册表：

```ts
const source = new TopologySource('upload', { formats: map.formats });
```

## 开发格式插件

新格式：安装解析库 → 实现 `DatasetFormatPlugin` → 注册到 `map.formats`。CSV 示例：

```ts
import type { DatasetFormatPlugin } from '@mapseekai/emap';

// 完整可运行的示例：name,lon,lat 三列 CSV，第一行表头
const geoCsvCodec: DatasetFormatPlugin = {
  name: 'geocsv',
  extensions: ['geocsv'],
  async importBinary(content, filename) {
    const lines = new TextDecoder().decode(content).trim().split('\n');
    const shapes: [number, number][][] = [];
    const records: Record<string, unknown>[] = [];
    for (const line of lines.slice(1)) {
      const [name, lon, lat] = line.split(',');
      shapes.push([[Number(lon), Number(lat)]]); // 点要素：坐标对数组
      records.push({ name, lon: Number(lon), lat: Number(lat) });
    }
    return {
      layers: [
        {
          name: filename.replace(/\.geocsv$/, ''),
          geometry_type: 'point',
          shapes,
          data: {
            // 属性表：mapshaper DataTable（layer.data）
            getRecords: () => records,
            getRecordAt: (i) => records[i],
            getFields: () => ['name', 'lon', 'lat'],
            size: () => records.length,
          },
        },
      ],
      info: { crs_string: 'EPSG:4326' },
    };
  },
  exportFormats: {
    geocsv: async (dataset) => {
      const layer = dataset.layers[0];
      const rows = (layer.data?.getRecords() ?? []).map((r) => `${r.name},${r.lon},${r.lat}`);
      return [
        {
          filename: `${layer.name ?? 'layer'}.geocsv`,
          content: ['name,lon,lat', ...rows].join('\n'),
        },
      ];
    },
  },
  mimeTypes: { geocsv: 'text/csv' },
};
```

约束：

- codec 是纯二进制 I/O，可在主线程或 Worker 运行。
- `importBinary` 返回可编辑 dataset：`layers`、`shapes`、`data` 和 `info.crs_string`。
- 导出处理器返回 `ExportedFormatFile[]`；仅 `shapefile` 支持多文件 ZIP。
- 注销或地图销毁时，等待调用以 AbortError 结束；codec 可自行检查外部 AbortSignal。

注册后与其他格式一样使用：

```ts
import { registerFormat, TopologySource } from '@mapseekai/emap';

const unregister = registerFormat(map.formats, geoCsvCodec);

const source = await TopologySource.fromBytes('upload', bytes, {
  filename: 'cities.geocsv',
  formats: map.formats,
});
await map.addSource('upload', source);

const blob = await source.export({ format: 'geocsv' });

// 不再需要时注销；地图 dispose 时会自动注销全部格式
unregister();
```

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
