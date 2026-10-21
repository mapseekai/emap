---
id: installation
slug: /getting-started/installation
title: 安装
api: ["Emap", "TopologySource"]
examples: ["getting-started/vector-file"]
stability: stable
verifiedVersion: 0.14.0
---

# 安装

安装 `@mapseekai/emap`，并在应用入口导入库和样式表；浏览器需要 ES module、Canvas 2D 和非零地图容器。

```bash
pnpm add @mapseekai/emap # 安装核心包；npm 项目使用 npm install @mapseekai/emap
```

```ts
import { Emap, TopologySource } from '@mapseekai/emap'; // 导入地图 API
import '@mapseekai/emap/style.css'; // 导入内置控件和编辑样式
```

## 更多环境与模块配置

最低浏览器版本：Chrome 或 Edge 109、Firefox 115、Safari 16.4。开发和发布使用 Node.js `>=22.18 <25`；浏览器应用需要 ES2022、ES module、Canvas 2D 和非零地图容器。

功能入口为 `package.json` exports 子路径：`/arrow`、`/duckdb`、`/geopackage`、`/maplibre`、`/context`、`/services`、`/providers`、`/plugins`、`/presets`、`/ai` 和 `/style.css`。浏览器打包项目使用 `module: "ESNext"` 与 `moduleResolution: "bundler"`：

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

emap 的公开类型声明使用省略扩展名的相对导入，已验证的配置为
`module: "ESNext"` 和 `moduleResolution: "bundler"`。浏览器应用使用此配置；
Node.js 用于开发、构建和测试工具。

创建地图时可选择 `renderer: 'canvas2d'`、`'webgl2'` 或 `'webgpu'`。
默认使用 WebGL2；WebGPU 需要安全上下文与可用 GPU 适配器。
宿主可根据设备能力选择 Canvas2D。

## 更多可选功能与 peer 依赖

核心公开类型引用 MapLibre 的完整类型，因此 `maplibre-gl@^6.4.1` 是必需 peer，
npm／pnpm 默认会自动安装。使用底图时仍须显式注册 MapLibre 插件。
Arrow、Parquet 和 DuckDB 的 peer 依赖按需安装；下表的子入口共享核心依赖。

| 入口 | 必需 peer 依赖 | 启用能力 |
| --- | --- | --- |
| `@mapseekai/emap` | `maplibre-gl` `^6.4.1` | 地图、source、图层和编辑；MapLibre 公开类型。 |
| `@mapseekai/emap/arrow`（Arrow / GeoArrow） | `apache-arrow` `^17.0.0` | Arrow table 互操作与 GeoArrow 读写。 |
| `@mapseekai/emap/arrow`（GeoParquet） | `apache-arrow` `^17.0.0`、`parquet-wasm` `^0.7.1` | GeoParquet 读写。 |
| `@mapseekai/emap/duckdb` | `@duckdb/duckdb-wasm` `1.33.1-dev64.0`、`apache-arrow` `^17.0.0` | DuckDB-Wasm 查询和空间处理。 |
| `@mapseekai/emap/geopackage` | 无 | GeoPackage 矢量表导入。 |
| `@mapseekai/emap/maplibre` | `maplibre-gl` `^6.4.1` | MapLibre 底图与在线叠加层。 |

### GeoArrow 和 GeoParquet

`@mapseekai/emap/arrow` 提供 GeoArrow、GeoParquet 和 Arrow table 互操作；GeoParquet 还需 `parquet-wasm@^0.7.1`：

```bash
pnpm add apache-arrow@^17.0.0 parquet-wasm@^0.7.1
```

在首次 GeoArrow 或 GeoParquet 读写前导入：

```ts
import { arrowFormatsPlugin } from '@mapseekai/emap/arrow';
await map.ctx.plugin(arrowFormatsPlugin);
// 在 addSource 前加载可选格式输入：
const optionalSource = new TopologySource('upload', { formats: map.formats });
```

### DuckDB 查询和空间处理

`@mapseekai/emap/duckdb` 提供 DuckDB-Wasm 查询、GeoParquet 查询和空间处理：

```bash
pnpm add @duckdb/duckdb-wasm@1.33.1-dev64.0 apache-arrow@^17.0.0
```

```ts
import { createDuckDbRuntimeFromJsDelivr } from '@mapseekai/emap/duckdb';
```

处理 GeoParquet 时，安装 `parquet-wasm@^0.7.1` 并导入 `@mapseekai/emap/arrow` 注册格式。

### GeoPackage 导入

`@mapseekai/emap/geopackage` 将 GeoPackage 矢量表解码为 typed-buffer dataset。Worker 导入需发布 `dist/emap-geopackage-worker.js` 和 `dist/sql-wasm.wasm`；详见 [GeoPackage](../data/geopackage.md)。

### MapLibre 在线底图与叠加层

`@mapseekai/emap/maplibre` 提供 MapLibre 底图和在线叠加层：

```bash
pnpm add maplibre-gl@^6.4.1
```

```ts
import { mapLibrePlugin } from '@mapseekai/emap/maplibre';
```

服务配置见 [插件与 Preset](../guides/plugins.md)。

### Worker 执行

Web Worker 使用核心包；应用须发布 `emap-worker.js` 和 `mapshaper-vendor.js`。详见 [Web Worker](../guides/worker.md)。

## 下一步

- [核心概念](../concepts/overview.md)
- [数据格式](../data/formats.md)

## 可运行示例

- [打开矢量文件](/mapseekai/emap/examples/getting-started/vector-file/)
