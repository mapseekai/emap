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

本分支使用官方上游 `cordis@4.0.0-rc.10`。这是固定版本的候选发布版，不是稳定版承诺。自研插件运行时、服务键和 effect scope 已删除，项目不维护第二套依赖图或插件状态机。地图公开 `map.ctx`，它就是原生 Cordis `Context`。

## 创建与释放

Cordis 原生插件加载是异步的。地图、控件和需要重新装配的操作都要等待生命周期完成：

```ts
import { Emap } from '@mapseekai/emap';

const map = await Emap.create({ container: 'map', preset: 'editor' });
await map.controls.add('navigation');
console.log(map.ctx.view.getCRS());
await map.dispose();
```

也可以 `const map = new Emap(options); await map.ready;`。构造器返回不表示服务已经激活。`remove()` 请求关闭，`dispose()` 等待 Cordis 原生卸载结束；复用容器前应等待后者。Cordis 会把清理异常记入原生 logger，不再沿用旧内核聚合抛出的错误语义。

## 插件与服务契约

服务使用标准 TypeScript declaration merging，不使用自定义 Symbol token：

```ts
import type { Plugin } from 'cordis';

declare module 'cordis' {
  interface Context {
    counter: { value: number };
  }
}

const counterPlugin: Plugin.Object = {
  name: 'demo.counter',
  apply(ctx) {
    ctx.provide('counter', { value: 1 });
  },
};

const readerPlugin: Plugin.Object = {
  name: 'demo.reader',
  inject: ['counter'],
  apply(ctx) {
    console.log(ctx.counter.value);
  },
};

const reader = map.ctx.plugin(readerPlugin);
const provider = await map.ctx.plugin(counterPlugin);
await reader.await();
await provider.dispose(); // reader 由 Cordis 自动回到 PENDING
await map.ctx.plugin(counterPlugin); // 依赖恢复后自动重新激活
```

`ctx.plugin()` 也直接接受原生函数插件和 `Service` 子类，无需 emap 包装。硬依赖使用 `inject` 和类型化属性访问；可选服务用 `ctx.get('mapLibre')` 查询。可选查询并不等于硬依赖，不要把查询结果保存为长期有效的实例。

运行时开关使用原生 `Fiber.dispose()`、重新 `ctx.plugin()`、`Fiber.restart()` 或 `Fiber.update(config)`。项目不再提供按字符串 ID 的 disable/enable 模拟。插件名称用于 preset 覆盖配置；Cordis 本身以插件回调和 Fiber 标识实例，不额外禁止原生多实例语义。

## 原生 effects 与异步资源

需要确保消费者先结束、资源后关闭时，用 Cordis 原生 generator effect 分组：

```ts
const plugin: Plugin.Object = {
  name: 'demo.resource',
  apply(ctx) {
    ctx.effect(function* () {
      const resource = acquireResource();
      yield () => resource.close();
      yield ctx.provide('resource', resource);
    });
  },
};
```

组内按反序释放：先撤销服务并等待依赖它的插件，再关闭资源。事件可直接使用 `ctx.on()` 和 `ctx.emit()`，监听会随 Fiber 撤销。已有 GIS 对象的 EventDispatcher 作为 `ctx.mapEvents` 保留，负责地图业务事件，不承担插件调度。

异步 GIS 任务使用由 `ctx.effect()` 管理的 AbortController 防止旧结果提交。取消不能强制打断所有同步 GIS 算法。控件实例现在是原生子插件，`map.addControl()`、`map.removeControl()` 和 `map.controls.add()` 返回 Promise。

## 运行时角色与六区源码结构

| 层 | 实现与职责 |
| --- | --- |
| Kernel | 上游 Cordis：Context、Registry、Fiber、Service、events、effects、isolation。 |
| Service | `src/runtime/services/context.ts`、各服务契约及 Cordis Context augmentation；约定能力与类型。 |
| Provider | `src/runtime/providers/`、`src/engine/providers/` 与 `src/integrations/*/plugin.ts`：按所有权分别承载运行时、内置引擎和可选集成实现。 |
| Feature Plugin | `src/runtime/plugins/`：交互、控件工厂、校验器、可发现能力贡献。 |
| AI Capability | `src/runtime/ai/`：GIS 工具 schema、发现、授权、执行记录与结果摘要。它是领域工具注册表，不是第二个插件内核。 |

源码顶层按 `domain / engine / runtime / integrations / ui / shared` 六个职责区组织；概念角色不再等于一级目录。Domain 数据结构、渲染算法和工具算法仍复用原实现；指针移动、命中测试和绘制循环不经过 JSON 或 Agent 调用。`src/runtime/context/` 仅重导出原生类型、读取原生诊断信息、等待原生状态过渡，以及将 AbortController 注册成 effect，不实现依赖调度。

## Preset 与可选 Provider

`editor` 提供编辑交互；`viewer` 保留数据处理但不装模态编辑 Handler；`headless` 不创建 DOM/Canvas；`empty` 仅装实例选项。替换 preset 内置项使用同名原生插件，`excludePlugins` 填插件名称。必要服务缺失会使 `map.ready` 拒绝。

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

格式注册依旧是实例局部的，import 不产生注册副作用。DuckDB 默认惰性初始化，外部传入 runtime 默认借用；`owned: true` 才随 Provider 关闭。MapLibre 保持可选 peer，需要配置服务后才初始化底图。

## AI 调用

```ts
import { describeAgentTools, invokeAgentTool } from '@mapseekai/emap/ai';
const tools = describeAgentTools(map.capabilities);
const result = await invokeAgentTool(map.capabilities, 'view.getCRS', {});
console.log(result.content); // 可交给模型的摘要
// result.value 保留给本地 UI / 工作流；不会自动向模型发送几何数据。
```

Agent 默认仅允许只读能力。修改数据、选择、视图或外部状态的操作需要宿主 `authorizeCapability` 授权；授权不能由模型参数自行声明。GIS 几何、CRS、版本与事务约束仍由原领域服务验证。执行记录有界且不等于持久化事件溯源。

## 检查真实运行状态

```ts
import { inspectContext, inspectServices, settleContext } from '@mapseekai/emap/context';
console.table(inspectContext(map.ctx));
console.table(inspectServices(map.ctx));
await settleContext(map.ctx); // 仅等待 Cordis 过渡，不自行激活插件
```

示例目录中的 **Cordis Runtime / GIS Harness** 显示固定 Cordis 版本、`Context.is(map.ctx)`、原生 Fiber 状态、inject 对应的 Provider、effects、可选模块的安装/卸载及四种 preset。页面没有旧的 PluginRuntime。

ESM 发布入口把 `cordis` 作为外部依赖，保证应用与 emap 共享同一库实例；script-tag 版本包含 Cordis 并从 `emap.Context` 暴露。跨不同 bundle 判断 Context 使用原生 `Context.is()`，不依赖类对象引用相同。
