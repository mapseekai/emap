---
id: intro
slug: /
title: Emap 简介
api: ["Emap","LayerSpecification","TopologySource"]
examples: ["china-editing","export-formats","getting-started/geojson-viewer"]
stability: stable
verifiedVersion: 0.9.0
---

# Emap

Emap 是面向浏览器的 TypeScript 地图渲染、编辑和空间数据处理库。它使用 Canvas 2D 渲染，并以 mapshaper topology dataset 管理数据源。应用可以在前端加载数据、显示图层、编辑要素、运行分析操作并导出结果。

Emap 适合需要把可完整载入浏览器的数据查看、交互和处理整合到自定义界面的应用，例如 GIS 数据查看器、业务编辑器和数据处理工具。应用负责自己的工具栏、属性面板和状态界面；Emap 提供地图、数据和交互能力。

## 支持的能力

### 数据输入与输出

核心包可导入和导出 GeoJSON、TopoJSON、Shapefile ZIP 和 mapshaper snapshot，并可导入 KML。`TopologySource` 从 URL、文件字节或应用内存加载数据，并将结果导出为 `Blob`。

导入 `@mapseekai/emap/arrow` 后，应用还可读写 GeoArrow 和 GeoParquet。FlatGeobuf 由应用安装 `flatgeobuf` 并注册本地格式插件后读写。

### 图层、交互和编辑

`Emap` 管理 Canvas、相机、数据源、渲染图层、事件和历史记录。使用 `LayerSpecification` 添加 `fill`、`line` 和 `circle` 图层，分别绘制面、线和点数据。

库提供平移、缩放、点击、拉框和套索选择，以及绘制、顶点、拆分、整形、环和部件编辑。编辑命令和数据操作记录在历史中，应用可提供撤销和重做界面。

### 分析与数据处理

`map.ops` 提供简化、缓冲区、裁剪、擦除、融合、联合、投影、拓扑修复、属性处理和图层管理等操作。导入 `@mapseekai/emap/duckdb` 并安装 DuckDB-Wasm 后，应用还可使用 DuckDB 的查询和空间处理能力。

## 从这里开始

1. 阅读[安装](./getting-started/installation.md)，安装包、导入样式并配置可选模块。
2. 阅读[核心概念](./concepts/overview.md)，了解地图、数据源和渲染图层的关系。
3. 阅读[数据格式](./data/formats.md)和[样式图层](./guides/styling.md)，加载数据并定义显示方式。
4. 阅读[选择](./guides/selection.md)、[编辑](./guides/editing.md)和[数据操作](./data/operations.md)，为应用加入交互与处理流程。
5. 打开[可运行示例](/mapseekai/emap/examples/)，查看完整实现。