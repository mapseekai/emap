---
id: controls
slug: /guides/controls
title: 控件
api: ["BasemapControl","BasemapOptions","BasemapStyle","BoxSelectControl","BoxSelectControlOptions","Control","ControlPosition","DrawFeatureControl","DrawFeatureControlOptions","EditToolbar","EditToolbarOptions","Emap","GetScaleMetricsOptions","HistoryControl","HistoryControlOptions","LassoSelectControl","LassoSelectControlOptions","LayerChangeEvent","LayerChangeReason","LayerControl","MapLibreBasemapService","MapLibreIntegrationOptions","MapLibreOverlayService","MapLibreOverlayServiceBase","MapLibreOverlayResourceService","MapLibreOverlayStyleService","MapLibreService","MapLibreServiceChangeEvent","MapLibreServiceChangeReason","MapLibreServiceErrorEvent","MapLibreServiceEventMap","MapLibreServiceManager","MapLibreServiceState","MapOptions","MeasureControl","MeasureControlOptions","MeasureHandler","MeasurementMode","MeasureOptions","MeasureResult","NavigationControl","NavigationOptions","ScaleCalculationMethod","ScaleControl","ScaleControlOptions","ScaleControlStyle","ScaleMetrics","ScaleViewMetrics","SimplifyControl","SimplifyControlOptions","StatusControl","StatusOptions","VertexEditControl","VertexEditControlOptions"]
examples: ["box-select","china-editing","draw-snap-edge","interaction-handlers","lasso-select","measurement","online-map-services","simplify-control","vertex-editing"]
stability: stable
verifiedVersion: 0.9.1
---

# 控件

控件是在地图四角挂载 DOM 的可选界面。它们调用地图公开 API 或配置 Handler，不保存另一份地图状态。

## 添加和移除控件

导入控件 CSS 后，将控件实例加入位置：

```ts
import '@mapseekai/emap/style.css';
import { HistoryControl, NavigationControl, ScaleControl } from '@mapseekai/emap';

const navigation = new NavigationControl({ showHome: true });
map.addControl(navigation, 'top-left');
map.addControl(new HistoryControl(), 'top-right');
map.addControl(new ScaleControl(), 'bottom-left');

map.removeControl(navigation);
```

位置为 `top-left`、`top-right`、`bottom-left` 或 `bottom-right`。

## 选择内置控件

| 控件 | 用途 |
|---|---|
| `NavigationControl` | 缩放和重置视图 |
| `StatusControl` | 显示状态文本 |
| `ScaleControl` | 显示基于 CRS 和视图的比例尺 |
| `HistoryControl` | 撤销和重做按钮 |
| `LayerControl` | 切换 Emap 图层可见性 |
| `BasemapControl` | 选择已注册的 MapLibre 底图 |
| `DrawFeatureControl`、`VertexEditControl`、`EditToolbar` | 激活编辑工具 |
| `MeasureControl` | 激活长度或面积测量模式 |
| `BoxSelectControl`、`LassoSelectControl` | 激活选择拖拽工具 |
| `SimplifyControl` | 运行简化操作 |

绘制和测量控件需要自己的选项：

```ts
map.addControl(
  new DrawFeatureControl({ source: 'parcels', sourceLayer: 'lots', type: 'polygon' }),
  'top-left',
);
map.addControl(new MeasureControl({ mode: 'area' }), 'top-left');
```

一个控件被移除时会清理其 DOM 和事件监听器；会启用 Handler 的控件也会关闭自己启用的 Handler。

## 可运行示例

- [编辑中国数据](/mapseekai/emap/examples/china-editing/)
- [顶点编辑](/mapseekai/emap/examples/vertex-editing/)
- [测量](/mapseekai/emap/examples/measurement/)
