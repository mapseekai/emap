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

Emap 用 mapshaper topology dataset 保存线和面：path shape 引用 arc ID，共享边界引用同一 arc；点要素直接保存坐标。

```ts
const dataset = source.getDataset(); // 读取 source 的只读实时 dataset 视图
const layers = source.getLayers(); // 读取只读 layer 视图
const arcs = source.getArcs(); // 读取只读共享 arc 视图
console.log(arcs?.getPointCount?.()); // 读取全部 arc 顶点数
```

## 核心结构

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `layers` | `MapshaperLayer[]` | 必填 | 图层；`shapes` 索引对应 `data.records`。 |
| `arcs` | `ArcCollection \| undefined` | `undefined` | 线和面共享的顶点；纯点或属性 dataset 可省略。 |
| `info` | 元数据对象 \| `undefined` | `undefined` | CRS、导入与运行时元数据。 |
| `layer.geometry_type` | `'point' \| 'polyline' \| 'polygon' \| undefined` | `undefined` | shape 几何语义。 |
| `layer.shapes` | `(FeatureShape \| null)[] \| null` | `null` | `null` 保留已删除要素位置；路径为 arc ID，点为坐标。 |
| `layer.data` | `DataTable \| undefined` | `undefined` | 与 `shapes` 对齐的属性记录。 |
| `editVersion` / `attributeVersion` | `number \| undefined` | `undefined` | 几何 / 属性编辑版本。 |

path part 按顺序列出 arc ID；负 ID 的 `~id` 表示反向遍历。

## 更多只读查询

```text
MapshaperDataset
├─ layers: MapshaperLayer[]              // 图层顺序
├─ arcs?: ArcCollection                  // 线、面共享的顶点存储
└─ info?: { crs_string, prj, wkt1, ... } // CRS、导入来源元数据
   └─ layer
      ├─ geometry_type: 'point' | 'polyline' | 'polygon'
      ├─ shapes
      └─ data
```

读取 API 返回零复制的只读实时 source 视图。

| API | 参数 | 返回类型 | 说明 |
| --- | --- | --- | --- |
| `getDataset()` | 无 | `ReadonlyMapshaperDataset \| undefined` | dataset、layer 和元数据。 |
| `getLayers()` | 无 | `readonly ReadonlyMapshaperLayer[]` | layer、shape 和属性。 |
| `getArcs()` | 无 | `ReadonlyArcCollection \| undefined` | path arc 查询。 |
| `arcs?.getPointCount?.()` | 无 | `number \| undefined` | 全部 arc 顶点数。 |
| `size()` / `getArcIter(arcId)` | `arcId: number` | `number` / `ArcIterator` | arc 数 / 一条 arc 的顶点。 |
| `getVertexData?()` / `getVertex2?(vertexId)` | `vertexId: number` | `ReadonlyArcVertexData \| undefined` / `readonly [number, number] \| null` | 批量数据 / 全局顶点。 |
| `getSimpleShapeBbox?(shapeIds, bbox)` | `shapeIds: number[]`、`bbox: number[]` | `void` | 写入 shape 范围。 |
| `getRecordAt?(id)` / `getRecords?()` | `id: number` | 单条 / 全部只读属性记录 | 属性记录。 |
| `getFields?()` / `size?()` | 无 | `readonly string[] \| undefined` / `number \| undefined` | 字段名 / 属性记录数。 |

| 类型 | 类型结构 | 说明 |
| --- | --- | --- |
| `ReadonlyMapshaperLayer` | `readonly name/id/geometry_type`、`readonly shapes`、`ReadonlyDataTable` | 图层要素、类型和属性。 |
| `ReadonlyFeatureShape` | `ReadonlyPathShape \| ReadonlyPointShape \| ReadonlyCoord2` | path、multipoint 或单坐标要素。 |
| `ReadonlyPathShape` / `ReadonlyPathPart` | 只读 part / 有符号 arc ID 数组 | ring 或 polyline arc。 |
| `ReadonlyPointShape` / `ReadonlyCoord2` | 只读坐标数组 / `readonly [number, number]` | 点或 multipoint 坐标。 |
| `ReadonlyArcVertexData` | `xx`、`yy`、`nn`、`ii`、`bb`、`zz` | 批量顶点数据。 |
| `ReadonlyDataTable` | `getRecordAt?`、`getRecords?`、`getFields?`、`size?()` | 字段和属性记录。 |

## 编辑与共享边界

顶点编辑修改被引用的 arc。`splitSharedArcs: true` 拆分选中与未选邻要素共享的 arc；`false` 保留共享。`Emap.editSession.*` 用于交互编辑，`Emap.ops.*` 用于可撤销 dataset 操作。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `splitSharedArcs` | `boolean` | `true` | 拆分选中与未选邻要素的共享 arc。 |

```ts
const result = await map.ops.rebuildTopology({ // 重算交点和共享边界
  source: 'main', // 指定待重建的 source
  snapInterval: 0.001, // 以 source CRS 单位设置顶点吸附距离
});

if (!result.ok) console.error(result.error); // 处理操作失败
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `source` | `string` | 必填 | 要重建的 source ID。 |
| `snapInterval` | `number \| undefined` | 自动检测 | source CRS 单位中的顶点吸附距离。 |
| `noSnap` | `boolean \| undefined` | `undefined` | 跳过吸附预处理。 |
| `rebuildTopology` | `boolean \| undefined` | `undefined` | 无切点变化时也重建共享 arc。 |

## 渲染与数据简化

显示 LOD 按视图比例选择简化 arc，保留完整坐标；数据简化永久改变后续导出几何。

## API

- [TopologySource](/mapseekai/emap/api/classes/emap.TopologySource.html)
- [MapshaperDataset](/mapseekai/emap/api/interfaces/emap.MapshaperDataset.html)
- [ArcCollection](/mapseekai/emap/api/interfaces/emap.ArcCollection.html)

## 可运行示例

- [重建拓扑](/mapseekai/emap/examples/rebuild-topology/)
- [顶点编辑](/mapseekai/emap/examples/vertex-editing/)
- [简化](/mapseekai/emap/examples/simplify/)
