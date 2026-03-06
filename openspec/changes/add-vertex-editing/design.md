# 设计方案：添加节点编辑功能

## 背景

Emap 是一个基于 Mapshaper 拓扑格式构建的轻量级 GIS 渲染库，目前仅支持只读的平移/缩放/要素检视工作流。本设计描述如何添加**交互式节点编辑**功能——即鼠标悬停在要素上时显示节点（顶点）小圆点，并通过拖拽移动节点来修改几何形状——完整移植自 Mapshaper 浏览器 GUI 的交互模式。

## Mapshaper 节点编辑系统分析

Mapshaper GUI 的编辑管线由以下核心组件组成：

| 组件 | 文件 | 职责 |
|------|------|------|
| 交互模式控制器 | `gui-interaction-mode-control.mjs` | 提供检视/编辑/绘制模式切换下拉菜单 |
| 命中控制器 | `gui-hit-control.mjs` | 鼠标 → 要素 ID 解析；触发 hover/drag/click 事件 |
| 折线编辑控制器 | `gui-draw-lines2.mjs` | 处理节点悬停高亮、拖拽检测、坐标更新 |
| 覆盖样式器 | `gui-overlay-styler.mjs` | 为高亮要素生成节点小圆点样式 |
| Canvas 节点绘制 | `gui-canvas.mjs` `drawVertices()` | 在 Canvas 上绘制顶点圆圈和悬停高亮 |
| 绘制工具函数 | `gui-drawing-utils.mjs` | `snapVerticesToPoint`、`insertVertex`、`updateVertexCoords` |

### 节点编辑交互流程（Mapshaper）

```
用户移动鼠标
  → 命中控制器检测指针下的要素（e.id）
  → draw-lines2 调用 findDraggableVertices(e)
      → 使用 mapshaper.internal.findNearestVertices() + 10px 距离阈值
  → hit.setHoverVertex(displayPoint, 'vertex')
  → overlay-styler.getLineEditingStyle() → { vertices:true, vertex_overlay: point }
  → canvas.drawVertices() 绘制所有节点圆圈 + 放大的悬停高亮点

用户拖拽节点
  → hit.dragstart 触发 → _dragging = true
  → hit.drag 触发 → internal.snapVerticesToPoint(ids, p, displayArcs)
      （实时更新显示坐标）
  → hit.dragend 触发 → updateVertexCoords() 将坐标同步回源数据 arcs
  → gui.dispatchEvent('vertex_dragend') → 触发全图重绘
```

## Emap 架构适配

Emap 与 Mapshaper GUI 存在以下主要差异：

| 概念 | Mapshaper GUI | Emap |
|------|--------------|------|
| 渲染器 | `gui-canvas.mjs` 多层 Canvas | `CanvasPainter` 单层 Canvas |
| 命中测试 | `HitControl` + `gui-hit-test` | `map.ts` 中的 `queryRenderedFeatures()` |
| 交互模式 | `InteractionMode` 下拉菜单 | 无（始终为平移模式） |
| 事件系统 | `gui` 对象上的 `EventDispatcher` | `Emap` 实例上的 `EventDispatcher` |
| 坐标系 | `displayArcs`（投影坐标）+ 源 arcs | 拓扑源中的单一 arc 集合 |

### 关键设计决策

**1. 独立覆盖 Canvas**  
在主 Canvas 之上新增第二个 `<canvas>`（`_overlayCanvas`），专门用于绘制节点圆点和悬停高亮。这样在仅需更新节点高亮时，无需重绘全部源数据（对大型数据集尤为重要）。

**2. 节点编辑作为 Control 实现**  
`VertexEditControl` 实现 `Control` 接口，负责添加工具栏按钮。激活后，它向 Canvas 容器注册鼠标事件监听器，并向覆盖 Canvas 绘制内容。

**3. 仅支持移动节点（不含绘制路径）**  
本次变更仅涵盖**移动现有节点**（拖拽重塑）。节点插入、节点删除、新路径绘制均明确不在范围内。对应 Mapshaper 的 `vertices` 模式（`edit_vertices`），而非完整的 `edit_lines`/`edit_polygons` 模式。

**4. 直接调用 Mapshaper 内部 API**  
复用 `mapshaper.internal.findNearestVertices()`、`mapshaper.internal.snapVerticesToPoint()`、`mapshaper.internal.findClosestPointOnSeg()`，与 Mapshaper GUI 保持完全一致。Emap 的 `TopologySource` 已通过 `getArcs()` 和 `getDataset()` 暴露所需数据。

**5. 坐标空间转换**  
Emap 使用 `transform.unproject(px, py) → [x, y]` 和 `transform.project(x, y) → [px, py]`，等价于 Mapshaper 的 `ext.pixCoordsToMapCoords` / `ext.translateCoords`。

## 整体架构

```
VertexEditControl（新增）
  ├─ 向地图 UI 添加"✏ 编辑"按钮
  ├─ 激活时：设置 map._editMode = 'vertex'
  ├─ 监听 canvasContainer：mousemove、mousedown、mouseup
  ├─ mousemove 时：
  │    ├─ queryRenderedFeatures(point) → 查找悬停要素
  │    ├─ findNearestVertex(feature, point, threshold=10px)
  │    └─ drawOverlay(要素的所有节点, 悬停节点)
  ├─ mousedown（若 hoverVertex 存在）：开始拖拽
  ├─ mousemove（拖拽中）：snapVerticesToPoint → 重绘覆盖层
  └─ mouseup（拖拽中）：
       ├─ 将坐标提交到源 arcs
       ├─ 触发 map.fire('vertex_moved', { id, source, layer, coords })
       └─ map.render()（全图重绘数据层）

Emap（修改）
  ├─ _overlayCanvas: HTMLCanvasElement（新增）
  ├─ _editMode: 'none' | 'vertex'（新增）
  ├─ clearOverlay(): void（新增）
  └─ render()（不变，仅使用主 Canvas）

CanvasPainter（修改）
  └─ drawVertexDots(canvas, transform, shapes, arcs, style): void（新增方法）
       为要素子集绘制节点圆圈
```

## 不在本次范围内

- 新增节点（节点插入）
- 删除节点
- 绘制新路径
- 撤销/重做（未来功能）
- 拓扑编辑（共享节点联动，可在此基础上叠加实现）
