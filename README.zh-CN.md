# emap

<p align="center">
  <img src="packages/examples/public/emap.svg" alt="Emap 标志" width="144" />
</p>

[English](README.md)

`@mapseekai/emap` 是面向浏览器的 TypeScript 矢量地图渲染、查询、分析与拓扑编辑引擎。它以 mapshaper 数据结构为基础，使用 Canvas2D 绘制可编辑业务图层，并可按需同步 MapLibre 底图和在线叠加服务。

> 项目尚未达到 1.0，接口仍在快速演进。用于生产关键编辑流程时，应锁定版本并在升级前完成回归验证。

## 主要能力

- 加载 GeoJSON、TopoJSON、Shapefile ZIP、KML、MSX 快照，以及可选的 GeoArrow、GeoParquet。
- 使用 Canvas2D 渲染点、线、面，支持视域裁剪、简化级别和属性驱动分桶填色。
- 支持选择、绘制、平移、旋转、缩放、拆分、合并、整形、节点、洞和多部件编辑。
- 通过可撤销命令实现撤销、重做、事务、校验和选择状态恢复。
- 将数据集操作卸载到 Web Worker，并在提交前检查异步结果是否过期。
- 通过受限且类型化的接口运行可选 DuckDB-Wasm SQL 与空间分析。
- 使用可选 MapLibre 服务管理底图、瓦片和在线叠加图层。

## 安装

```bash
pnpm add @mapseekai/emap
```

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import '@mapseekai/emap/style.css';
```

TypeScript 建议使用浏览器打包器解析方式：

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

宿主页面销毁时同步释放地图：

```ts
map.remove();
```

## 本地数据与 ZIP 边界

浏览器文件通过 `TopologySource.fromBytes()` 加载：

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

ZIP 内置默认限制为压缩输入最大 2 GiB、解压后内容总量最大 2 GiB；上面的示例针对公网上传主动设置了更严格的限制。ZIP 中存在重复 basename 时会明确报错，不会再静默拼接不同目录下的 Shapefile 与 sidecar。

## 编辑、历史与事务

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

操作返回 `OpResult`，需要检查 `ok`，不能仅依赖 `try/catch`。这里的 `source` 是已注册的数据源 ID，`target` 是数据源内的数据图层名称或 ID。

事务期间禁用撤销／重做，并拒绝清空历史或替换外部输入。外部数据替换会清理旧历史以及该数据源的选择和高亮；正常命令的撤销／重做不会触发这类重置。

传递给 mapshaper 的字符串表达式默认关闭。只有配置和数据完全可信时，才设置 `expressionPolicy: 'trusted'`。

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

`fill-color` 也支持文档中定义的受限表达式子集。表达式不使用 `eval`，并按照数据集属性版本缓存。

## Worker 卸载

将 Worker 和 vendor 文件部署到页面可访问路径：

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

主线程在提交 Worker 结果前会检查 Source 身份、几何版本和属性版本，避免旧结果覆盖新编辑。

## 可选 Arrow 与 GeoParquet

先安装 Arrow 子路径使用的可选 peer；只有 GeoParquet 导入或导出才需要安装 `parquet-wasm`：

```bash
pnpm add apache-arrow
pnpm add parquet-wasm # 仅 GeoParquet
```

导入 Arrow 子路径会注册 GeoArrow、GeoParquet 格式：

```ts
import '@mapseekai/emap/arrow';
import { fromArrowTable, toArrowTable } from '@mapseekai/emap/arrow';
```

只有实际使用 GeoParquet 时才会加载 `parquet-wasm`。

## 可选 DuckDB-Wasm

导入 DuckDB 子路径前先安装可选运行时 peer：

```bash
pnpm add @duckdb/duckdb-wasm apache-arrow
```

```ts
import {
  createDuckDbRuntimeFromJsDelivr,
  queryDatasetWithDuckDb,
  setDuckDbRuntime,
} from '@mapseekai/emap/duckdb';

const runtime = await createDuckDbRuntimeFromJsDelivr();
setDuckDbRuntime(runtime);

const result = await queryDatasetWithDuckDb(source.getDataset()!, {
  sql: 'SELECT geometry, name FROM input WHERE active = true',
});
```

查询接口只接受受限的单条 `SELECT`。距离类操作在需要平面单位时默认拒绝地理坐标系，避免把角度误当作长度。

## 可选 MapLibre 服务

需要在线底图或叠加服务时，通过 `MapOptions.mapLibre` 或 `map.mapLibre` 注册：

```ts
const map = new Emap({
  container: 'map',
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

该集成负责 MapLibre source/layer 资源所有权、请求版本、失败回滚和视图同步；可编辑 Canvas 图层仍由 emap 管理。

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

公共 `Emap` 类是统一门面，内部按照状态所有权和失败语义划分：

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
- `src/map/ops/`：可独立测试的数据和选择操作。
- `src/edit/commands/`：可撤销的原地修改。
- `src/renderer/`：Canvas 绘制与编辑覆盖层。
- `src/core/handlers/`：浏览器交互状态。
- `src/arrow/`、`src/duckdb/`：可选数据与分析入口。
- `src/map/maplibre-service-manager.ts`：可选在线服务资源和异步回滚。

几何修改与属性修改分别使用单调版本计数器；所有异步操作提交前都必须比较这两个版本。

## 开发

开发环境：

```text
Node.js 24
pnpm 11.15.1
```

主要门禁：

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

本地启动：

```bash
pnpm run examples:dev
pnpm run docs:dev
```

`packages/docs/static/api/` 是按需生成的 TypeDoc 产物，不进入 Git。`api:build`、`docs:build` 和 `docs:verify` 会自动生成。

修改 mapshaper 操作时，应同步更新 `src/map/ops/_runner.ts` 中的 effect 分类，并验证历史、选择、Worker 和 stale-operation 行为。完整协作规则见 [AGENTS.md](AGENTS.md)。

## 安全

漏洞报告方式见 [SECURITY.md](SECURITY.md)。不要为不可信配置开启 mapshaper 表达式；接收公网文件时应设置保守的数据源和 ZIP 上限。

## 许可证

[MPL-2.0](LICENSE)
