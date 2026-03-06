# 设计方案：修复拓扑节点编辑

## 问题分析

### 问题1：不支持拓扑编辑

当前 `_findNearestVertex()` 仅记录单个 `(_hoverArcId, _hoverVertexIdx)` ，拖拽时只修改该 arc 的一个顶点。在拓扑数据中，多个 arc 共享同一节点（如两个多边形的公共边界点），只移动其中一个会导致拓扑断裂。

**Mapshaper 的做法**（`mapshaper-vertex-utils.mjs`）：
```
findNearestVertices(p, shp, arcs)
  → findNearestVertex(x, y, shp, arcs)  // 找最近顶点坐标
  → findVertexIds(x, y, arcs)            // 扫描整个 ArcCollection，
                                         // 返回所有坐标相同的顶点 index 数组
```

### 问题2：拖拽时视图不更新

当前 `_handleDrag()` 调用 `arcs.setVertex()` (不存在) 。应使用 `mapshaper.internal.snapVerticesToPoint(ids, p, arcs)` 修改坐标 + `map.render()` 重绘。

### 问题3：节点绘制在独立的 overlay canvas 上

当前实现使用 `_overlayCanvas` 专门绘制节点圆点。**Mapshaper 的做法完全不同**：

```
drawStyledLayerToCanvas(lyr, canv, ext)
  → canv.drawStyledPaths(shapes, arcs, style)  // 先画路径
  → if (style.vertices)
      canv.drawVertices(shapes, arcs, style)    // 再在同一个 canvas 上画节点圆点
```

Mapshaper 将节点绘制集成在主渲染管线中，通过 `style.vertices = true` 控制是否显示节点。悬停高亮的节点通过 `style.vertex_overlay` 传入坐标，在同一个 `drawVertices()` 中特殊绘制更大的圆。

## 修复方案

### 1. 修改 `vertex-edit-control.ts`

**状态变量替换**：
```diff
- private _hoverArcId: number = -1;
- private _hoverVertexIdx: number = -1;
+ private _hoverVertexIds: number[] = [];
```

**查找逻辑**：调用 `mapshaper.internal.findNearestVertices(p, shape, arcs)` 替代手动遍历

**拖拽逻辑**：`mapshaper.internal.snapVerticesToPoint(ids, [x,y], arcs)` + `map.render()`

**移除 overlay canvas 使用**：不再调用 `_drawOverlay()` 和 `map.clearOverlay()`，改为将编辑状态（`hoveredShape`、`hoverVertex`）存储在 map 上，在 `map.render()` 时由 painter 一并绘制

### 2. 修改 `map.ts`

**新增编辑状态存储**：
```typescript
// 编辑模式下需要渲染节点的要素信息
private _editVertexState: {
  shapes: any[];
  arcs: any;
  hoverVertex: [number, number] | null;
} | null = null;
```

**在 `render()` 中集成节点绘制**：
```typescript
// 在绘制完所有数据层之后，绘制编辑节点
if (this._editMode === 'vertex' && this._editVertexState) {
  painter.drawVertexDots(this._canvas, ...);  // 同一个 canvas
}
```

**移除 `_overlayCanvas`**：不再创建和维护第二个 canvas

### 3. 修改 `canvas-painter.ts`

`drawVertexDots` 方法改为接受主 canvas 的 context，或直接使用 `this._ctx`。
