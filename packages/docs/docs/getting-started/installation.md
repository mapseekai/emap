---
id: installation
slug: /getting-started/installation
title: 安装
api: []
examples: []
stability: stable
verifiedVersion: 0.5.0
---

# 安装与第一张地图

本页使用 Vite 和 TypeScript 创建一个最小应用，加载远程 TopoJSON，并显示导航与历史控件。

## 环境要求

- 支持 ES module、Canvas 2D 和现代 JavaScript 的浏览器。
- npm、pnpm 或其他支持 package exports 的包管理器。

如果已有前端项目，可以直接从“安装 Emap”开始。

## 创建项目

```bash
pnpm create vite emap-demo --template vanilla-ts
cd emap-demo
pnpm install
```

也可以使用 npm：

```bash
npm create vite@latest emap-demo -- --template vanilla-ts
cd emap-demo
npm install
```

## 安装 Emap

```bash
pnpm add @mapseekai/emap
```

或：

```bash
npm install @mapseekai/emap
```

## 准备地图容器

将 `index.html` 的主体改为：

```html
<body>
  <div id="map"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
```

地图容器必须有非零宽度和高度。将 `src/style.css` 改为：

```css
html,
body,
#map {
  width: 100%;
  height: 100%;
  margin: 0;
}

body {
  overflow: hidden;
}
```

如果地图位于面板或弹窗中，不必占满整个页面，但父级布局必须最终为 `#map`
计算出实际尺寸。容器尺寸为零是“代码没有报错但地图空白”的最常见原因。

## 创建地图并加载数据

将 `src/main.ts` 改为：

```ts
import {
  Emap,
  HistoryControl,
  NavigationControl,
  TopologySource,
} from '@mapseekai/emap';
import '@mapseekai/emap/style.css';
import './style.css';

const map = new Emap({
  container: 'map',
});

map.addControl(new NavigationControl(), 'top-left');
map.addControl(new HistoryControl(), 'top-left');

async function loadMap(): Promise<void> {
  try {
    const source = await TopologySource.fromUrl(
      'china',
      'https://geojson.cn/api/china/1.6.3/china.topo.json',
    );

    map.addSource('china', source);
    map.setExtent(source.getExtent());
  } catch (error) {
    console.error('地图数据加载失败', error);
  }
}

void loadMap();
```

启动开发服务器：

```bash
pnpm dev
```

打开 Vite 输出的地址。成功时可以看到地图，并能通过导航控件缩放和平移。

## 代码执行顺序

1. `new Emap({ container: 'map' })` 在容器中创建 Canvas 和交互管理器。
2. `TopologySource.fromUrl(...)` 下载数据，按文件格式导入并构建 topology dataset。
3. `map.addSource(...)` 注册数据源，使其中的 source layers 可参与渲染和查询。
4. `source.getExtent()` 返回数据范围。
5. `map.setExtent(...)` 把初始视图移动到数据所在位置。

`TopologySource.fromUrl(...)` 完成前不要假设图层或范围已经存在。加载失败时应保留
原始错误供诊断，并在应用界面提供重试入口。

## 加载应用自己的文件

### 从 URL 加载

只要服务器允许浏览器访问该地址，就可以加载站内文件：

```ts
const source = await TopologySource.fromUrl('roads', '/data/roads.geojson');
map.addSource('roads', source);
map.setExtent(source.getExtent());
```

跨域地址必须返回允许当前站点访问的 CORS 响应头。

### 从二进制内容加载

文件上传或已获取的 `ArrayBuffer` 可以交给 `setData`：

```ts
const response = await fetch('/data/districts.geojson');
if (!response.ok) {
  throw new Error(`数据请求失败：${response.status}`);
}

const source = new TopologySource('districts');
const content = new Uint8Array(await response.arrayBuffer());

await source.setData({
  filename: 'districts.geojson',
  content,
});

map.addSource('districts', source);
map.setExtent(source.getExtent());
```

`filename` 很重要：导入器会使用扩展名区分 GeoJSON、TopoJSON、ZIP、
GeoParquet 等格式。`setData(...)` 会在 dataset 已填充且 `data` 事件已触发后 resolve。

## 使用显式样式图层

注册数据源后，可以添加自己的渲染图层：

```ts
map.addLayer({
  id: 'district-fill',
  type: 'fill',
  source: 'districts',
  paint: {
    'fill-color': '#5b8ff9',
    'fill-opacity': 0.65,
  },
});

map.addLayer({
  id: 'district-outline',
  type: 'line',
  source: 'districts',
  paint: {
    'line-color': '#1d39c4',
    'line-width': 1.5,
  },
});
```

同一数据源可以对应多个渲染图层。后添加的图层位于更靠上的绘制顺序。

## 可选 Worker 配置

仅在需要把较重的数据处理移出主线程时启用 Worker：

```ts
const map = new Emap({
  container: 'map',
  useWorker: 'auto',
  workerUrl: '/assets/emap-worker.js',
});
```

宿主应用需要将 `node_modules/@mapseekai/emap/dist/emap-worker.js` 和
`mapshaper-vendor.js` 一起复制到公开资源目录。两者默认应保持在同一目录，因为
Worker 会相对加载 vendor 文件。

## 常见启动问题

### 页面空白

依次检查：

1. `#map` 及其父级是否有实际尺寸。
2. 浏览器控制台是否有数据请求或 CORS 错误。
3. `map.addSource(...)` 使用的 ID 是否和图层 `source` 一致。
4. 加载完成后是否调用了 `setExtent` 或 `fitBounds`。
5. 显式图层的 `type` 是否与源几何类型匹配。

### 控件没有样式

确认应用入口导入了：

```ts
import '@mapseekai/emap/style.css';
```

### Worker 返回 404

直接在浏览器中访问 `workerUrl`，确认文件可公开读取；再确认同目录下存在
`mapshaper-vendor.js`。

## 下一步

- 阅读[数据源与图层](../concepts/source-layer.md)，了解 source layer 与渲染图层的区别。
- 阅读[样式图层](../guides/styling.md)，配置点、线和面的 paint。
- 阅读[事件](../guides/events.md)，把地图状态接入应用界面。
- 打开[可运行示例](/mapseekai/emap/examples/)，查看完整交互和数据处理场景。
