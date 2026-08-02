# Emap

<p align="center">
  <img src="packages/docs/static/img/emap.svg" alt="Emap 标志" width="160" />
</p>

[English](README.md)

`Emap` 是一个仅在浏览器中运行的 TypeScript 地图渲染与编辑引擎，基于
Mapshaper 的拓扑数据结构和 HTML5 Canvas 2D。它面向不依赖框架、无需后端服务的
GIS 应用，提供客户端数据加载、渲染、选择、拓扑感知编辑、数据操作、撤销/重做和
自定义界面集成能力。

## 项目状态

`Emap` 仍在快速演进，API、行为和实现细节可能在未提供成熟 GIS 引擎兼容性承诺的
情况下发生变化。暂不建议直接用于生产环境；请先在原型、演示、研究工具或受控的
内部工作流中评估。

## 主要能力

- 面向 Mapshaper 数据集的拓扑优先渲染，复用共享弧段并支持 LOD。
- 支持 GeoJSON、TopoJSON、ZIP Shapefile 与 Mapshaper 快照加载。
- 使用 MapLibre 风格的 `fill`、`line` 与 `circle` 图层规范。
- 内置 `dragPan`、`scrollZoom`、`clickSelect`、`boxSelect`、`lassoSelect`、
  `vertexEdit`、`drawFeature` 和 `transformFeature` 等命名交互处理器。
- 可只使用交互处理器、不使用内置 UI 控件，也可围绕相同处理器构建自己的工具栏。
- 支持 `feature:click`、`feature:hover`、`feature:enter` 和 `feature:leave`
  等委托要素事件。
- 提供 `jumpTo`、`easeTo`、`flyTo`、`fitBounds`、`panBy`、`panTo`、`zoomTo`
  和 `stop` 等相机方法。
- 提供 30 多个由 Mapshaper 命令驱动的 `map.ops.*` 数据操作。
- 支持撤销/重做、事务、校验器、要素访问、高亮与完整会话快照。
- 可选 Web Worker，用于开销较大的数据集替换操作。
- 可选 `@mapseekai/emap/duckdb` 模块，提供 DuckDB-Wasm 空间处理和 GeoParquet 查询。
- 使用 CSS 设计令牌定制内置 UI 的主题。

## 文档与示例

- 简体中文文档：<https://mapseekai.github.io/mapseekai/emap/>
- 英文文档：<https://mapseekai.github.io/mapseekai/emap/en/>
- API 参考：<https://mapseekai.github.io/mapseekai/emap/api/>
- 可运行示例：<https://mapseekai.github.io/mapseekai/emap/examples/>
- 发布核对清单：[docs/release-checklist.md](docs/release-checklist.md)

站点文档和 API 参考涵盖完整公开接口、数据格式、编辑、选择、相机、主题和部署细节。

## 安装

```bash
npm install @mapseekai/emap
# 或
pnpm add @mapseekai/emap
```

## 快速开始

### 打包工具

```ts
import {
  Emap,
  TopologySource,
  NavigationControl,
  HistoryControl,
} from '@mapseekai/emap';
import '@mapseekai/emap/style.css';

const map = new Emap({ container: 'map' });
map.addControl(new NavigationControl(), 'top-left');
map.addControl(new HistoryControl(), 'top-left');

const source = await TopologySource.fromUrl(
  'china',
  'https://geojson.cn/api/china/1.6.3/china.topo.json',
);

await map.addSource('china', source);
map.setExtent(source.getExtent());
```

ESM 构建可直接在浏览器中使用。Mapshaper 作为同级 ES 模块随包分发，Vite、webpack、
esbuild 和 Bun 通常不需要额外配置 `Buffer` polyfill 或别名。

### 静态资源

部分运行时文件通过 URL 加载，而不是内联到应用包中：

| 资源 | 使用场景 |
|---|---|
| `dist/emap.css` | 内置控件、上下文菜单与默认 UI 样式 |
| `dist/mapshaper-vendor.js` | IIFE 脚本用法与 Worker 启动 |
| `dist/emap-worker.js` | `useWorker: true` 或 `useWorker: 'auto'` |

使用打包工具时，优先直接导入样式：

```ts
import '@mapseekai/emap/style.css';
```

对于 script 标签或静态托管部署，请将
`node_modules/@mapseekai/emap/dist/` 下的文件复制到公开资源目录。使用 Worker 时，
除非自行打包 Worker，否则 `emap-worker.js` 与 `mapshaper-vendor.js` 必须在同一目录，
因为 Worker 会通过相对路径 `importScripts('mapshaper-vendor.js')` 导入后者。

## 加载数据

```ts
const source = await TopologySource.fromUrl('roads', '/data/roads.geojson');
await map.addSource('roads', source);
map.setExtent(source.getExtent());

const local = new TopologySource('local');
await local.setData({ filename: 'upload.zip', content: bytes });
await map.addSource('local', local);
```

`TopologySource.setData()` 在数据集填充完成且 `data` 事件触发后才会完成。始终
先在地图外加载 source，再 `await map.addSource()`。它是 source 预检与确认流程的
便捷包装，可能在注册前重投影 detached dataset。dataset 没有 CRS 元数据时，应显式
提供数据 CRS：

```ts
await map.addSource('local', local, { sourceCrs: 'EPSG:3857' });
```

需要由 UI 补充 CRS 时，使用两阶段 API；复用 `draft` 不会重新读取输入：

```ts
let result = await map.preflightSource({ id: 'local', source: local });
if (result.status === 'needs-input') {
  result = await map.preflightSource(result.draft, { sourceCrs: selectedCrs });
}
if (result.status === 'ready') {
  await map.confirmSource(result.plan);
}
```

显式 `sourceCrs` 优先于 dataset 元数据；两者都没有时，预检返回
`needs-input`，不会猜测。空 source 不能先注册：应先加载，再调用
`addSource()` 或 `preflightSource()`。

支持的输入包括：

- GeoJSON 和 TopoJSON。
- 包含 `.shp`、`.dbf`、`.shx` 及可选 `.prj` 的 ZIP Shapefile。
- 通过 `map.loadSnapshot()` 读取的 Mapshaper `.msx` 快照。
- 导入可选 Arrow 模块后的 GeoParquet 与 GeoArrow。

## 图层与渲染

```ts
map.addLayer({
  id: 'roads-line',
  source: 'roads',
  type: 'line',
  paint: {
    'line-color': '#4a5568',
    'line-width': 1,
    'line-dashstyle': 'dash',
  },
});

map.addLayer({
  id: 'district-fill',
  source: 'districts',
  type: 'fill',
  paint: {
    'fill-color': 'rgba(66, 153, 225, 0.25)',
    'line-width': 0,
  },
});

### 线样式补充

对 `line`（以及 `fill` 的边框）可选：

- `'line-dashstyle': 'solid' | 'dash' | 'dot' | 'dash-dot' | 'arrow-dot'`
- `'line-arrow-spacing'`：箭头点画线中箭头的屏幕像素间距
- `'line-arrow-size'`：箭头尺寸（像素）

现有的 `line-dasharray` 行为保持不变；若同时配置了 `line-dasharray` 与
`line-dashstyle`，将按 `line-dashstyle` 生效。

`arrow-dot` 在一个批量 Canvas path 中同时绘制短划段和箭头翼，按每条可见
polyline/环的坐标顺序定向，并缓存屏幕空间命令，直到几何、视图、像素比或
箭头布局样式变化。
```

未添加自定义图层时，`Emap` 会按源数据几何类型创建默认显示图层。为便于大数据浏览，
多边形默认仅绘制边线；需要填充时请显式添加 `fill` 图层。

## 交互与自定义 UI

大多数编辑和选择工具以命名处理器的形式提供，可直接接入自己的 UI：

```ts
map.boxSelect.setOptions({
  layers: ['district-fill'],
  dragThreshold: 4,
});
map.boxSelect.enable();

map.drawFeature.setOptions({
  source: 'editing',
  sourceLayer: 'areas',
  type: 'polygon',
  snapSources: ['editing', 'reference'],
});
map.drawFeature.enable();

map.vertexEdit.enable();
```

所有处理器都提供以下基础接口：

```ts
handler.enable();
handler.disable();
handler.isEnabled();
handler.setOptions({...});
handler.getOptions();
```

内置控件包括 `NavigationControl`、`StatusControl`、`BasemapControl`、
`HistoryControl`、`EditToolbar`、`VertexEditControl`、`DrawFeatureControl`、
`BoxSelectControl`、`LassoSelectControl` 和 `SimplifyControl`。

## 数据操作、事务与校验

`map.ops.*` 提供基于 Mapshaper 的数据转换操作。使用事务可将多步编辑组合成一条
可撤销的历史记录：

```ts
const tx = map.beginTransaction();

const clipped = await map.ops.clipLayer({
  source: 's',
  target: 'parcels',
  mask: 'clip',
});

if (!clipped.ok) {
  tx.rollback();
} else {
  await tx.commit('Clip parcels');
}

map.undo();
map.redo();
```

提交后可注册校验器；校验失败会触发 `validationfailed` 事件，而不会自动撤销。

## Worker 与主题

对于裁剪、融合、并集、简化、投影等数据集替换型操作，可以启用 Worker：

```ts
const map = new Emap({
  container: 'map',
  useWorker: 'auto',
  workerThreshold: 200_000,
  workerUrl: '/vendor/emap/emap-worker.js',
  workerPoolSize: 2,
});
```

导入默认样式后，可在 `:root` 或应用容器中覆盖 CSS 令牌，例如
`--emap-accent`、`--emap-surface-bg`、`--emap-font` 和 `--emap-radius`。

## 开发

安装前请启用 Corepack：

```bash
corepack enable
corepack prepare pnpm@11.15.1 --activate
pnpm install
```

常用命令：

```bash
pnpm run dev            # Rollup 监听构建
pnpm run dev-build      # 一次性开发构建
pnpm run examples:dev   # 启动可运行示例
pnpm run docs:dev       # 启动文档开发服务器
pnpm run docs:preview   # 预览文档、API 与示例
pnpm run format:check   # 检查 Biome 格式
pnpm run typecheck      # 运行 TypeScript 类型检查
pnpm run test:run       # 运行 Vitest
pnpm run build          # 生产构建到 dist/
```

详细的架构、公开 API、数据格式与发布步骤请参阅 [English README](README.md) 和
文档站点。

## 已知限制

- 当前为 Canvas 2D 渲染器，不提供 WebGL 渲染、符号排布、矢量瓦片数据源或服务端瓦片管线。
- 大型多边形数据的填充渲染比线条渲染开销更高；大数据浏览建议优先显示边线，并在适当
  比例尺或过滤条件下启用填充。
- 坐标参考系支持依赖于内置 Mapshaper/投影路径；构建面向最终用户的编辑流程前，请验证
  项目所需的 CRS 定义。
- 表达式类操作默认禁用。仅对第一方表达式和可信数据设置 `expressionPolicy: 'trusted'`。
- Worker 需要宿主应用正确部署 `emap-worker.js` 与 `mapshaper-vendor.js`，并不会让所有
  交互都异步执行。

## 许可证

[MPL-2.0](LICENSE)
