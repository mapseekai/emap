---
id: plugins
slug: /guides/plugins
title: 插件架构与 AI Capability
api: ["AttributeService", "CapabilityAuthorization", "CapabilityAuthorizer", "CapabilityCallContext", "CapabilityDefinition", "CapabilityDescriptor", "CapabilityEffect", "CapabilityInvocation", "CapabilityOrigin", "CapabilityRegistry", "CapabilityRegistryContract", "CapabilityRun", "CapabilityService", "Cleanup", "ControlContext", "ControlsContract", "ControlsService", "DuckDbProcessing", "DuckDbProcessingService", "DuckDbRuntimeOptions", "DuckDbRuntimeScope", "DuckDbService", "EditSessionService", "EditStateContract", "EditStateService", "EffectScope", "EmapOptions", "EventService", "ExecutionContract", "ExecutionService", "FeatureReadContext", "FormatRegistry", "FormatRegistryContract", "FormatService", "HandlerRegistration", "HistoryContract", "HistoryService", "InputSchema", "InteractionContract", "InteractionService", "LayerContract", "LayerService", "MapLibreServiceDefinition", "MapshaperProcessingService", "MutationContract", "MutationService", "Plugin", "PluginContext", "PluginInspection", "PluginRuntime", "PluginStatus", "PolicyContract", "PolicyService", "PresetName", "ProjectionContract", "ProjectionService", "QueryContract", "QueryService", "RenderContract", "RenderService", "ScaleContract", "ScaleService", "SelectionContract", "SelectionService", "ServiceKey", "ServiceRegistry", "ServiceResolver", "ShortcutsContract", "ShortcutsService", "SnapshotContract", "SnapshotService", "SourceContract", "SourceService", "SurfaceContract", "SurfaceService", "ValidationContract", "ValidationService", "ViewContract", "ViewService", "arrowFormatsPlugin", "attributeCapabilityPlugins", "attributesPlugin", "autoCompletePolygonPlugin", "basemapControlPlugin", "boxSelectPlugin", "cachePlugin", "canvasPainterPlugin", "capabilitiesPlugin", "clickSelectPlugin", "controlContextPlugin", "controlPlugin", "controlsPlugin", "describeAgentTools", "documentPlugin", "dragPanPlugin", "drawFeaturePlugin", "duckDbCapabilityPlugins", "duckDbPlugin", "editCapabilityPlugins", "editSessionsPlugin", "editStatePlugin", "editorControlPlugins", "editorPreset", "eventsPlugin", "executionPlugin", "formatPlugin", "formatsPlugin", "headlessPreset", "historyPlugin", "interactionPlugin", "invokeAgentTool", "lassoSelectPlugin", "layersPlugin", "mapLibrePlugin", "mapshaperCapabilityPlugins", "mapshaperProcessingPlugin", "measurePlugin", "mutationPlugin", "operationHostPlugin", "partEditPlugin", "policyPlugin", "projectionPlugin", "queryPlugin", "renderPlugin", "renderSignalsPlugin", "reshapeFeaturePlugin", "resolvePlugins", "ringEditPlugin", "routingPlugin", "scalePlugin", "scrollZoomPlugin", "selectionPlugin", "serviceKey", "shortcutsPlugin", "snapshotPlugin", "sourcePlugin", "splitFeaturePlugin", "summarizeCapabilityResult", "surfacePlugin", "topologySourceFactoryPlugin", "topologyValidationPlugin", "transformFeaturePlugin", "validateCapabilityInput", "validationPlugin", "validatorPlugin", "vertexEditPlugin", "viewPlugin", "viewerControlPlugins", "viewerPreset", "workspaceCapabilityPlugins"]
examples: ["getting-started/geojson-viewer", "export-formats", "online-map-services"]
stability: experimental
verifiedVersion: 0.11.2
---

# 插件架构与 AI Capability

emap 的运行时分为 Kernel、Service、Provider、Feature Plugin 和 AI Capability 五层。`Emap` 保留为稳定 façade；扩展通过服务契约组合能力，不通过继承 Emap 或读取其私有字段。

## Kernel 与 Service

`PluginRuntime` 负责依赖解析、安装回滚、等待、禁用/启用和释放。`EffectScope` 记录事件订阅、注册表项和异步资源清理。`ServiceKey` 的身份可跨 bundle 保持一致，但每个 runtime 都有自己的 `ServiceRegistry`，因此不会共享可变实例状态。

插件把硬依赖写进 `requires`。可替换后端使用声明过的 `optional`；provider 出现、卸载或恢复时，runtime 会重新协调消费者。不要把 `optional()` 返回的对象缓存成未声明的永久依赖。

```ts
import { serviceKey, type Plugin } from '@mapseekai/emap/kernel';

const SearchService = serviceKey<{ search(q: string): string[] }>('example.search');
const searchPlugin: Plugin = {
  id: 'example.search',
  provides: [SearchService],
  setup(ctx) {
    ctx.provide(SearchService, { search: q => [q] });
  },
};
```

## Provider 与 Feature Plugin

Provider 持有状态或外部资源，例如 Canvas、Worker、格式 registry、Mapshaper、DuckDB 和 MapLibre；Feature Plugin 消费服务并注册交互、控件、校验器或 capability。内置交互和控件也走同一插件生命周期。

`editor` preset 保留编辑体验，`viewer` 去掉模态编辑能力，`headless` 不依赖 DOM/Canvas，`empty` 只安装实例选项。应用可通过 `plugins` 替换同 ID 插件，或用 `excludePlugins` 明确排除。

```ts
import { Emap } from '@mapseekai/emap';
import { mapLibrePlugin } from '@mapseekai/emap/maplibre';

const map = new Emap({
  container: 'map',
  plugins: [mapLibrePlugin],
});

map.controls.add('navigation');
map.controls.add('layers');
```

MapLibre 是显式可选 provider。传入 `mapLibre` 配置但没有安装 `mapLibrePlugin` 时，构造函数会直接报错，而不是隐式加载。

## 格式、Arrow 与 DuckDB

格式注册是实例级且可撤销的。Arrow/GeoParquet 子入口不再依靠 import side effect；可选格式由拥有它的 workspace 管理。

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import { arrowFormatsPlugin } from '@mapseekai/emap/arrow';

const map = new Emap({ preset: 'headless', plugins: [arrowFormatsPlugin] });
const source = new TopologySource('upload', { formats: map.formats });
await source.setData({ filename: 'roads.arrow', content: bytes });
await map.addSource('upload', source);
```

独立 `TopologySource` 默认拥有独立 format registry。若在 `addSource()` 之前加载可选格式，必须把目标 workspace 的 `map.formats` 传给 source。第三方格式可通过 `formatPlugin(codec)`，或 `registerFormat(map.formats, codec)` 显式注册并保留 disposer。

DuckDB 低层函数使用显式 runtime；`duckDbPlugin()` 则为一个 workspace 延迟持有 runtime。外部传入 runtime 默认只是借用，只有 `owned: true` 才把关闭责任交给 provider。

```ts
import { duckDbPlugin, duckDbCapabilityPlugins } from '@mapseekai/emap/duckdb';

const map = new Emap({
  preset: 'headless',
  plugins: [duckDbPlugin(), ...duckDbCapabilityPlugins],
});
```

## AI Capability

`map.capabilities` 是 UI、workflow 和 Agent 共用的机器可发现能力目录。Capability 包装已有领域服务，不复制 GIS 算法。参数经过受限 JSON schema 校验；异步执行会重新检查插件生命周期和源数据 freshness；执行记录只保存有界元数据，不保存完整输入数据。

Agent 默认只能调用只读 capability。修改文档、选择、视图或外部状态的调用，需要宿主通过 `authorizeCapability` 明确授权。授权函数属于可信应用配置，模型不能通过工具参数自行开启权限。

```ts
const map = new Emap({
  preset: 'headless',
  authorizeCapability: request =>
    request.origin !== 'agent' ||
    request.capability.effects.every(effect => effect === 'read'),
});

const candidates = map.capabilities.search('buffer distance');
```

`@mapseekai/emap/ai` 提供 provider-neutral 的 Agent tool 描述和调用适配器，但不包含 LLM SDK、API key 或网络发送逻辑。`invokeAgentTool()` 返回精简的 `content` 供模型消费，完整 `value` 留在本地 UI 或 workflow。

## 生命周期与信任边界

插件卸载时先撤销消费者注册，再释放 provider。未提交的拖拽编辑预览会被取消；异步 Mapshaper 操作在 scope 失效后不能提交旧结果；旧 format/capability disposer 不能删除后来的替换注册。`map.remove()` 发起释放，`await map.dispose()` 等待异步清理并暴露清理错误。

插件系统不是恶意 JavaScript 沙箱。第三方插件和宿主运行在同一 JS realm，应只安装可信代码；Capability 输入校验和 Agent 授权保护的是工具调用边界，不是任意代码执行隔离。
