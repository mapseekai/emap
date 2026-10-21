---
id: runtime
slug: /concepts/runtime
title: 运行时组成
api: ["Emap", "Context", "TopologySource"]
examples: ["plugin-install", "web-worker"]
stability: stable
verifiedVersion: 0.14.0
---

# 运行时组成

页面上的地图对象和源码目录是一一对应的。使用者按地图任务阅读文档；需要改引擎时，再按这张表找到代码。

| 你在地图上看到的 | 代码放在 |
| --- | --- |
| 要素、拓扑、坐标和可撤销修改 | `src/domain` |
| 地图、相机、图层绘制、拾取和编辑手势 | `src/engine` |
| 插件装配、预设、服务和 Capability | `src/runtime` |
| DuckDB、GeoTIFF、GeoPackage、MapLibre、格式解码 | `src/integrations` |
| 缩放条、图层控件和编辑工具条 | `src/ui` |

`Emap.create()` 按预设把这些部分装到一起：

| 预设 | 适合 |
| --- | --- |
| `editor` | 查看、选择和编辑 |
| `viewer` | 查看、查询和选择 |
| `headless` | 没有画布的数据处理 |
| `empty` | 自己挑选插件 |

`map.ctx` 是 Cordis `Context`。安装插件、查询 Capability 的可运行页面在[安装插件](/mapseekai/emap/examples/plugin-install/)和[调用 Capability](/mapseekai/emap/examples/plugin-capability/)。目录、测试和发布检查见[源码组织](./architecture.md)。

## 可运行示例

- [安装插件](/mapseekai/emap/examples/plugin-install/)
- [Web Worker](/mapseekai/emap/examples/web-worker/)
