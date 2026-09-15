---
id: architecture
slug: /concepts/architecture
title: 当前技术架构与源码组织
api: ["Emap", "Context", "TopologySource"]
examples: ["plugin-runtime", "getting-started/geojson-viewer"]
stability: experimental
verifiedVersion: unreleased
---

# 当前技术架构与源码组织

Emap 当前采用 **Cordis 原生插件运行时 + GIS 领域内核 + Canvas 渲染 + 可选集成** 的组织方式。公共 API 仍由 `Emap` 门面提供，但运行时能力由 Cordis `Context`、Service、Provider 和 Feature Plugin 组合。

源码只保留六个一级职责区，避免 `map`、`core`、`services`、`plugins`、`providers` 等概念平铺在同一级后难以判断主次：

```text
src/
├── domain/          # GIS 领域模型与可逆数据修改
├── engine/          # 地图执行、交互、渲染和内置 Provider
├── runtime/         # Cordis、服务契约、插件、Preset、AI Capability
├── integrations/    # Arrow / DuckDB / MapLibre / Mapshaper / GeoPackage
├── ui/              # 控件、图标与主题
├── shared/          # 跨层共享的声明和类型边界
└── index.ts         # 根公共 API
```

## 六个源码区
| 区域 | 当前职责 | 典型内容 |
| --- | --- | --- |
| `domain/` | 与 UI/插件框架无关的 GIS 领域状态和可逆修改 | `source/`、`geo/`、`edit/`、`validation/` |
| `engine/` | 地图执行热路径和宿主实现 | `map/`、`core/handlers/`、`rendering/`、`worker/`、内置 workspace provider |
| `runtime/` | Cordis 组合层 | `context/`、`services/`、`providers/`、`plugins/`、`presets/`、`ai/` |
| `integrations/` | 第三方引擎与可选能力边界 | `mapshaper/`、`maplibre/`、`arrow/`、`duckdb/`、`geopackage/` |
| `ui/` | 浏览器控件、CSS、图标和主题 | controls、`assets/`、`theme/` |
| `shared/` | 没有单一业务所有者的共享声明 | ambient `.d.ts`、外部库声明、样式类型 |

依赖方向以“领域在内、运行时组合在外”为原则。`runtime` 可以组合 engine/domain/integration 能力；domain 不应依赖 Cordis、DOM 或具体 Provider。高频 pointer、hit-test 和 Canvas draw 路径保持普通 TypeScript 直接调用，不经过 Capability JSON 层。

## 运行时：官方 Cordis

项目固定使用官方 `cordis@4.0.0-rc.10`。`map.ctx` 是上游 `Context`，插件使用原生 `name / inject / apply / provide / effect`，生命周期由原生 `Fiber` 管理。

```ts
const map = await Emap.create({ container: 'map', preset: 'editor' });
const fiber = map.ctx.plugin(myPlugin);
await fiber.await();
await fiber.dispose();
```

项目没有 `PluginRuntime`、`ServiceRegistry`、`EffectScope`、`map.runtime` 或 `map.services` 兼容层。`runtime/context/` 只提供上游 re-export、只读诊断和浏览器取消适配。

## Service、Provider、Feature 与 Capability
概念上仍然区分五类运行时角色，但它们现在都落在清晰的源码区中：

```text
Cordis Context / Fiber
        │
        ├─ Service contracts      runtime/services
        ├─ Providers              runtime/providers + engine/providers + integrations/*/plugin
        ├─ Feature plugins        runtime/plugins
        ├─ Presets                runtime/presets
        └─ AI capabilities        runtime/ai + runtime/plugins/capabilities
```

Service 只描述能力契约；Provider 持有状态或资源并实现 Service；Feature Plugin 组合服务实现交互/控件/校验；Capability 把已有领域操作变成 UI、Workflow、Agent 都可发现的机器调用入口。Capability 不复制 GIS 算法。

`editor / viewer / headless / empty` Preset 只是插件组合，不是第二套 Map 类。MapLibre、Arrow、DuckDB 保持显式可选集成；Mapshaper 是 GIS processing integration，不是 Cordis 内核的一部分。

## 典型数据与渲染路径

```text
TopologySource / domain data
        ↓
engine providers (document/source/layer/view/history)
        ↓
engine map + interaction handlers
        ↓
render scheduler
        ↓
Canvas painter
```

编辑路径保持 `EditCommand → history/transaction → source version → render invalidation`。几何版本与属性版本独立，异步 Worker/分析任务提交前检查版本，避免旧结果覆盖新状态。

## 测试组织规则
单元测试必须和实现文件同目录、同名，只增加 `.test` 后缀：

```text
foo.ts
foo.test.ts
```

一个实现文件最多只有一个 colocated unit test 文件。跨模块行为、回归、浏览器、构建和公开类型契约全部放到根 `test/`：

```text
test/
├── integration/   # 多模块协作与回归
├── browser/       # Playwright / 真实浏览器
├── build/         # bundle / package exports
├── types/         # *.test-d.ts 公共类型契约
├── docs/          # 文档元数据与构建契约
├── examples/      # 示例行为
├── security/      # 安全边界
└── utils/         # 测试支持代码
```

`pnpm run test-layout:check` 自动拒绝 `src` 中找不到同名实现的测试、多个测试文件对应同一实现、`*.integration.test.ts` 或类型契约重新混回 `src`。`pnpm run typecheck:contracts` 单独验证 `test/types/`。

## 发布与验证

```bash
pnpm run typecheck
pnpm run typecheck:contracts
pnpm run typecheck:examples
pnpm run test-layout:check
pnpm run architecture:check
pnpm run test:run
pnpm run test:duckdb
pnpm run release:verify
```

完整发布门禁包含格式、类型、架构、Capability schema、production build、bundle、单元/集成测试、DuckDB-Wasm、示例、双语文档、三浏览器、pack dry-run 和生产依赖审计。

架构决策见 [ADR 0009：原生 Cordis](https://github.com/mapseekai/emap/blob/master/docs/decisions/0009-native-cordis.md) 与 ADR 0010（源码与测试布局）。
