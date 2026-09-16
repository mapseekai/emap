---
id: plugins
slug: /guides/plugins
title: Cordis 原生插件与 AI Capability
api: ["AffineDelta", "CacheContract", "CapabilityAuthorization", "CapabilityAuthorizer", "CapabilityCallContext", "CapabilityDefinition", "CapabilityDescriptor", "CapabilityEffect", "CapabilityInvocation", "CapabilityOrigin", "CapabilityRegistry", "CapabilityRegistryContract", "CapabilityRun", "Context", "ControlContext", "ControlsContract", "DocumentContract", "DuckDbProcessing", "DuckDbRuntimeOptions", "DuckDbRuntimeScope", "EditStateContract", "EmapOptions", "ExecutionContract", "FeatureReadContext", "FormatRegistry", "FormatRegistryContract", "HandlerRegistration", "HistoryContract", "InputSchema", "InteractionContract", "LayerContract", "MapLibreService", "MapLibreServiceDefinition", "MutationContract", "PainterFactoryContract", "PolicyContract", "PresetName", "ProjectionContract", "QueryContract", "RenderAction", "RenderContract", "RenderSignalsContract", "RoutingContract", "ScaleContract", "SelectionContract", "ShortcutsContract", "SnapshotContract", "SourceContract", "SourceFactoryContract", "SurfaceContract", "ValidationContract", "ViewContract", "arrowFormatsPlugin", "attributeCapabilityPlugins", "attributesPlugin", "autoCompletePolygonPlugin", "basemapControlPlugin", "boxSelectPlugin", "cachePlugin", "canvasPainterPlugin", "capabilitiesPlugin", "clickSelectPlugin", "controlContextPlugin", "controlPlugin", "controlsPlugin", "describeAgentTools", "documentPlugin", "dragPanPlugin", "drawFeaturePlugin", "duckDbCapabilityPlugins", "duckDbPlugin", "editCapabilityPlugins", "editSessionsPlugin", "editStatePlugin", "editorControlPlugins", "editorPreset", "eventsPlugin", "executionPlugin", "formatPlugin", "formatsPlugin", "headlessPreset", "historyPlugin", "inspectContext", "inspectServices", "interactionPlugin", "invokeAgentTool", "lassoSelectPlugin", "layersPlugin", "mapLibrePlugin", "mapshaperCapabilityPlugins", "mapshaperProcessingPlugin", "measurePlugin", "mutationPlugin", "operationHostPlugin", "partEditPlugin", "policyPlugin", "projectionPlugin", "queryPlugin", "renderPlugin", "renderSignalsPlugin", "reshapeFeaturePlugin", "resolvePlugins", "ringEditPlugin", "routingPlugin", "scalePlugin", "scrollZoomPlugin", "selectionPlugin", "settleContext", "shortcutsPlugin", "snapshotPlugin", "sourcePlugin", "splitFeaturePlugin", "summarizeCapabilityResult", "surfacePlugin", "topologySourceFactoryPlugin", "topologyValidationPlugin", "transformFeaturePlugin", "validateCapabilityInput", "validationPlugin", "validatorPlugin", "vertexEditPlugin", "viewPlugin", "viewerControlPlugins", "viewerPreset", "workspaceCapabilityPlugins"]
examples: ["plugin-runtime", "export-formats", "online-map-services"]
stability: experimental
verifiedVersion: 0.12.0
---

# Cordis 原生插件与 AI Capability

Emap 直接使用固定的上游 `cordis@4.0.0-rc.10`。`map.ctx` 是原生 Cordis `Context`；Cordis 生命周期管理插件依赖、服务、effect 和释放。

```ts
import { Emap } from '@mapseekai/emap';

const map = await Emap.create({
  container: 'map',
  preset: 'editor', // 内置插件集合
  plugins: [myPlugin], // 追加；同名项替换 preset 插件
});
await map.controls.add('navigation'); // 控件是子插件
map.ctx.view.getCRS(); // 从 ctx 读取类型化服务
await map.dispose(); // 释放插件、服务和资源
```

## 核心参数

`Emap.create(options)` 在 preset 和 `plugins` 全部 `ACTIVE` 后返回；也可 `const map = new Emap(options); await map.ready`。`remove()` 发起释放，`await dispose()` 等待完成。插件相关 `EmapOptions`：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `preset` | `'editor' \| 'viewer' \| 'headless' \| 'empty'` | `'editor'` | 内置插件集合。 |
| `plugins` | `readonly Plugin[]` | `[]` | 原生 Cordis 插件；同名项替换 preset 插件。 |
| `excludePlugins` | `readonly string[]` | `[]` | 按插件名排除 preset 能力；`map.ready` 验证依赖图。 |
| `authorizeCapability` | `CapabilityAuthorizer` | Agent 写操作默认拒绝 | Capability 执行的宿主授权策略。 |

## 插件与服务契约

服务通过 TypeScript declaration merging 挂到 Cordis `Context`；插件声明依赖后从 `ctx` 读取类型化服务：

```ts
import type { Plugin } from 'cordis';

declare module 'cordis' {
  interface Context {
    counter: { value: number };
  }
}

const counterPlugin: Plugin.Object = {
  name: 'demo.counter',
  provide: ['counter'],
  apply(ctx) {
    ctx.effect(function* () {
      yield ctx.provide('counter', { value: 1 });
    });
  },
};

const readerPlugin: Plugin.Object = {
  name: 'demo.reader',
  inject: ['counter'],
  apply(ctx) {
    console.log(ctx.counter.value);
  },
};
```

### `Plugin.Object` 形状

`Plugin.Object<T>` 的 `apply(ctx, config)` 是入口；函数插件和 `Service` 子类也可传给 `ctx.plugin()`。对象形式可按 `name` 替换。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `name` | `string` | 未命名 | 插件标识，用于替换、筛选和诊断。 |
| `inject` | `Inject`：`(keyof Context)[]` 或服务配置对象 | 无依赖 | 硬依赖；可用后激活 `apply`。 |
| `provide` | `string \| string[]` | 未声明 | 声明本 Fiber 提供的服务名。 |
| `apply` | `(ctx: Context, config: T) => unknown` | 必填 | 激活入口；`ctx` 是当前 Fiber 子 Context。 |
| `Config` | `StandardSchemaV1<any, T>` | 未声明 | 可选配置 schema。 |

`provide` 描述依赖图；`ctx.provide()` 返回当前 Fiber 管理的释放函数。注册在 `ctx.effect()` 中时，Provider 卸载先撤销服务。

### `ctx.plugin()` 与 `Fiber`

`ctx.plugin()` 同步返回可等待的 `Fiber`（`Fiber & PromiseLike<Fiber>`）；`await ctx.plugin()` 等待激活。保留 Fiber 以管理动态安装。

| API | 参数 | 返回值 | 使用场景 |
| --- | --- | --- | --- |
| `ctx.plugin(plugin, config?)` | `plugin: Plugin`；`config`：插件的 `T` 配置 | `Fiber & PromiseLike<Fiber>` | 挂载 Provider 或 feature。 |
| `fiber.await()` | 无 | `Promise<Fiber>` | 等待 `ACTIVE`。 |
| `fiber.dispose()` | 无 | `Promise<void>` | 卸载 effects、服务和子依赖。 |
| `fiber.restart()` | 无 | `Promise<void>` | 用当前配置重新激活。 |
| `fiber.update(config)` | `config: unknown`；`noSave?: boolean` | `void \| Promise<void>` | 更新配置并重载。 |
| `ctx.fiber` | 当前 `Fiber` | `Fiber` | 当前插件的状态和资源。 |

```ts
const reader = map.ctx.plugin(readerPlugin);
const provider = await map.ctx.plugin(counterPlugin);
await reader.await();
await provider.dispose();
await map.ctx.plugin(counterPlugin);
```

`inject` 服务恢复时，Cordis 重新激活等待的 Fiber。可选集成可用 `ctx.get('mapLibre')` 查询。

### 可注入的 Emap 服务

`src/runtime/services/context.ts` 声明 workspace 服务的 Context augmentation；每项由对应 Provider 提供。使用的服务应放入 `inject`。

| 服务 | 契约 / 主要能力 | 使用场景 |
| --- | --- | --- |
| `formats` | `FormatRegistryContract`：注册、注销和格式查询 | 格式 codec 与导入导出。 |
| `capabilities` | `CapabilityRegistryContract`：注册、发现、执行和记录 | AI / UI 工具。 |
| `document`、`layers`、`source`、`sourceFactory` | 数据集、图层和 source 生命周期 | 工作区数据。 |
| `view`、`projection`、`scale` | 相机、CRS 投影与比例 | 导航和空间工具。 |
| `selection`、`history`、`mutation`、`editState`、`editSession` | 选择、历史和编辑状态 | 编辑与可撤销交互。 |
| `query`、`cache`、`ops`、`attributes` | 查询、缓存、mapshaper 与属性操作 | 要素处理。 |
| `surface`、`render`、`painterFactory`、`signals` | Canvas、绘制和重绘信号 | 可视化与渲染扩展。 |
| `interaction`、`routing`、`shortcuts`、`controls`、`controlContext` | Handler、路由、热键和控件工厂 | 自定义交互与控件。 |
| `mapEvents`、`options`、`policy`、`validation`、`snapshot`、`execution`、`host` | 事件、选项、策略、验证、快照、Worker 与受信任操作桥 | feature 协调和异步作业。 |
| `mapLibre` | `MapLibreServiceManager` | MapLibre 底图和在线图层。 |
| `duckDb`、`duckDbProcessing` | 惰性 DuckDB runtime 与处理入口 | 本地 DuckDB 处理。 |

`viewer` 还提供浏览交互服务；`editor` 还提供编辑交互服务，均可供控件调用或作为 `inject` 前置条件。

#### `formats` 注册契约

`formats` 为地图实例局部注册表。格式 feature 卸载时，`register()` 返回的函数注销 codec，并以 `AbortError` 结束其进行中的导入导出。

`DatasetFormatPlugin` 参数：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `name` | `string` | 必填 | codec 唯一注册名。 |
| `extensions` | `readonly string[]` | 必填 | 不含点的导入扩展名；注册时转小写并保持唯一。 |
| `importBinary` | `(content: Uint8Array, filename: string) => Promise<MapshaperDataset>` | 必填 | 将字节和文件名解码为 dataset。 |
| `exportFormats` | `Readonly<Record<string, (dataset: MapshaperDataset, options?: object) => Promise<ExportedFormatFile[]>>>` | 必填 | 导出格式到处理器的映射。 |
| `mimeTypes` | `Readonly<Record<string, string>>` | 未提供 | 导出格式到 Blob MIME type 的映射。 |

`FormatRegistryContract` 操作：

| API | 参数 | 返回值 | 使用场景 |
| --- | --- | --- | --- |
| `register(plugin)` | `plugin: DatasetFormatPlugin` | `() => void` | 注册 codec，返回注销函数。 |
| `unregister(name)` | `name: string` | `void` | 按注册名注销 codec。 |
| `getFormatForExtension(extension)` | `extension: string` | `DatasetFormatPlugin \| undefined` | 按扩展名查导入器。 |
| `getExportHandler(format)` | `format: string` | 导出处理器或 `undefined` | 查导出处理器。 |
| `getMimeType(format)` | `format: string` | `string \| undefined` | 查导出 MIME type。 |
| `list()` / `dispose()` | 无 | `readonly DatasetFormatPlugin[]` / `void` | 检查或释放注册表。 |

### Feature 组合

Feature 声明已有 Provider 的 `inject`，以 effect 注册贡献，按需以 `provide` 发布 Handler 或服务。格式 feature 使用 `inject: ['formats']`：

```ts
import type { Plugin } from 'cordis';

const formatFeature: Plugin.Object = {
  name: 'feature.format.acme',
  inject: ['formats'],
  apply(ctx) {
    ctx.effect(function* () {
      yield ctx.effect(() => ctx.formats.register(acmeFormat));
    });
  },
};
```

`formatPlugin(format)` 与 `arrowFormatsPlugin` 封装该模式。交互 feature 注册 Handler 并按名称 `provide`；Capability feature 注册领域服务方法，复用几何、CRS 和事务约束。

## 原生 effects 与异步资源

`ctx.effect()` 在 Fiber 激活期执行回调。回调可返回释放函数、其 iterable 或异步形式；Cordis 按反序释放同组资源。

`ctx.effect(execute, label?)` 将资源绑定到插件生命周期，返回释放函数（异步 effect 可等待）；`ctx.provide(name, value)` 提供实例服务，返回异步释放函数。

```ts
const plugin: Plugin.Object = {
  name: 'demo.resource',
  provide: ['resource'],
  apply(ctx) {
    ctx.effect(function* () {
      const resource = acquireResource();
      yield () => resource.close();
      yield ctx.provide('resource', resource);
    });
  },
};
```

组内先撤销服务并等待消费者，再关闭资源。`ctx.on()` 订阅加入当前 Fiber；GIS 事件使用 `ctx.mapEvents`。控件实例是子插件，`map.addControl()`、`map.removeControl()` 和 `map.controls.add()` 返回 Promise。

## 运行时职责

| 层 | 实现与职责 |
| --- | --- |
| Kernel | 上游 Cordis 的 `Context`、Registry、Fiber、Service、events、effects 与 isolation。 |
| Service | `src/runtime/services/`：Context augmentation 和领域契约。 |
| Provider | `src/runtime/providers/`、`src/engine/providers/`、`src/integrations/*/plugin.ts`。 |
| Feature Plugin | `src/runtime/plugins/`：交互、控件、校验与 capability 贡献。 |
| AI Capability | `src/runtime/ai/`：schema、发现、授权、记录和结果摘要。 |

`domain / engine / runtime / integrations / ui / shared` 划分职责区；`src/runtime/context/` 提供原生类型重导出、诊断、状态等待和 effect 所有权辅助。

## Preset 与可选 Provider

`headless` 提供处理服务，`viewer` 加入 Canvas 与浏览交互，`editor` 再加入编辑控件和交互，`empty` 仅安装 `options` Provider。`resolvePlugins()` 筛除 `excludePlugins`、替换同名 preset 项并追加应用插件。

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import { arrowFormatsPlugin } from '@mapseekai/emap/arrow';
import { mapLibrePlugin } from '@mapseekai/emap/maplibre';
import { duckDbPlugin, duckDbCapabilityPlugins } from '@mapseekai/emap/duckdb';

const map = await Emap.create({
  container: 'map',
  plugins: [mapLibrePlugin, arrowFormatsPlugin, duckDbPlugin(), ...duckDbCapabilityPlugins],
});
const source = new TopologySource('upload', { formats: map.formats });
await source.setData({ filename: 'roads.arrow', content: bytes });
await map.addSource('upload', source);
```

格式注册为实例局部。DuckDB runtime 按首次使用初始化；传入 runtime 时以 `owned: true` 交由 Provider 释放。MapLibre Provider 初始化浏览器底图。

## AI 调用

```ts
import { describeAgentTools, invokeAgentTool } from '@mapseekai/emap/ai';

const tools = describeAgentTools(map.capabilities);
const result = await invokeAgentTool(map.capabilities, 'view.getCRS', {});
console.log(result.content);
```

`CapabilityRegistryContract` 的执行入口：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 必填 | 已注册 capability ID。 |
| `input` | `Readonly<Record<string, unknown>>` | `{}` | 依据 `inputSchema` 校验并冻结的输入。 |
| `invocation.origin` | `'api' \| 'ui' \| 'agent'` | `'api'` | 调用来源；Agent 写 effect 由 `authorizeCapability` 决定。 |
| `invocation.signal` | `AbortSignal` | 未提供 | 取消执行；feature 卸载时同样取消。 |

`map.capabilities.execute(id, input?, invocation?)` 返回 `Promise<T>`；`list(category?)`、`get(id)` 和 `search(query)` 用于发现，`history()` 最多返回 200 条记录。Agent 读取能力直接运行；写 effect 由宿主授权策略控制。

## 检查真实运行状态

```ts
import { inspectContext, inspectServices, settleContext } from '@mapseekai/emap/context';

console.table(inspectContext(map.ctx));
console.table(inspectServices(map.ctx));
await settleContext(map.ctx);
```

**Cordis Runtime / GIS Harness** 显示版本、`Context.is(map.ctx)`、Fiber 状态、Provider、effects、可选模块和四种 preset。ESM 保持 `cordis` 为外部依赖；script-tag 导出 `emap.Context`，跨 bundle 使用 `Context.is()`。

## 可运行示例

- [插件运行时](/mapseekai/emap/examples/plugin-runtime/)
- [导出格式](/mapseekai/emap/examples/export-formats/)
- [在线地图服务](/mapseekai/emap/examples/online-map-services/)
