---
id: overview
slug: /concepts/overview
title: 核心概念
api: []
examples: []
stability: stable
verifiedVersion: 0.5.0
---

# 核心概念

emap 的运行模型围绕地图、数据源和图层展开。

## 地图

`Emap` 绑定一个浏览器容器，负责视口、控件、交互处理和渲染调度。

## 数据源

`TopologySource` 保存 mapshaper 数据集，并负责把 GeoJSON、TopoJSON、Shapefile ZIP、GeoParquet 或 GeoArrow 输入转换为可渲染的拓扑数据。

## 图层

图层来自数据源中的 mapshaper layer。地图通过 `map.addSource(...)` 注册数据源后，会把其中的图层纳入渲染、查询和编辑流程。

## 视图范围

加载数据后通常调用 `map.setExtent(source.getExtent())`，让相机移动到数据覆盖范围。
