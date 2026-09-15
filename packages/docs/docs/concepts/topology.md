---
id: topology
slug: /concepts/topology
title: 拓扑模型
api: ["ReadonlyArcCollection", "ReadonlyArcVertexData", "ReadonlyCoord2", "ReadonlyDataTable", "ReadonlyFeatureShape", "ReadonlyMapshaperDataset", "ReadonlyMapshaperLayer", "ReadonlyNumericArray", "ReadonlyPathPart", "ReadonlyPathShape", "ReadonlyPointShape", "TopologySource", "ArcCollection", "MapshaperDataset"]
examples: ["rebuild-topology","vertex-editing","simplify"]
stability: stable
verifiedVersion: 0.12.0
---

# 拓扑模型

Emap 使用 mapshaper topology dataset 保存线和面。路径要素的 shape 引用 arc ID，而不是在每个要素中重复保存坐标。相邻多边形的公共边界引用同一条 arc；点要素直接在 shape 中保存坐标，不使用 arc。

## 共享 arc 的作用

共享边界只有一份坐标，因此对这条 arc 的顶点编辑会同时反映到引用它的邻接要素，边界保持一致。简化共享 arc 时也只处理一次，不会让同一边界的两侧产生不同形状。内边界提取、融合、裁剪和拓扑重建都使用这种邻接关系。

```text
MapshaperDataset
├─ arcs: ArcCollection
└─ layers: MapshaperLayer[]
   ├─ geometry_type
   ├─ shapes
   └─ data
```

每个 layer 的 `shapes` 数组索引是 feature ID。path shape 中的有符号 arc ID 表示 arc 的方向和连接顺序；应用通常通过查询、渲染和编辑 API 操作要素，而不直接解析这些 ID。

## 检查拓扑数据

```ts
const dataset = source.getDataset();
const layers = source.getLayers();
const arcs = source.getArcs();

console.log(layers.map((layer) => layer.name));
console.log(arcs?.getPointCount());
console.log(dataset?.layers.length);
```

这些方法返回实时数据的零复制只读 TypeScript 视图。它们用于读取，不是可变入口；通过编辑命令、编辑会话或 `map.ops` 修改，地图才能同步历史、选择、空间索引和渲染。

## 编辑与共享边界

顶点编辑会修改被引用的 arc。拖动整个已选要素时，`splitSharedArcs` 默认为 `true`，Emap 会先拆分选中要素与未选邻要素共享的 arc，使未选邻要素保持原位。设置 `splitSharedArcs: false` 会保留共享关系，边界随选中要素一起移动。

需要从线和面重新计算交点及共享边界时，使用拓扑重建：

```ts
const result = await map.ops.rebuildTopology({
  source: 'main',
  snapInterval: 0.001,
});

if (!result.ok) console.error(result.error);
```

`snapInterval` 使用 dataset 坐标单位。过大的值会把不同顶点合并；应依据数据 CRS 选择该值。

## 渲染简化与数据简化

Emap 的显示 LOD 根据视图缩放选择简化后的 arc 用于绘制，但不会删除 source dataset 中的坐标。`map.ops.simplifyLayer(...)` 才会永久简化数据并影响后续导出。

## API

- [TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)
- [MapshaperDataset](/mapseekai/emap/api/interfaces/emap.MapshaperDataset.html)
- [ArcCollection](/mapseekai/emap/api/interfaces/emap.ArcCollection.html)

## 可运行示例

- [重建拓扑](/mapseekai/emap/examples/rebuild-topology/)
- [顶点编辑](/mapseekai/emap/examples/vertex-editing/)
- [简化](/mapseekai/emap/examples/simplify/)
