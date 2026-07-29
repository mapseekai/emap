---
id: topology
slug: /concepts/topology
title: 拓扑模型
api: []
examples: []
stability: stable
verifiedVersion: 0.5.0
---

# 拓扑模型

Emap 使用 mapshaper dataset 保存几何。线和面的坐标不会在每个要素中重复存储，
而是由 shape 引用共享 arc。相邻多边形共享边界时，对应的是同一组 arc 坐标。

## 为什么保留拓扑

- 编辑共享边界时，邻接要素可以保持连接。
- 简化只需要处理一次共享 arc，避免两侧产生不同裂缝。
- 内边界、融合、裁剪和拓扑修复可以直接使用邻接关系。
- 多个图层可以复用同一 ArcCollection。

点图层不使用 arc；点坐标直接保存在 shape 中。

## Dataset、layer、shape 和 arc

```text
MapshaperDataset
├─ arcs: ArcCollection
└─ layers: MapshaperLayer[]
   ├─ geometry_type
   ├─ shapes
   └─ data
```

- dataset 保存一组 layers 和可选的共享 arcs。
- layer 保存几何类型、shape 数组和属性表。
- shape 的数组索引是 feature ID。
- path shape 通过有符号 arc ID 描述方向和连接顺序。

应用通常不需要直接解释 signed arc ID；查询、渲染和编辑 API 已处理方向。

## 只读检查

```ts
const dataset = source.getDataset();
const layers = source.getLayers();

if (dataset) {
  console.log(dataset.arcs?.getPointCount());
}

console.log(layers.map((layer) => layer.name));
```

`getDataset()` 返回当前实时对象，不是副本。可用它做诊断和只读统计，但不能安全地
直接改写 shapes、records 或 arcs。

## 通过正确入口修改

| 修改类型 | 使用入口 |
|---|---|
| 属性值和字段 | `map.attributes` 或 attribute operation |
| 单要素移动、旋转、顶点变化 | 编辑命令或 Handler |
| 简化、融合、裁剪、缓冲区 | `map.ops.*` |
| 整个数据集重投影 | `map.reproject(...)` 或 project operation |
| 替换应用拥有的 dataset | `TopologySource.setDataset(...)`，并让地图接收 data 事件 |

直接变更 dataset 会绕过历史、空间索引、DisplayArcs、选择维护和渲染失效。

## 重建拓扑

导入或编辑后需要重新切分交点和共享边界时：

```ts
const result = await map.ops.rebuildTopology({
  source: 'main',
  snapInterval: 0.001,
});

if (!result.ok) {
  console.error(result.error);
}
```

`snapInterval` 使用 dataset 坐标单位。过大的吸附距离会合并原本不同的顶点；
未知 CRS 下不要猜测单位。

## 简化与显示 LOD

`DisplayArcs` 为渲染维护缩放相关的简化结果。显示简化不是直接删除 source dataset
中的坐标。数据操作需要永久简化输出时，应调用 `map.ops.simplifyLayer(...)`。

直接设置 ArcCollection retained interval 会和 Emap 的 LOD 管理冲突。

## 操作效果与选择

数据操作会分类为：

- `shape-count`
- `topology-only`
- `attribute-only`
- `crs-only`

Emap 根据效果决定是否能保留选择。shape-count 操作可能改变 feature ID，因此旧引用
不能继续使用。通过 `map.ops` 执行操作，选择和空间索引才会按效果正确更新。

## 常见问题

### 相邻面编辑后出现裂缝

确认编辑经过共享 arc 命令，并检查数据是否在导入时建立拓扑。必要时使用
`rebuildTopology`，但先选择符合 CRS 单位的吸附距离。

### 修改 records 后属性面板没有同步

使用 `map.attributes` 或 attribute operation；直接修改 data table 不会建立历史项。

### 简化后导出内容意外减少

渲染 LOD 与永久简化是不同概念。`TopologySource.export()` 会导出完整 dataset；
只有显式 simplify operation 才应永久改变几何。

## API

- [TopologySource](/emap/api/classes/index.TopologySource.html)
- [ITopologySource](/emap/api/interfaces/index.ITopologySource.html)
- [MapshaperDataset](/emap/api/interfaces/index.MapshaperDataset.html)
- [ArcCollection](/emap/api/interfaces/index.ArcCollection.html)

## 可运行示例

- [重建拓扑](/emap/examples/rebuild-topology/)
- [内部边界](/emap/examples/innerlines/)
- [顶点编辑](/emap/examples/vertex-editing/)
- [简化](/emap/examples/simplify/)
