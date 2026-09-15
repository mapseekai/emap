---
id: installation
slug: /getting-started/installation
title: 安装
api: ["Emap", "TopologySource"]
examples: ["getting-started/geojson-viewer"]
stability: stable
verifiedVersion: 0.12.0
---

# 安装

安装 `@mapseekai/emap` 后，在应用入口导入库和样式表。Emap 运行在支持 ES module、Canvas 2D 和现代 JavaScript 的浏览器中。

## 安装核心包

使用项目的包管理器安装核心包：

```bash
pnpm add @mapseekai/emap
```

或：

```bash
npm install @mapseekai/emap
```

在应用入口导入所需的 API 和样式表：

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import '@mapseekai/emap/style.css';
```

样式表包含内置控件和编辑界面的样式。应用的地图容器需要非零宽度和高度。

## TypeScript 模块解析

除根入口外，功能入口都是 `package.json` exports 子路径：`/arrow`、`/duckdb`、`/geopackage`、`/maplibre`、`/context`、`/services`、`/providers`、`/plugins`、`/presets`、`/ai`，以及样式表 `/style.css`。Vite 和其他浏览器打包器使用 `bundler` 解析：

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

原生 Node ESM 项目为 `module` 和 `moduleResolution` 使用匹配的 `Node16` 或 `NodeNext` 设置：

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  }
}
```

## 可选功能与 peer 依赖

核心包不需要以下依赖。仅在使用对应入口时安装它们。

### GeoArrow 和 GeoParquet

`@mapseekai/emap/arrow` 提供 GeoArrow 和 GeoParquet 的导入、导出及 Arrow table 互操作。安装 `apache-arrow` 后可使用 GeoArrow 和 Arrow table；GeoParquet 还需要 `parquet-wasm`：

```bash
pnpm add apache-arrow parquet-wasm
```

然后在首次读取或写入 GeoArrow、GeoParquet 前导入该入口：

```ts
import { arrowFormatsPlugin } from '@mapseekai/emap/arrow';
await map.ctx.plugin(arrowFormatsPlugin);
// For optional-format input loaded before addSource:
const optionalSource = new TopologySource('upload', { formats: map.formats });
```

### DuckDB 查询和空间处理

`@mapseekai/emap/duckdb` 提供 DuckDB-Wasm 的查询和空间处理 API。安装 `@duckdb/duckdb-wasm` 后导入该入口：

```bash
pnpm add @duckdb/duckdb-wasm
```

```ts
import { createDuckDbRuntimeFromJsDelivr } from '@mapseekai/emap/duckdb';
```

使用 `@mapseekai/emap/duckdb` 处理 GeoParquet 时，同时安装 `apache-arrow` 和 `parquet-wasm`，并导入 `@mapseekai/emap/arrow`。

### GeoPackage 导入

`@mapseekai/emap/geopackage` 把 GeoPackage 矢量表直接解码为 typed-buffer dataset，不需要安装额外依赖（`@ngageoint/geopackage` 是包的捆绑依赖）。Worker 导入需要应用发布包内的 `dist/emap-geopackage-worker.js` 和 `dist/sql-wasm.wasm` 两个文件；资产、CRS 和内存约定见 [GeoPackage](../data/geopackage.md)。

### MapLibre 在线底图与叠加层

`@mapseekai/emap/maplibre` 提供 MapLibre 底图和在线叠加层服务，需要安装 `maplibre-gl`：

```bash
pnpm add maplibre-gl
```

```ts
import { mapLibrePlugin } from '@mapseekai/emap/maplibre';
```

服务配置见 [插件与 Preset](../guides/plugins.md)。

### Worker 执行

把 dataset 操作路由到 Web Worker 不需要额外依赖，但应用必须发布 `emap-worker.js` 和 `mapshaper-vendor.js` 两个文件，见 [Web Worker](../guides/worker.md)。

## 下一步

- 阅读[核心概念](../concepts/overview.md)，创建地图、添加数据源和图层。
- 阅读[数据格式](../data/formats.md)，加载和导出支持的格式。
- 打开[GeoJSON 查看器](/mapseekai/emap/examples/getting-started/geojson-viewer/)，查看完整示例。
