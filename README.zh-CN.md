# emap

<p align="center">
  <img src="packages/examples/public/emap.svg" alt="Emap 标志" width="144" />
</p>

[English](README.md)

`@mapseekai/emap` 是运行在浏览器中的 TypeScript 矢量地图渲染、查询、分析与拓扑编辑引擎。数据以 mapshaper 拓扑结构保存，业务图层可选择 Canvas2D、WebGL2 或 WebGPU 渲染（默认 WebGL2），数据处理和地图交互均可在浏览器本地完成。

## emap 支持什么

- **数据格式**：内置 GeoJSON、TopoJSON、Shapefile ZIP、KML 和 MSX 快照；通过可选的 `@mapseekai/emap/arrow` 入口支持 GeoArrow 与 GeoParquet。
- **图层**：`fill`、`line`、`circle` 三种图层，支持三种渲染后端，支持视域裁剪、随简化级别切换的显示弧段和属性驱动的分桶填色。
- **样式与符号**：属性表达式、分级设色、虚线与箭头线、点标记、标注和图片符号。
- **本地栅格**：通过 `/geotiff` 使用 Worker 按窗口读取 GeoTIFF/BigTIFF，支持金字塔、波段选择和渐进显示。
- **GeoPackage**：通过 `/geopackage` 导入多图层矢量数据，保留共享拓扑，支持主线程和 Worker 执行。
- **编辑**：选择、绘制、平移、旋转、缩放、拆分、合并、整形、多边形自动闭合，以及顶点、环、洞和多部件编辑。
- **历史**：编辑命令和数据集操作支持撤销、重做、事务、校验和选择状态恢复。
- **数据集操作**：`map.ops` 提供裁剪、擦除、融合、缓冲区、过滤、简化、分级、关联、投影、修复和环/部件操作（完整清单见 API 参考中的 `MapshaperOps`）。
- **执行**：数据集操作可卸载到 Web Worker，并在提交前校验结果是否过期。
- **分析**：通过类型化的 `@mapseekai/emap/duckdb` 入口运行可选的 DuckDB-Wasm SQL 与空间分析。
- **底图**：可选 MapLibre 服务管理栅格/矢量底图和在线叠加图层；可编辑业务图层始终由 emap 管理。

## 可以构建哪些应用

| 业务场景 | 可以组合的能力 |
| --- | --- |
| 本地数据查看器 | 文件导入、多数据源与图层、自动适配范围、属性查看和格式导出 |
| 交互地图编辑器 | 选择、吸附、绘制、顶点编辑、校验、撤销重做和事务 |
| 专题地图 | 属性分级、表达式样式、标注、符号和可见性过滤 |
| 浏览器 GIS 分析 | 类型化数据操作、投影转换、关联和 DuckDB 空间工具箱 |
| 矢量栅格工作区 | 可编辑矢量图层、GeoTIFF 窗口与波段、MapLibre 底图 |
| 可扩展业务应用 | Cordis 服务与插件、可配置预设、控件、事件和类型化 AI 能力注册 |

创建地图时选择渲染器，三种渲染器共用数据源、样式、选择、编辑与历史服务。
[渲染器指南](docs/renderer-backends.md)介绍部署资源和浏览器适配器要求；
[示例目录](packages/examples/examples)提供可运行的使用流程。

## 本地栅格文件

可选的 [`/geotiff` 集成](https://mapseekai.github.io/mapseekai/emap/data/geotiff) 通过 Worker 从文件引用按窗口读取本地 GeoTIFF/BigTIFF。超过 2GiB 的文件使用有效的内部或外部金字塔完成按需解码。组合 `rasterPlugin()` 与 `geoTIFFPlugin()`，部署 `emap-geotiff-worker.js`；工程保存外部引用，文件句柄由宿主负责。高位深自动拉伸到 8 位显示，同时保留原始数值；导航期间保留已有画面，停止后逐块更新，未就绪区域继续使用裁剪后的旧分辨率缓存。示例目录新增 `geotiff-viewer`，包含整数和浮点测试影像，以及 RGB / 单波段灰度和波段选择。支持 north-up 网格；输入编码、金字塔配置、资源预算和已测数据规模见指南。

## 安装

```bash
pnpm add @mapseekai/emap
```

安装包将 `maplibre-gl` 声明为公开类型使用的必需 peer；npm 和 pnpm 通常会自动安装。注册 `mapLibrePlugin` 后即可启用在线底图。

导入核心模块与样式表：

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import '@mapseekai/emap/style.css';
```

emap 面向现代浏览器，TypeScript 使用打包器解析方式：

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler"
  }
}
```

## 快速开始

地图容器必须具有明确尺寸：

```html
<div id="map" style="width: 100%; height: 480px"></div>
```

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import '@mapseekai/emap/style.css';

const map = await Emap.create({
  container: 'map',
  renderer: 'webgl2', // 默认；也可选择 'canvas2d' 或 'webgpu'
  expressionPolicy: 'disabled',
});

const source = await TopologySource.fromUrl('districts', '/data/districts.geojson');
await map.addSource('districts', source);

map.addLayer({
  id: 'district-fill',
  type: 'fill',
  source: 'districts',
  paint: {
    'fill-color': '#60a5fa',
    'fill-opacity': 0.45,
  },
});

map.addLayer({
  id: 'district-outline',
  type: 'line',
  source: 'districts',
  paint: {
    'line-color': '#1e3a8a',
    'line-width': 1.5,
  },
});

map.setExtent(source.getExtent());
```

宿主页面销毁时释放地图实例：

```ts
await map.dispose();
```

## 加载本地数据

浏览器中选择的文件通过 `TopologySource.fromBytes()` 加载：

```ts
const file = input.files?.[0];
if (!file) throw new Error('请先选择文件');

const source = await TopologySource.fromBytes('upload', await file.arrayBuffer(), {
  filename: file.name,
  zipLimits: {
    maxCompressedBytes: 100 * 1024 * 1024,
    maxBytes: 500 * 1024 * 1024,
    maxEntries: 2_000,
    maxRatio: 100,
  },
});
```

ZIP 导入默认允许最大 2 GiB 压缩输入和 2 GiB 解压后总内容；面向公网上传时通过 `zipLimits` 收紧。压缩包内出现重复 basename 时会明确报错。

## 编辑与历史

交互 Handler 管理手势状态，EditCommand 负责可逆的数据修改：

```ts
map.vertexEdit.enable();

if (map.canUndo()) map.undo();
if (map.canRedo()) map.redo();
```

需要整体提交或回滚的操作使用事务：

```ts
import type { Emap } from '@mapseekai/emap';

export async function cleanAndSimplify(map: Emap, source: string, target: string) {
  const transaction = map.beginTransaction();
  try {
    const cleaned = await map.ops.cleanLayer({ source, target });
    if (!cleaned.ok) {
      transaction.rollback();
      return cleaned;
    }
    const simplified = await map.ops.simplifyLayer({ source, target, percentage: 20 });
    if (!simplified.ok) {
      transaction.rollback();
      return simplified;
    }
    return await transaction.commit('Clean and simplify');
  } catch (error) {
    if (transaction.isOpen) transaction.rollback();
    throw error;
  }
}
```

操作返回 `OpResult`，通过 `ok` 判断执行结果，并用 `try/catch` 处理抛出的异常。`source` 是已注册的数据源 ID，`target` 是数据源内的数据图层名称或 ID。

完成事务提交或回滚后，可继续撤销／重做、清空历史或替换外部输入。外部替换数据集会为该数据源建立新的历史、选择和高亮状态；命令的撤销／重做恢复对应编辑状态。

默认 `expressionPolicy: 'disabled'` 由应用控制 JavaScript 表达式执行。配置和数据完全由应用掌控、表达式经过审阅时，可设置 `expressionPolicy: 'trusted'`。

## 属性驱动填色

先计算并烘焙分级结果，再让填色图层读取该字段：

```ts
await map.ops.classifyFeatures({
  source: 'districts',
  target: 'districts',
  field: 'population',
  method: 'quantile',
  classes: 4,
  colors: ['#eff3ff', '#bdd7e7', '#6baed6', '#2171b5'],
});

map.addLayer({
  id: 'population-fill',
  type: 'fill',
  source: 'districts',
  styleSource: 'mapshaper',
});
```

`fill-color` 支持样式指南列出的表达式运算符。专用表达式求值器负责校验，并按数据集属性版本缓存结果。

## Worker 卸载

将 Worker 和 vendor 文件部署到页面可访问路径，然后启用 Worker 路由：

```ts
const map = await Emap.create({
  container: 'map',
  useWorker: 'auto',
  workerUrl: '/assets/emap-worker.js',
});
```

发布包中的资源：

```text
@mapseekai/emap/dist/emap-worker.js
@mapseekai/emap/dist/mapshaper-vendor.js
@mapseekai/emap/dist/mapshaper-vendor.mjs
```

主线程在提交 Worker 结果前校验 Source 身份、几何版本和属性版本，确保应用的结果与当前编辑状态一致。

## 可选 Arrow 与 GeoParquet

安装 Arrow 子路径使用的 peer；仅 GeoParquet 导入或导出需要 `parquet-wasm`：

```bash
pnpm add apache-arrow
pnpm add parquet-wasm # 仅 GeoParquet
```

将 Arrow 格式插件显式安装到对应工作区：

```ts
import { arrowFormatsPlugin } from '@mapseekai/emap/arrow';
await map.ctx.plugin(arrowFormatsPlugin);
// For optional-format input loaded before addSource:
const optionalSource = new TopologySource('upload', { formats: map.formats });
import { fromArrowTable, toArrowTable } from '@mapseekai/emap/arrow';
```

挂载 `arrowFormatsPlugin` 后，在工作区注册相应格式；`parquet-wasm` 在首次使用 GeoParquet 时按需加载。

## GeoPackage 矢量直接导入

可选 `/geopackage` 入口通过 NGA SQLite WASM → GP Binary/WKB → TypedArray 直接转换矢量要素表。一个 GeoPackage 的全部矢量表保留在一个 dataset，使用共享 ArcCollection；支持主线程或 Web Worker 两种执行方式。

```ts
import { geoPackagePlugin } from '@mapseekai/emap/geopackage';
await map.ctx.plugin(
  geoPackagePlugin({
    workerUrl: '/assets/emap-geopackage-worker.js',
    wasmUrl: '/assets/sql-wasm.wasm',
  }),
);
const source = new TopologySource('gpkg', { formats: map.formats });
await source.setData({ filename: file.name, content: new Uint8Array(await file.arrayBuffer()) });
await map.addSource('gpkg', source);
```

[部署资源、CRS、多图层、Z/M 与内存预算](https://mapseekai.github.io/mapseekai/emap/data/geopackage)。

## 可选 DuckDB-Wasm

导入 DuckDB 子路径前安装运行时 peer：

```bash
pnpm add @duckdb/duckdb-wasm apache-arrow
```

```ts
import { createDuckDbRuntimeFromJsDelivr, attributeFilter } from '@mapseekai/emap/duckdb';

const runtime = await createDuckDbRuntimeFromJsDelivr();

const result = await attributeFilter(
  source.getDataset()!,
  {
    sql: 'SELECT geometry, name FROM input WHERE active = true',
  },
  runtime,
);
```

属性筛选接口支持使用文档所列数据表、字段和函数的单条 `SELECT`，并在执行前校验查询。DuckDB 处理工具箱提供 Overlay、Proximity、Aggregate、Join、Geometry、Transform、Selection 和 Data Management 八类操作。距离类操作使用投影坐标系，结果采用该投影的线性单位；CRS 校验会检查这一前提。

## 可选 MapLibre 服务

需要在线底图或叠加服务时，先安装 `mapLibrePlugin`，再通过 `EmapOptions.mapLibre` 或 `map.mapLibreServices` 注册：

```ts
import { mapLibrePlugin } from '@mapseekai/emap/maplibre';

const map = await Emap.create({
  container: 'map',
  plugins: [mapLibrePlugin],
  mapLibre: {
    services: [
      {
        id: 'basemap',
        name: '底图',
        role: 'basemap',
        style: '/styles/basemap.json',
      },
    ],
    defaultBasemap: 'basemap',
  },
});
```

该集成负责 MapLibre source/layer 注册、请求版本取消、失败回滚和视图同步。

## 文档

- [安装](https://mapseekai.github.io/mapseekai/emap/getting-started/installation)
- [快速开始](https://mapseekai.github.io/mapseekai/emap/getting-started/quick-start)
- [Emap 核心概念](https://mapseekai.github.io/mapseekai/emap/concepts/emap)
- [技术架构与源码组织](https://mapseekai.github.io/mapseekai/emap/concepts/architecture)
- [编辑指南](https://mapseekai.github.io/mapseekai/emap/guides/editing)
- [样式指南](https://mapseekai.github.io/mapseekai/emap/guides/styling)
- [Worker 指南](https://mapseekai.github.io/mapseekai/emap/guides/worker)
- [DuckDB 指南](https://mapseekai.github.io/mapseekai/emap/data/duckdb)
- [兼容性](https://mapseekai.github.io/mapseekai/emap/reference/compatibility)
- [可运行示例](packages/examples/examples)
- [llms.txt](https://mapseekai.github.io/mapseekai/emap/llms.txt) — 面向 AI 编程助手的文档站点索引

## 架构

公共 `Emap` 类保持统一门面。仓库内部现在只保留六个一级职责区，让运行时组合、引擎热路径、GIS 领域状态、第三方集成、UI 和共享声明在目录上直接区分：

```text
src/
├── domain/          # GIS Source / Geometry / Edit / Validation 领域
├── engine/          # 地图执行、交互、渲染、Worker、内置 Provider
├── runtime/         # 原生 Cordis Context / Service / Plugin / Preset / AI Capability
├── integrations/    # Mapshaper / MapLibre / Arrow / DuckDB / GeoPackage
├── ui/              # 控件、图标、CSS、主题
├── shared/          # Ambient 声明与跨层类型边界
└── index.ts         # 显式根公共 API
```

运行时直接使用官方 `cordis@4.0.0-rc.10`。`map.ctx` 就是原生 `Context`；服务通过 Context declaration merging 与 `ctx.provide()` 定义，Feature/Provider 使用原生 `inject / apply / effect`，生命周期使用原生 `Fiber`。插件依赖、服务可用性、副作用与释放均由 Cordis 管理。

主要执行路径仍然是直接的 GIS 热路径：

```text
DOM 指针输入
  → engine/core Handler
  → 已校验编辑计划或 engine/map Operation
  → domain EditCommand / operation runner
  → Source 版本、历史、事务、选择状态
  → 渲染失效
  → RenderScheduler
  → layer renderer / CanvasPainter or LumaPainter
```

职责分工：

- `src/domain/source/`：拓扑数据、CRS、格式绑定 Source 状态和 DisplayArcs 生命周期。
- `src/domain/edit/commands/`：可逆数据修改；`src/domain/geo/`：坐标、投影和测量数学。
- `src/engine/map/ops/`：Mapshaper 支持的数据操作编排；`src/engine/core/handlers/`：浏览器交互；`src/engine/rendering/`：渲染调度和 Painter 契约。
- `src/runtime/`：只负责 Cordis 组合，包括 Service 契约、Provider、Feature Plugin、Preset 和 AI Capability 注册。
- `src/integrations/mapshaper/adapter.ts`：访问 `mapshaper.internal.*` 的正常边界；MapLibre、Arrow、DuckDB 都有独立 integration 边界。
- `/context`、`/services`、`/providers`、`/plugins`、`/presets`、`/ai`、`/maplibre`、`/arrow`、`/duckdb`、`/geopackage` 按能力组织为稳定的 package subpath。

单元测试严格使用 `foo.ts` + `foo.test.ts` 同目录同名，一个实现文件最多一个单元测试文件。跨模块回归/集成测试进入 `test/integration/`；浏览器、构建、类型契约、文档、示例、安全测试分别进入 `test/` 对应目录。`test-layout:check` 和 `typecheck:contracts` 自动约束这套规则。

完整说明见 [当前技术架构与源码组织](https://mapseekai.github.io/mapseekai/emap/concepts/architecture)。

## 开发

环境要求：

```text
Node.js 22.18–24
pnpm 11.15.1
```

安装依赖后，从以下命令目录中选择与本次改动相关的检查。
见 [验证规则](AGENTS.md#verification)。发布准备仍需通过 [发布清单](docs/release-checklist.md) 中的完整验证。

```bash
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run typecheck
pnpm run typecheck:contracts
pnpm run typecheck:examples
pnpm run test-layout:check
pnpm run architecture:check
pnpm run capabilities:check
pnpm run test:run
pnpm run test:duckdb
pnpm run build
pnpm run bundle:smoke
pnpm run examples:verify
pnpm run audit:prod
pnpm pack --dry-run
```

本地启动或构建示例站：

```bash
pnpm run examples:dev
pnpm run examples:build
```

TypeDoc 的生成结果位于 `dist/api/`，由 `api:build` 重新生成，不提交到仓库。文档正文、翻译、主题与网站发布在独立的 `emap-web` 项目中维护。

DuckDB 集成套件通过 `pnpm run test:duckdb` 运行，该命令对 `src/integrations/duckdb` 与 `test/integration/duckdb` 全目录设置 `DUCKDB_WASM_INTEGRATION=1`。

修改 mapshaper 支持的操作时，遵循 [代码约定](AGENTS.md#hard-rules--code-conventions)，并验证受影响的历史、选择、Worker 和过期操作行为。

## 安全

按 [SECURITY.md](SECURITY.md) 报告漏洞。外部配置使用 `expressionPolicy: 'disabled'`；公网上传使用与应用资源匹配的数据源大小预算。

## 许可证

[MPL-2.0](LICENSE)
