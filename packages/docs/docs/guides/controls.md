---
id: controls
slug: /guides/controls
title: 控件
api: ["BasemapControl","BasemapOptions","BasemapStyle","BoxSelectControl","BoxSelectControlOptions","Control","ControlPosition","DrawFeatureControl","DrawFeatureControlOptions","EditToolbar","EditToolbarOptions","Emap","HistoryControl","HistoryControlOptions","LassoSelectControl","LassoSelectControlOptions","NavigationControl","NavigationOptions","SimplifyControl","SimplifyControlOptions","StatusControl","StatusOptions","VertexEditControl","VertexEditControlOptions"]
examples: ["box-select","china-editing","draw-snap-edge","interaction-handlers","lasso-select","simplify-control","vertex-editing"]
stability: stable
verifiedVersion: 0.5.0
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
| `BasemapControl` | 切换应用提供的底图样式 |
| `BoxSelectControl` | 拉框选择 |
| `LassoSelectControl` | 套索选择 |
| `VertexEditControl` | 顶点编辑模式 |
| `DrawFeatureControl` | 绘制点、线或面 |
| `EditToolbar` | 组合常用编辑模式 |
| `SimplifyControl` | 调整并提交简化操作 |

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

- [Control](/mapseekai/emap/api/interfaces/index.Control.html)
- [ControlPosition](/mapseekai/emap/api/types/index.ControlPosition.html)
- [NavigationControl](/mapseekai/emap/api/classes/index.NavigationControl.html)
- [HistoryControl](/mapseekai/emap/api/classes/index.HistoryControl.html)
- [StatusControl](/mapseekai/emap/api/classes/index.StatusControl.html)

## 可运行示例

- [简化控件](/mapseekai/emap/examples/simplify-control/)
- [撤销与重做](/mapseekai/emap/examples/undo-redo/)
- [交互处理器](/mapseekai/emap/examples/interaction-handlers/)
- [顶点编辑](/mapseekai/emap/examples/vertex-editing/)
