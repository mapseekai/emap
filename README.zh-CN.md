# emap

<p align="center">
  <img src="packages/examples/public/emap.svg" alt="Emap 标志" width="144" />
</p>

[English](README.md)

`@mapseekai/emap` 是运行在浏览器中的 TypeScript 矢量地图渲染、查询、分析与拓扑编辑引擎。数据以 mapshaper 拓扑结构保存，业务图层使用 Canvas2D 渲染，不依赖任何后端地图服务。

## emap 支持什么

- **数据格式**：内置 GeoJSON、TopoJSON、Shapefile ZIP、KML 和 MSX 快照；通过可选的 `@mapseekai/emap/arrow` 入口支持 GeoArrow 与 GeoParquet。
- **图层**：`fill`、`line`、`circle` 三种图层，Canvas2D 渲染，支持视域裁剪、随简化级别切换的显示弧段和属性驱动的分桶填色。
- **编辑**：选择、绘制、平移、旋转、缩放、拆分、合并、整形、多边形自动闭合，以及顶点、环、洞和多部件编辑。
- **历史**：所有修改都是可撤销命令，支持撤销、重做、事务、校验和选择状态恢复。
- **数据集操作**：`map.ops` 提供裁剪、擦除、融合、缓冲区、过滤、简化、分级、关联、投影、修复和环/部件操作（完整清单见 API 参考中的 `MapshaperOps`）。
- **执行**：数据集操作可卸载到 Web Worker，并在提交前校验结果是否过期。
- **分析**：通过受限且类型化的 `@mapseekai/emap/duckdb` 入口运行可选的 DuckDB-Wasm SQL 与空间分析。
- **底图**：可选 MapLibre 服务管理栅格/矢量底图和在线叠加图层；可编辑 Canvas 图层始终由 emap 管理。

## 安装

```bash
pnpm add @mapseekai/emap
```

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

const map = new Emap({
  container: 'map',
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
map.remove();
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

操作返回 `OpResult`，需要检查 `ok`，不能仅依赖 `try/catch`。`source` 是已注册的数据源 ID，`target` 是数据源内的数据图层名称或 ID。

事务开启期间，撤销／重做、清空历史和替换外部输入都会被拒绝。外部替换数据集会清理该数据源的历史、选择和高亮；命令的撤销／重做不会。

传递给 mapshaper 的字符串表达式默认关闭。仅当配置和数据完全由应用控制时，才设置 `expressionPolicy: 'trusted'`。

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

`fill-color` 支持样式指南中定义的受限表达式子集。表达式不使用 `eval` 校验，并按数据集属性版本缓存。

## Worker 卸载

将 Worker 和 vendor 文件部署到页面可访问路径，然后启用 Worker 路由：

```ts
const map = new Emap({
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

主线程在提交 Worker 结果前校验 Source 身份、几何版本和属性版本，过期结果不会覆盖新编辑。

## 可选 Arrow 与 GeoParquet

安装 Arrow 子路径使用的 peer；仅 GeoParquet 导入或导出需要 `parquet-wasm`：

```bash
pnpm add apache-arrow
pnpm add parquet-wasm # 仅 GeoParquet
```

将 Arrow 格式插件显式安装到对应工作区：

```ts
import { arrowFormatsPlugin } from '@mapseekai/emap/arrow';
map.use(arrowFormatsPlugin);
// For optional-format input loaded before addSource:
const optionalSource = new TopologySource('upload', { formats: map.formats });
import { fromArrowTable, toArrowTable } from '@mapseekai/emap/arrow';
```

`parquet-wasm` 在首次使用 GeoParquet 时才加载；不导入该入口的应用不会执行格式模块。

## 可选 DuckDB-Wasm

导入 DuckDB 子路径前安装运行时 peer：

```bash
pnpm add @duckdb/duckdb-wasm apache-arrow
```

```ts
import {
  createDuckDbRuntimeFromJsDelivr,
  attributeFilter,
} from '@mapseekai/emap/duckdb';

const runtime = await createDuckDbRuntimeFromJsDelivr();

const result = await attributeFilter(source.getDataset()!, {
  sql: 'SELECT geometry, name FROM input WHERE active = true',
}, runtime);
```

属性筛选接口只接受受限的单条 `SELECT`。DuckDB 处理工具箱提供 Overlay、Proximity、Aggregate、Join、Geometry、Transform、Selection 和 Data Management 八类操作。距离类操作默认拒绝地理坐标系，结果不会以角度为单位。

## 可选 MapLibre 服务

需要在线底图或叠加服务时，先安装 `mapLibrePlugin`，再通过 `EmapOptions.mapLibre` 或 `map.mapLibreServices` 注册：

```ts
import { mapLibrePlugin } from '@mapseekai/emap/maplibre';

const map = new Emap({
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

- [安装与第一张地图](packages/docs/docs/getting-started/installation.md)
- [Emap 核心概念](packages/docs/docs/concepts/emap.md)
- [编辑指南](packages/docs/docs/guides/editing.md)
- [样式指南](packages/docs/docs/guides/styling.md)
- [Worker 指南](packages/docs/docs/guides/worker.md)
- [DuckDB 指南](packages/docs/docs/data/duckdb.md)
- [兼容性](packages/docs/docs/reference/compatibility.md)
- [可运行示例](packages/examples/examples)
- [架构决策记录](docs/decisions/README.md)

## 架构

公共 `Emap` 类是统一门面，内部按状态所有权和失败语义划分：

```text
DOM 指针输入
  → HandlerManager 与编辑 Handler
  → 已校验编辑计划或数据集操作
  → EditCommand / operation runner
  → Source 版本、历史、事务、选择状态
  → source data 事件
  → RenderScheduler
  → layer renderer 与 CanvasPainter
```

主要边界：

- `src/source/`：导入导出、ZIP 限制、CRS 元数据和 DisplayArcs 生命周期。
- `src/adapter/mapshaper-adapter.ts`：业务代码访问 `mapshaper.internal.*` 的统一边界。
- `src/map/ops/`：可独立测试的数据集与选择操作。
- `src/edit/commands/`：可逆的实时数据修改。
- `src/renderer/`：Canvas 绘制与编辑叠加层。
- `src/core/handlers/`：浏览器交互状态。
- `src/arrow/` 与 `src/duckdb/`：可选数据与分析入口。
- `src/map/maplibre-service-manager.ts`：在线服务资源与异步回滚。

几何编辑和属性编辑使用各自独立的单调版本计数器。Worker 与异步操作在提交前同时比较两者。

## 开发

环境要求：

```text
Node.js 22.18–24
pnpm 11.15.1
```

安装并运行主要检查：

```bash
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run typecheck
pnpm run test:run
pnpm run test:duckdb
pnpm run build
pnpm run bundle:smoke
pnpm run docs:verify
pnpm run audit:prod
pnpm pack --dry-run
```

本地启动示例或文档站：

```bash
pnpm run examples:dev
pnpm run docs:dev
```

`packages/docs/static/api/` 下由 TypeDoc 生成的文件被有意忽略，`api:build`、`docs:build` 和 `docs:verify` 会重新生成。

DuckDB 集成套件通过 `pnpm run test:duckdb` 运行，该命令对 `src/duckdb` 全目录设置 `DUCKDB_WASM_INTEGRATION=1`。

修改 mapshaper 支持的操作前，先更新它在 `src/map/ops/_runner.ts` 中的效果分类，并验证历史、选择、Worker 和过期操作行为。仓库规则见 [AGENTS.md](AGENTS.md)。

## 安全

按 [SECURITY.md](SECURITY.md) 报告漏洞。对不可信配置保持 mapshaper 表达式关闭；接受公网上传时使用保守的数据源大小限制。

## 许可证

[MPL-2.0](LICENSE)
