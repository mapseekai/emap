---
id: intro
slug: /
title: emap 简介
api: []
examples: []
stability: stable
verifiedVersion: 0.5.0
---

# emap

emap 是一个运行在浏览器中的 TypeScript 地图渲染与编辑引擎。它以 mapshaper
数据结构保存拓扑，使用 HTML5 Canvas 2D 渲染地图，并把数据加载、图层样式、交互、
编辑历史和空间数据处理组织在同一个前端 API 中。

emap 不依赖后端地图服务。数据可以来自 URL、用户上传的文件或内存中的二进制内容，
导入、查看、编辑和导出都可以在浏览器里完成。

## 适合哪些场景

- GIS 数据查看器：显示 GeoJSON、TopoJSON、Shapefile ZIP 等本地或远程数据。
- 浏览器编辑器：选择要素、修改属性、移动或缩放要素、编辑顶点，并支持撤销与重做。
- 数据处理工具：在前端执行简化、缓冲区、裁剪、融合、投影和拓扑修复等操作。
- 业务地图组件：只使用引擎和交互处理器，自行构建工具栏、属性面板和状态区域。
- 原型与内部工具：在不部署后端 GIS 服务的情况下快速验证处理流程。

如果应用主要需要瓦片底图、三维场景或服务端海量数据查询，emap 不是这些能力的替代品。
它更关注可完整加载到浏览器中的拓扑数据及其编辑流程。

## 核心组成

| 组成 | 作用 |
|---|---|
| `Emap` | 管理 Canvas、相机、数据源、渲染图层、交互、控件和历史记录 |
| `TopologySource` | 导入文件或字节数据，并保存 mapshaper topology dataset |
| `LayerSpecification` | 选择 source layer，声明 `fill`、`line` 或 `circle` 渲染方式 |
| `map.ops` | 执行带类型、错误结果和历史记录的数据操作 |
| Handler | 实现平移、缩放、选择、绘制、顶点编辑和要素变换 |
| Control | 为内置能力提供可选的 DOM 界面 |

一个典型流程如下：

1. 创建有明确尺寸的地图容器。
2. 创建 `Emap`。
3. 用 `TopologySource` 加载数据。
4. 注册数据源，并根据需要添加渲染图层。
5. 使用数据范围设置初始相机。
6. 监听事件，将选择、属性、状态和错误同步到应用界面。
7. 通过编辑命令或 `map.ops` 修改数据，避免直接改写 dataset。

## 主要能力

### 数据输入与输出

- 核心包支持 GeoJSON、TopoJSON、Shapefile ZIP 和 mapshaper snapshot。
- `@zwishing/emap/formats` 提供 GeoParquet 与 GeoArrow 支持。
- `@zwishing/emap/duckdb` 提供可选的 DuckDB-Wasm 查询和空间处理能力。

### 渲染与相机

- 使用 `fill`、`line` 和 `circle` 图层渲染面、线和点。
- 支持 `jumpTo`、`easeTo`、`flyTo`、`fitBounds`、`panTo` 和 `zoomTo`。
- 共享弧和简化层级由数据源统一管理，适合拓扑数据的重复绘制。

### 交互与编辑

- 内置点击、拉框和套索选择。
- 支持要素平移、旋转、缩放、绘制和顶点编辑。
- 编辑命令进入同一历史记录，可通过事务合并成一次用户操作。
- 公开要素点击、悬停、相机、历史、验证和 Worker 状态事件。

## 包入口与静态资源

```ts
import { Emap, TopologySource } from '@zwishing/emap';
import '@zwishing/emap/style.css';

// 按需使用，不会进入只使用核心包的应用代码
import '@zwishing/emap/formats';
const duckdb = await import('@zwishing/emap/duckdb');
```

启用 Worker 时，宿主应用还需要提供 `emap-worker.js` 和
`mapshaper-vendor.js`。具体部署方式见 [Web Worker 指南](./guides/worker.md)。

## 建议阅读顺序

1. [安装](./getting-started/installation.md)：完成第一张可运行地图。
2. [核心概念](./concepts/overview.md)：理解地图、数据源和图层的关系。
3. [样式图层](./guides/styling.md)：控制点、线、面的显示方式。
4. [选择](./guides/selection.md) 与 [编辑](./guides/editing.md)：加入交互能力。
5. [数据操作](./data/operations.md)：执行拓扑和属性处理。
6. [错误处理](./recipes/error-handling.md)：把失败安全地呈现给用户。

## 项目状态

当前文档对应 `@zwishing/emap` 0.5.0。项目仍在快速演进，适合原型、演示、
研究工具和受控的内部应用；升级版本时应同时查看迁移说明和 API 参考。
