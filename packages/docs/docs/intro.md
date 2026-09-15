---
id: intro
slug: /
title: Emap 简介
api: ["Emap", "LayerSpecification", "TopologySource"]
examples: ["china-editing","export-formats","getting-started/geojson-viewer"]
stability: stable
verifiedVersion: unreleased
---

# Emap

`@mapseekai/emap` 是浏览器端的 TypeScript 地图引擎：加载矢量数据、用 Canvas 2D 渲染图层、编辑要素、运行空间分析，不依赖后端地图服务。数据保存在 mapshaper topology dataset 中，每次修改都是一条可撤销的命令。

它适合把 GIS 查看、编辑和处理整合进自己界面的应用：数据查看器、业务编辑器、批处理工具。应用负责自己的工具栏、属性面板和状态界面；Emap 提供地图、数据、交互和插件运行时。

## 能力一览

**数据格式**：核心包读写 GeoJSON、TopoJSON、Shapefile ZIP 和 mapshaper snapshot，可导入 KML。`/arrow` 入口增加 GeoArrow 和 GeoParquet；`/geopackage` 入口把 GeoPackage 矢量表直接解码为 typed-buffer dataset，支持主线程和 Worker 两种导入方式。FlatGeobuf 由应用注册格式插件后读写。

**图层与样式**：`fill`、`line`、`circle` 三种渲染图层，带视口裁剪、随缩放调整的显示弧简化和属性驱动的填充分桶；`fill-color` 等属性接受受限表达式，不使用 `eval`。

**编辑与历史**：绘制、顶点编辑、拆分、合并、整形、环/洞/多部件编辑、自动补面、平移/旋转/缩放选中要素。编辑命令和数据操作都进入历史，支持撤销、重做、事务和选择恢复。

**数据操作**：`map.ops` 提供 45 个 mapshaper 操作：裁剪、擦除、融合、缓冲、简化、投影、属性连接、分类等。操作可路由到 Web Worker，提交前校验数据版本，过期结果不会覆盖新状态。`/duckdb` 入口在此之上提供 DuckDB-Wasm SQL 查询和空间分析。

**运行时与扩展**：`Emap` 是公共门面，`map.ctx` 是原生 Cordis `Context`。`editor`、`viewer`、`headless`、`empty` 四个 preset 只是插件组合，不是另一套地图类；`/ai` 入口把既有操作暴露为 UI、工作流和 Agent 可调用的 capability。`/maplibre` 入口接入 MapLibre 在线底图和叠加层。

## 从这里开始

1. [安装](./getting-started/installation.md)并配置需要的可选入口。
2. 跟着[第一张地图](./getting-started/quick-start.md)做出一个可运行的页面。
3. 读[核心概念](./concepts/overview.md)，弄清 source、source layer 和渲染图层的关系。
4. 按任务查阅[样式](./guides/styling.md)、[选择](./guides/selection.md)、[编辑](./guides/editing.md)和[数据操作](./data/operations.md)。
5. 打开[可运行示例](/mapseekai/emap/examples/)查看完整实现；运行时分层和源码组织见[技术架构](./concepts/architecture.md)。

给 AI 编程助手使用的站点索引在 [llms.txt](pathname:///llms.txt)。
