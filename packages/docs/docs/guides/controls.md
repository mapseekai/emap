---
id: controls
slug: /guides/controls
title: 控件
api: ["BasemapControl","BasemapOptions","BasemapStyle","BoxSelectControl","BoxSelectControlOptions","Control","ControlPosition","DrawFeatureControl","DrawFeatureControlOptions","EditToolbar","EditToolbarOptions","Emap","GetScaleMetricsOptions","HistoryControl","HistoryControlOptions","LassoSelectControl","LassoSelectControlOptions","LayerChangeEvent","LayerChangeReason","LayerControl","MapLibreBasemapService","MapLibreIntegrationOptions","MapLibreOverlayService","MapLibreOverlayServiceBase","MapLibreOverlayResourceService","MapLibreOverlayStyleService","MapLibreService","MapLibreServiceChangeEvent","MapLibreServiceChangeReason","MapLibreServiceErrorEvent","MapLibreServiceEventMap","MapLibreServiceManager","MapLibreServiceState","MapOptions","MeasureControl","MeasureControlOptions","MeasureHandler","MeasurementMode","MeasureOptions","MeasureResult","NavigationControl","NavigationOptions","ScaleCalculationMethod","ScaleControl","ScaleControlOptions","ScaleControlStyle","ScaleMetrics","ScaleViewMetrics","SimplifyControl","SimplifyControlOptions","StatusControl","StatusOptions","VertexEditControl","VertexEditControlOptions"]
examples: ["box-select","china-editing","draw-snap-edge","interaction-handlers","lasso-select","measurement","online-map-services","simplify-control","vertex-editing"]
stability: stable
verifiedVersion: 0.8.1
---

# 控件

控件是在地图四角挂载 DOM 的可选 UI。它们调用公开地图 API 或切换 Handler，
不拥有另一份地图状态。应用可以使用全部内置控件，也可以只使用引擎并构建自己的界面。

## 添加与移除

```ts
const navigation = new NavigationControl();

map.addControl(navigation, 'top-left');
map.removeControl(navigation);
```

位置类型：

- `top-left`
- `top-right`
- `bottom-left`
- `bottom-right`

省略位置时默认 `top-left`。移除时必须传入添加时的同一个控件实例。

## 控件样式

使用内置控件必须导入：

```ts
import '@mapseekai/emap/style.css';
```

控件挂载到 map container 内，因此容器所在页面的全局 CSS 可能影响按钮、输入框和字体。
覆盖样式时优先使用应用外层 class 限定作用域。

## 常用控件

| 控件 | 用途 |
|---|---|
| `NavigationControl` | 放大、缩小和视图导航 |
| `HistoryControl` | 撤销与重做 |
| `StatusControl` | 显示指针坐标与 EPSG |
| `ScaleControl` | 显示当前视图的比例尺与缩放等级 |
| `MeasureControl` | 测量球面长度或面积 |
| `BasemapControl` | 在已注册的 MapLibre 底图中单选 |
| `LayerControl` | 切换 Emap 业务图层与 MapLibre 在线叠加层 |
| `BoxSelectControl` | 拉框选择 |
| `LassoSelectControl` | 套索选择 |
| `VertexEditControl` | 顶点编辑模式 |
| `DrawFeatureControl` | 绘制点、线或面 |
| `EditToolbar` | 组合常用编辑模式 |
| `SimplifyControl` | 调整并提交简化操作 |

## 原生 MapLibre 在线服务

`mapLibre.services` 直接接收原生 MapLibre 样式与 source 规范。底图拥有一份完整样式；
叠加层拥有命名 source 和 layer，管理器会在切换底图样式后恢复这些托管资源。

### 栅格服务模板

下面的辅助函数在保留原生 MapLibre source 配置的同时，减少完整叠加层定义的重复代码：

```ts
import type {
  MapLibreOverlayResourceService,
} from '@mapseekai/emap';

function rasterOverlay(
  id: string,
  name: string,
  source: MapLibreOverlayResourceService['sources'][string],
): MapLibreOverlayResourceService {
  return {
    id,
    name,
    role: 'overlay',
    sources: { [id]: source },
    layers: [{ id: `${id}-layer`, type: 'raster', source: id }],
  };
}

const overlays: MapLibreOverlayResourceService[] = [
  // XYZ 栅格瓦片
  rasterOverlay('xyz', 'XYZ imagery', {
    type: 'raster',
    tiles: ['https://tiles.example.com/xyz/{z}/{x}/{y}.png'],
    tileSize: 256,
  }),

  // TMS 会翻转原生 {y} 瓦片坐标。
  rasterOverlay('tms', 'TMS imagery', {
    type: 'raster',
    tiles: ['https://tiles.example.com/tms/{z}/{x}/{y}.png'],
    scheme: 'tms',
    tileSize: 256,
  }),

  // Web Mercator 下的 WMS GetMap
  rasterOverlay('wms', 'WMS weather', {
    type: 'raster',
    tiles: [
      'https://maps.example.com/wms?service=WMS&request=GetMap&version=1.1.1&layers=weather&styles=&format=image/png&transparent=true&srs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256',
    ],
    tileSize: 256,
  }),

  // 服务提供方给出的 RESTful WMTS 模板
  rasterOverlay('wmts', 'WMTS imagery', {
    type: 'raster',
    tiles: [
      'https://tiles.example.com/wmts/world/default/WebMercatorQuad/{z}/{y}/{x}.png',
    ],
    tileSize: 256,
  }),

  // URL 指向 TileJSON 文档，而不是单个瓦片。
  rasterOverlay('tilejson', 'TileJSON imagery', {
    type: 'raster',
    url: 'https://tiles.example.com/imagery/tiles.json',
  }),
];
```

这些配置只是 URL/source 描述，不会发起服务发现请求。Emap 不读取 WMS/WMTS
GetCapabilities，也不会转换任意服务 CRS；请使用直接提供 Web Mercator
（`EPSG:3857`）瓦片的端点与瓦片矩阵。

### 完整样式底图与构造配置

底图的 `style` 可以是完整 MapLibre 样式 URL，也可以是完整的样式 JSON 对象：

```ts
import {
  Emap,
  type MapLibreBasemapService,
} from '@mapseekai/emap';

const basemaps: MapLibreBasemapService[] = [
  {
    id: 'provider-style',
    name: 'Provider style',
    role: 'basemap',
    style: 'https://tiles.example.com/styles/streets/style.json',
  },
  {
    id: 'osm-json',
    name: 'OpenStreetMap raster',
    role: 'basemap',
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
        },
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    },
  },
];

const providerToken = 'YOUR_TOKEN';
const map = new Emap({
  container: 'map',
  mapLibre: {
    services: [...basemaps, ...overlays],
    defaultBasemap: 'provider-style',
    mapOptions: {
      transformRequest: (url, resourceType) => {
        if (!url.startsWith('https://tiles.example.com/')) return { url };
        const rewritten = url.replace(
          'https://tiles.example.com/',
          'https://cdn.example.com/',
        );
        const separator = rewritten.includes('?') ? '&' : '?';
        return {
          url: `${rewritten}${separator}access_token=${encodeURIComponent(providerToken)}`,
          headers:
            resourceType === 'Tile'
              ? { 'X-Map-Client': 'emap-documentation' }
              : {},
        };
      },
    },
  },
});
```

`transformRequest` 是处理服务商 URL 重写、查询参数令牌与请求头的原生入口。Emap
负责 MapLibre 的 container、style、center、zoom 与非交互模式，因此
`mapOptions` 不开放这些键。

### 完整样式叠加层

完整的 MapLibre Style v8 URL 或 JSON 也可以作为 `role: 'overlay'` 注册。样式叠加层
必须定义 `style`，不能同时定义 `sources` 和 `layers`；资源叠加层则使用后两者。

```ts
await map.mapLibreServices.addService({
  id: 'openfreemap-bright',
  name: 'OpenFreeMap Bright',
  role: 'overlay',
  visible: true,
  style: 'https://tiles.openfreemap.org/styles/bright',
});
```

管理器会忽略样式中的 `background` layer，并将其余 source、layer 和 sprite 名称以服务
ID 命名空间隔离；sprite 图像引用也会随之重写。显示或隐藏这种服务会显示或隐藏其完整的
非背景样式，同时保留各 layer 原有的 visibility。由于一个 MapLibre 样式只能使用一个全局
glyph URL，活动底图和所有样式叠加层的 glyph URL 必须相同或不存在；相同 URL 可以共用，
不同 URL 会被确定性地拒绝。

固定画布从下到上依次为：活动的 MapLibre 底图、托管的 MapLibre 叠加层，以及位于两者
之上的 Emap 业务数据和编辑画布。

样式 URL、相对 source/sprite/glyph URL 与请求头同样经过 `transformRequest`。服务范围内
的异步错误通过 `error` 事件报告，并在事件的 `serviceId` 中标识相应服务；被后续添加、
更新、删除或可见性操作取代的请求会以 `AbortError` 取消，而不是作为最终服务错误发布。

激活底图或可见叠加层需要 Web Mercator。必要时，管理器会先把当前 Emap 数据重投影到
`webmercator`（`EPSG:3857`），再显示服务；启用在线服务时需考虑这一数据 CRS 变化。

### 运行时注册表与状态

使用地图持有的管理器添加、替换、删除、显示或隐藏服务。更新服务时必须保持相同的
`id` 和 `role`。

```ts
const services = map.mapLibreServices;
const live = rasterOverlay('live', 'Live overlay', {
  type: 'raster',
  tiles: ['https://tiles.example.com/live/{z}/{x}/{y}.png'],
  tileSize: 256,
});

await services.addService(live);
await services.updateService('live', {
  ...live,
  name: 'Live overlay (updated)',
});
await services.setOverlayVisibility('live', false); // 隐藏
await services.setOverlayVisibility('live', true);  // 显示
await services.setBasemap('osm-json');
await services.setBasemap(null); // 不激活任何底图

const state = services.getServiceState('live');
if (state?.status === 'error') console.error(state.error);

services.on('error', ({ serviceId, phase, fatal, error }) => {
  console.error({ serviceId, phase, fatal, error });
});

await services.removeService('live');
```

`getServiceState()` 返回 `idle`、`loading`、`ready` 或 `error`，发生错误时还包含
最近一次错误。注册表 `change` 事件和有类型的 `error` 事件可用于让应用界面跟踪异步的
样式、source、layer 与瓦片工作。

### 访问原始 MapLibre 地图

底层地图只有在激活服务并完成创建后才存在，此前 `getMapLibreMap()` 返回 `null`：

```ts
const rawMap = map.mapLibreServices.getMapLibreMap();
rawMap?.addSource('unmanaged-debug-source', {
  type: 'geojson',
  data: { type: 'FeatureCollection', features: [] },
});
```

通过原始地图添加的资源不受 Emap 管理，切换底图样式时可能消失。需要长期保留的在线内容
应注册为服务。

### 控件职责、画布顺序与 CSS

`BasemapControl` 是已注册底图的单选器，同一时间最多激活一个底图；`LayerControl`
为 Emap 业务图层和 MapLibre 叠加层提供可见性复选框。两者都不提供透明度或排序界面。

MapLibre 画布固定在所有 Emap 图层下方。所有托管底图和在线叠加层都在这个下层画布中
渲染，因此无法把 MapLibre 与 Emap 图层交错排列为同一个跨画布顺序。

Emap 样式已包含托管画布所需的最小布局：

```ts
import '@mapseekai/emap/style.css';
```

如果应用通过 `getMapLibreMap()` 添加 MapLibre 控件、popup 或 marker，还必须导入
MapLibre 组件样式：

```ts
import '@mapseekai/emap/style.css';
import 'maplibre-gl/dist/maplibre-gl.css';
```

## 导航、历史与状态

```ts
map.addControl(new NavigationControl(), 'top-left');
map.addControl(new HistoryControl(), 'top-right');
map.addControl(
  new StatusControl({
    showMousePos: true,
    showEPSG: true,
    alignment: 'right',
  }),
  'bottom-right',
);
```

`StatusControl` 的更新会延迟到 `requestAnimationFrame`，避免每次 pointermove
都立即改写 DOM。

## 比例尺与测量

`ScaleControl` 会依据当前 CRS 和视图范围更新比例尺；无法得到可靠地表距离时会自动隐藏。
`map.getScaleMetrics()` 可供自定义界面读取同一份计算结果。两个 `MeasureControl` 实例分别启用长度和面积模式：

```ts
map.addControl(new ScaleControl({ units: 'metric', style: 'checker' }), 'bottom-left');
map.addControl(new MeasureControl({ mode: 'length' }), 'top-left');
map.addControl(new MeasureControl({ mode: 'area' }), 'top-left');
```

测量以球面距离和面积计算；点击依次添加顶点，结束当前测量后可重新开始。

## 模式控件

选择和编辑控件负责启用对应 Handler：

```ts
const boxControl = new BoxSelectControl();
const vertexControl = new VertexEditControl();

map.addControl(boxControl, 'top-left');
map.addControl(vertexControl, 'top-left');
```

应用切换工具时应确保只有当前手势模式启用。不要同时在控件外复制 pointerdown /
pointermove 流程，否则可能绕过 HandlerManager 的互斥和光标管理。

## 自定义控件

自定义控件实现 `Control`：

```ts
import type { Control, Emap } from '@mapseekai/emap';

class ResetViewControl implements Control {
  private button: HTMLButtonElement | null = null;
  private map: Emap | null = null;

  onAdd(map: Emap): HTMLElement {
    this.map = map;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.textContent = '重置';
    this.button.addEventListener('click', this.handleClick);
    return this.button;
  }

  onRemove(): void {
    this.button?.removeEventListener('click', this.handleClick);
    this.button?.remove();
    this.button = null;
    this.map = null;
  }

  private handleClick = (): void => {
    this.map?.reset();
  };
}

map.addControl(new ResetViewControl(), 'top-left');
```

`onAdd` 返回的元素由地图放入指定位置。`onRemove` 必须释放事件监听和其他外部资源。

## 自建工具栏

不使用内置控件时，业务按钮可以直接调用公开 API：

```ts
undoButton.addEventListener('click', () => map.undo());

boxButton.addEventListener('click', () => {
  map.lassoSelect.disable();
  map.boxSelect.enable();
});
```

使用 `historychange`、`selectionchange` 和 `editmodechange` 更新按钮状态，不要假设
一次点击一定成功。

## 常见问题

### 控件可见但无法点击

检查应用 CSS 是否覆盖 `pointer-events` 或被更高层 DOM 遮挡。通过 `addControl`
添加的元素会自动设置 `pointer-events: auto`。

### 移除后仍收到事件

自定义控件需要在 `onRemove` 中解绑自己注册的 DOM 或地图 listener。

### 多个编辑按钮同时激活

让按钮显示状态来自地图 Handler 的 `isEnabled()` 或 `editmodechange`，并在启用新模式前
禁用旧模式。

## API

- [Control](/mapseekai/emap/api/interfaces/emap.Control.html)
- [ControlPosition](/mapseekai/emap/api/types/emap.ControlPosition.html)
- [NavigationControl](/mapseekai/emap/api/classes/emap.NavigationControl.html)
- [HistoryControl](/mapseekai/emap/api/classes/emap.HistoryControl.html)
- [StatusControl](/mapseekai/emap/api/classes/emap.StatusControl.html)
- [ScaleControl](/mapseekai/emap/api/classes/emap.ScaleControl.html)
- [ScaleControlOptions](/mapseekai/emap/api/interfaces/emap.ScaleControlOptions.html)
- [ScaleMetrics](/mapseekai/emap/api/interfaces/emap.ScaleMetrics.html)
- [ScaleViewMetrics](/mapseekai/emap/api/interfaces/emap.ScaleViewMetrics.html)
- [MeasureControl](/mapseekai/emap/api/classes/emap.MeasureControl.html)
- [MeasureControlOptions](/mapseekai/emap/api/interfaces/emap.MeasureControlOptions.html)
- [MeasureHandler](/mapseekai/emap/api/classes/emap.MeasureHandler.html)
- [MeasureOptions](/mapseekai/emap/api/interfaces/emap.MeasureOptions.html)
- [MeasureResult](/mapseekai/emap/api/interfaces/emap.MeasureResult.html)

## 可运行示例

- [简化控件](/mapseekai/emap/examples/simplify-control/)
- [撤销与重做](/mapseekai/emap/examples/undo-redo/)
- [交互处理器](/mapseekai/emap/examples/interaction-handlers/)
- [球面测量](/mapseekai/emap/examples/measurement/)
- [顶点编辑](/mapseekai/emap/examples/vertex-editing/)
