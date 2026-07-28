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

emap 保留 mapshaper 拓扑：共享弧保持共享，编辑经过命令系统，渲染 LOD 从数据源重建。

## 行为说明

`getDataset()` 返回实时 dataset 供只读检查。修改数据请经过 `Emap.ops`、编辑会话或自定义 `EditCommand`，这样缓存和历史才会一致。

## API

- [src.TopologySource](/emap/api/classes/index.TopologySource.html)
- [src.ITopologySource](/emap/api/interfaces/index.ITopologySource.html)

## 可运行示例

- [rebuild-topology](/emap/examples/rebuild-topology/)
- [innerlines](/emap/examples/innerlines/)

## 最小片段

```ts
const dataset = source.getDataset()
const layers = source.getLayers()
await map.ops.rebuildTopology({ source: "main" })
```
