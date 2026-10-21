---
id: architecture
slug: /concepts/architecture
title: 源码组织
api: ["Emap", "Context", "TopologySource"]
examples: ["plugin-install", "getting-started/vector-file"]
stability: experimental
verifiedVersion: 0.14.0
---

# 源码组织

这一页给改仓库的人看。地图对象和源码目录的对应关系见[运行时组成](./runtime.md)。

```ts
const map = await Emap.create({ container: 'map', preset: 'viewer' }); // 创建浏览器地图和浏览能力
await map.dispose(); // 释放插件、服务和资源
```

## 核心结构

`src/` 的六个职责区与根公共 API：

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

| 区域 | 当前职责 | 典型内容 |
| --- | --- | --- |
| `domain/` | 独立的 GIS 状态和可逆修改 | `source/`、`geo/`、`edit/`、`validation/` |
| `engine/` | 地图执行热路径和宿主实现 | `map/`、`core/handlers/`、`rendering/`、`worker/`、内置 workspace provider |
| `runtime/` | Cordis 组合层 | `context/`、`services/`、`providers/`、`plugins/`、`presets/`、`ai/` |
| `integrations/` | 第三方引擎与可选能力边界 | `mapshaper/`、`maplibre/`、`arrow/`、`duckdb/`、`geopackage/` |
| `ui/` | 浏览器控件、CSS、图标和主题 | controls、`assets/`、`theme/` |
| `shared/` | 跨职责区共享的声明 | ambient `.d.ts`、外部库声明、样式类型 |

依赖遵循“领域在内、运行时组合在外”：`runtime` 可组合 engine、domain 和 integration；domain 保持独立的 GIS 模型，Cordis、DOM 和具体 Provider 由外层组合。高频 pointer、hit-test 和 Painter draw 保持 TypeScript 直接调用。

### `Emap.create()`

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `container` | `string \| HTMLElement` | 未设置 | 浏览器 preset 的挂载节点。 |
| `preset` | `'editor' \| 'viewer' \| 'headless' \| 'empty'` | `'editor'` | 内置插件组合。 |
| `plugins` | `readonly Plugin[]` | `[]` | preset 后挂载；同名项替换 preset 插件。 |
| `excludePlugins` | `readonly string[]` | `[]` | 按 `name` 排除 preset 插件。 |
| `authorizeCapability` | `CapabilityAuthorizer` | 未设置 | Capability 调用的宿主授权策略。 |

| preset | 包含内容 | 使用场景 |
| --- | --- | --- |
| `editor` | `viewer` 全部能力、编辑 Handler 与编辑控件。 | 完整交互式编辑器。 |
| `viewer` | `headless` 全部数据与处理能力、Canvas、渲染、交互、事件、快捷键、控件与浏览 Handler。 | 浏览、查询、选择和数据处理页面。 |
| `headless` | Capability/格式 Provider、workspace、mapshaper、编辑、属性、文档、视图、缓存、图层、选择、历史、数据源、策略、执行、查询、校验、快照、投影、修改与比例尺服务。 | 浏览器中的纯数据工作区与批量操作。 |
| `empty` | 空 preset；实例级 `host.options` 始终挂载。 | 应用精确选择 Provider 与 Feature Plugin。 |

## 更多运行时组合

项目固定使用 `cordis@4.0.0-rc.10`。`map.ctx` 是上游 `Context`；`Emap.create()` 挂载 `host.options`、解析 preset 并调用 `ctx.plugin()`，完成后服务可用。

### `Plugin.Object` 与 effect

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `name` | `string` | 未设置 | 插件标识，用于替换和筛选。 |
| `inject` | `Inject`（服务键数组或按键配置对象） | 未设置 | 服务可用后激活 `apply`。 |
| `apply` | `(ctx: Context, config: T) => unknown` | 必填 | 插件入口。 |
| `provide` | `string \| string[]` | 未设置 | 声明提供的服务键。 |

`ctx.effect(execute, label?)` 将资源绑定到当前 Fiber：`execute` 返回清理函数、Promise 或异步迭代器，Fiber 卸载时清理；`label` 默认 `'anonymous'`，用于诊断。

```ts
import { Emap } from '@mapseekai/emap';
import type { Plugin } from 'cordis';

const moveLogger: Plugin.Object = {
  name: 'app.move-logger',
  inject: ['mapEvents'],
  apply(ctx) {
    ctx.effect(() => {
      const log = () => console.log('map moved');
      ctx.mapEvents.on('move', log);
      return () => ctx.mapEvents.off('move', log);
    }, 'app.move-logger');
  },
};

const map = await Emap.create({ container: 'map', preset: 'viewer' });
const fiber = map.ctx.plugin(moveLogger);
await fiber.await();
// 应用继续运行；插件卸载时监听自动释放。
await fiber.dispose();
```

### `ctx.plugin()` 与 Fiber

`ctx.plugin(plugin, config?)`：`plugin` 为函数、构造器或含 `apply` 的对象；`config` 传给 `apply(ctx, config)`。

`fiber.await()` 等待装载或卸载稳定，错误时拒绝；`fiber.dispose()` 卸载插件并等待 effect 清理。

`runtime/context/` 是薄适配：重导出原语、提供只读诊断和生命周期等待，并将浏览器取消接入 effect。

### Service、Provider、Feature 与 Capability

```text
Cordis Context / Fiber
        │
        ├─ Service contracts      runtime/services
        ├─ Providers              runtime/providers + engine/providers + integrations/*/plugin
        ├─ Feature plugins        runtime/plugins
        ├─ Presets                runtime/presets
        └─ AI capabilities        runtime/ai + runtime/plugins/capabilities
```

Service 定义契约；Provider 实现并持有资源；Feature Plugin 组合服务；Capability 暴露已有领域操作。四种 preset 共享 `Emap` 门面；MapLibre、Arrow、DuckDB 为可选集成，Mapshaper 处理数据操作。

## 数据与渲染路径

```text
TopologySource / domain data
        ↓
engine providers (document/source/layer/view/history)
        ↓
engine map + interaction handlers
        ↓
render scheduler
        ↓
CanvasPainter / LumaPainter
```

编辑路径为 `EditCommand → history/transaction → source version → render invalidation`；几何与属性版本独立，异步任务提交前检查版本。

## 测试组织

单元测试与实现同目录、同名，仅增加 `.test`：

```text
foo.ts
foo.test.ts
```

一个实现文件最多一个 colocated unit test。跨模块行为、回归、浏览器、构建和公开类型契约放在根 `test/`：

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

`pnpm run test-layout:check` 检查 `src` 中的测试布局；`pnpm run typecheck:contracts` 验证 `test/types/`。

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

发布门禁覆盖格式、类型、架构、schema、构建、测试、示例、双语文档、浏览器、pack dry-run 和依赖审计。

## 可运行示例

- [安装插件](/mapseekai/emap/examples/plugin-install/)
- [打开矢量文件](/mapseekai/emap/examples/getting-started/vector-file/)
