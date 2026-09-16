---
id: plugins
slug: /guides/plugins
title: Native Cordis plugins and AI capabilities
api: ["AffineDelta", "CacheContract", "CapabilityAuthorization", "CapabilityAuthorizer", "CapabilityCallContext", "CapabilityDefinition", "CapabilityDescriptor", "CapabilityEffect", "CapabilityInvocation", "CapabilityOrigin", "CapabilityRegistry", "CapabilityRegistryContract", "CapabilityRun", "Context", "ControlContext", "ControlsContract", "DocumentContract", "DuckDbProcessing", "DuckDbRuntimeOptions", "DuckDbRuntimeScope", "EditStateContract", "EmapOptions", "ExecutionContract", "FeatureReadContext", "FormatRegistry", "FormatRegistryContract", "HandlerRegistration", "HistoryContract", "InputSchema", "InteractionContract", "LayerContract", "MapLibreService", "MapLibreServiceDefinition", "MutationContract", "PainterFactoryContract", "PolicyContract", "PresetName", "ProjectionContract", "QueryContract", "RenderAction", "RenderContract", "RenderSignalsContract", "RoutingContract", "ScaleContract", "SelectionContract", "ShortcutsContract", "SnapshotContract", "SourceContract", "SourceFactoryContract", "SurfaceContract", "ValidationContract", "ViewContract", "arrowFormatsPlugin", "attributeCapabilityPlugins", "attributesPlugin", "autoCompletePolygonPlugin", "basemapControlPlugin", "boxSelectPlugin", "cachePlugin", "canvasPainterPlugin", "capabilitiesPlugin", "clickSelectPlugin", "controlContextPlugin", "controlPlugin", "controlsPlugin", "describeAgentTools", "documentPlugin", "dragPanPlugin", "drawFeaturePlugin", "duckDbCapabilityPlugins", "duckDbPlugin", "editCapabilityPlugins", "editSessionsPlugin", "editStatePlugin", "editorControlPlugins", "editorPreset", "eventsPlugin", "executionPlugin", "formatPlugin", "formatsPlugin", "headlessPreset", "historyPlugin", "inspectContext", "inspectServices", "interactionPlugin", "invokeAgentTool", "lassoSelectPlugin", "layersPlugin", "mapLibrePlugin", "mapshaperCapabilityPlugins", "mapshaperProcessingPlugin", "measurePlugin", "mutationPlugin", "operationHostPlugin", "partEditPlugin", "policyPlugin", "projectionPlugin", "queryPlugin", "renderPlugin", "renderSignalsPlugin", "reshapeFeaturePlugin", "resolvePlugins", "ringEditPlugin", "routingPlugin", "scalePlugin", "scrollZoomPlugin", "selectionPlugin", "settleContext", "shortcutsPlugin", "snapshotPlugin", "sourcePlugin", "splitFeaturePlugin", "summarizeCapabilityResult", "surfacePlugin", "topologySourceFactoryPlugin", "topologyValidationPlugin", "transformFeaturePlugin", "validateCapabilityInput", "validationPlugin", "validatorPlugin", "vertexEditPlugin", "viewPlugin", "viewerControlPlugins", "viewerPreset", "workspaceCapabilityPlugins"]
examples: ["plugin-runtime", "export-formats", "online-map-services"]
stability: experimental
verifiedVersion: 0.12.0
---

# Native Cordis plugins and AI capabilities

Emap directly uses pinned upstream `cordis@4.0.0-rc.10`. `map.ctx` is the native Cordis `Context`; Cordis manages plugin dependencies, services, effects, and disposal.

```ts
import { Emap } from '@mapseekai/emap';

const map = await Emap.create({
  container: 'map',
  preset: 'editor', // built-in plugin set
  plugins: [myPlugin], // appended; same-named entries replace preset plugins
});
await map.controls.add('navigation'); // controls are child plugins
map.ctx.view.getCRS(); // read typed services from ctx
await map.dispose(); // release plugins, services, and resources
```

## Core parameters

`Emap.create(options)` returns after the preset and `plugins` reach `ACTIVE`; alternatively use `const map = new Emap(options); await map.ready`. `remove()` begins disposal and `await dispose()` waits for it. Plugin-related `EmapOptions`:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `preset` | `'editor' \| 'viewer' \| 'headless' \| 'empty'` | `'editor'` | Built-in plugin set. |
| `plugins` | `readonly Plugin[]` | `[]` | Native Cordis plugins; same-named entries replace preset plugins. |
| `excludePlugins` | `readonly string[]` | `[]` | Removes preset capability by plugin name; `map.ready` validates the graph. |
| `authorizeCapability` | `CapabilityAuthorizer` | Agent write effects require host approval | Host authorization policy for capability execution. |

## Native plugin and service contracts

TypeScript declaration merging attaches services to the Cordis `Context`; plugins declare dependencies and read typed services from `ctx`:

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

### `Plugin.Object` shape

`Plugin.Object<T>` enters through `apply(ctx, config)`; function plugins and `Service` subclasses also work with `ctx.plugin()`. Its object form is replaceable by `name`.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | Unnamed | Plugin identity for replacement, filtering, and diagnostics. |
| `inject` | `Inject`: `(keyof Context)[]` or a service-config object | No dependencies | Hard dependencies; `apply` activates once available. |
| `provide` | `string \| string[]` | Undeclared | Service names provided by this Fiber. |
| `apply` | `(ctx: Context, config: T) => unknown` | Required | Activation entry point; `ctx` is the current Fiber child Context. |
| `Config` | `StandardSchemaV1<any, T>` | Undeclared | Optional configuration schema. |

`provide` describes the dependency graph; `ctx.provide()` returns a disposer owned by the current Fiber. Registration in `ctx.effect()` revokes services before Provider disposal.

### `ctx.plugin()` and `Fiber`

`ctx.plugin()` synchronously returns an awaitable `Fiber` (`Fiber & PromiseLike<Fiber>`); `await ctx.plugin()` waits for activation. Retain the Fiber to manage dynamic installation.

| API | Parameters | Return value | Usage |
| --- | --- | --- | --- |
| `ctx.plugin(plugin, config?)` | `plugin: Plugin`; `config`: plugin `T` configuration | `Fiber & PromiseLike<Fiber>` | Mounts a Provider or feature. |
| `fiber.await()` | None | `Promise<Fiber>` | Waits for `ACTIVE`. |
| `fiber.dispose()` | None | `Promise<void>` | Unloads effects, services, and children. |
| `fiber.restart()` | None | `Promise<void>` | Reactivates current configuration. |
| `fiber.update(config)` | `config: unknown`; `noSave?: boolean` | `void \| Promise<void>` | Updates configuration and reloads. |
| `ctx.fiber` | Current `Fiber` | `Fiber` | Current plugin state and resources. |

```ts
const reader = map.ctx.plugin(readerPlugin);
const provider = await map.ctx.plugin(counterPlugin);
await reader.await();
await provider.dispose();
await map.ctx.plugin(counterPlugin);
```

When an `inject` service returns, Cordis reactivates waiting Fibers. Optional integrations can use `ctx.get('mapLibre')`.

### Injectable Emap services

`src/runtime/services/context.ts` declares Context augmentation for workspace services; matching Providers supply each one. Put used services in `inject`.

| Service | Contract / primary capability | Usage |
| --- | --- | --- |
| `formats` | `FormatRegistryContract`: registration, removal, and format lookup | Format codecs and import/export. |
| `capabilities` | `CapabilityRegistryContract`: registration, discovery, execution, and history | AI / UI tools. |
| `document`, `layers`, `source`, `sourceFactory` | Dataset, layer, and source lifecycle | Workspace data. |
| `view`, `projection`, `scale` | Camera, CRS projection, and scale | Navigation and spatial tools. |
| `selection`, `history`, `mutation`, `editState`, `editSession` | Selection, history, and edit state | Editing and undoable interaction. |
| `query`, `cache`, `ops`, `attributes` | Queries, cache, mapshaper, and attribute operations | Feature processing. |
| `surface`, `render`, `painterFactory`, `signals` | Canvas, drawing, and redraw signals | Visual and rendering extensions. |
| `interaction`, `routing`, `shortcuts`, `controls`, `controlContext` | Handlers, routing, hotkeys, and control factories | Custom interaction and controls. |
| `mapEvents`, `options`, `policy`, `validation`, `snapshot`, `execution`, `host` | Events, options, policy, validation, snapshots, Worker, and trusted-operation bridge | Feature coordination and async jobs. |
| `mapLibre` | `MapLibreServiceManager` | MapLibre basemaps and online layers. |
| `duckDb`, `duckDbProcessing` | Lazy DuckDB runtime and processing entry point | Local DuckDB processing. |

`viewer` also supplies browsing-interaction services; `editor` adds editing-interaction services. Both suit controls or `inject` prerequisites.

#### `formats` registration contract

`formats` is per-map. On format-feature unload, the function returned by `register()` unregisters the codec and ends its in-flight imports or exports with `AbortError`.

`DatasetFormatPlugin` parameters:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | Required | Unique codec registration name. |
| `extensions` | `readonly string[]` | Required | Dotless import extensions; registration lowercases and keeps them unique. |
| `importBinary` | `(content: Uint8Array, filename: string) => Promise<MapshaperDataset>` | Required | Decodes bytes and filename into a dataset. |
| `exportFormats` | `Readonly<Record<string, (dataset: MapshaperDataset, options?: object) => Promise<ExportedFormatFile[]>>>` | Required | Export format-to-handler map. |
| `mimeTypes` | `Readonly<Record<string, string>>` | Omitted | Export format-to-Blob-MIME map. |

`FormatRegistryContract` operations:

| API | Parameters | Return value | Usage |
| --- | --- | --- | --- |
| `register(plugin)` | `plugin: DatasetFormatPlugin` | `() => void` | Registers a codec and returns its disposer. |
| `unregister(name)` | `name: string` | `void` | Removes a codec by name. |
| `getFormatForExtension(extension)` | `extension: string` | `DatasetFormatPlugin \| undefined` | Finds importer by extension. |
| `getExportHandler(format)` | `format: string` | Export handler or `undefined` | Finds export handler. |
| `getMimeType(format)` | `format: string` | `string \| undefined` | Finds export MIME type. |
| `list()` / `dispose()` | None | `readonly DatasetFormatPlugin[]` / `void` | Inspects or releases the registry. |

### Feature composition

A feature declares existing Providers in `inject`, registers contributions as effects, and uses `provide` for a Handler or service. Format features use `inject: ['formats']`:

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

`formatPlugin(format)` and `arrowFormatsPlugin` wrap this pattern. Interaction features register and provide Handlers; Capability features register domain methods and reuse geometry, CRS, and transaction constraints.

## Effects and asynchronous resources

`ctx.effect()` runs its callback during Fiber activation. The callback may return a disposer, its iterable, or async counterparts; Cordis releases grouped resources in reverse order.

`ctx.effect(execute, label?)` binds resources to plugin lifetime and returns a disposer (async effects are awaitable); `ctx.provide(name, value)` supplies an instance service and returns an async disposer.

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

Groups revoke services and await consumers before closing resources. `ctx.on()` joins the current Fiber; GIS events use `ctx.mapEvents`. Controls are child plugins; `map.addControl()`, `map.removeControl()`, and `map.controls.add()` return promises.

## Runtime responsibilities

| Layer | Implementation and responsibility |
| --- | --- |
| Kernel | Upstream Cordis `Context`, Registry, Fiber, Service, events, effects, and isolation. |
| Service | `src/runtime/services/`: Context augmentation and domain contracts. |
| Provider | `src/runtime/providers/`, `src/engine/providers/`, and `src/integrations/*/plugin.ts`. |
| Feature Plugin | `src/runtime/plugins/`: interaction, controls, validation, and capability contributions. |
| AI Capability | `src/runtime/ai/`: schemas, discovery, authorization, history, and results. |

`domain / engine / runtime / integrations / ui / shared` divide responsibilities; `src/runtime/context/` provides native type re-exports, inspection, state waiting, and effect-ownership helpers.

## Presets and optional providers

`headless` supplies processing services, `viewer` adds Canvas and browsing interaction, `editor` adds editing controls and interaction, and `empty` installs only `options`. `resolvePlugins()` filters `excludePlugins`, replaces same-named preset entries, then appends application plugins.

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

Format registration is instance-local. DuckDB initializes on first use; pass `owned: true` with a runtime for Provider disposal. The MapLibre Provider initializes browser basemaps.

## Agent access

```ts
import { describeAgentTools, invokeAgentTool } from '@mapseekai/emap/ai';

const tools = describeAgentTools(map.capabilities);
const result = await invokeAgentTool(map.capabilities, 'view.getCRS', {});
console.log(result.content);
```

`CapabilityRegistryContract` execution parameters:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` | Required | Registered capability ID. |
| `input` | `Readonly<Record<string, unknown>>` | `{}` | Input validated and frozen by `inputSchema`. |
| `invocation.origin` | `'api' \| 'ui' \| 'agent'` | `'api'` | Caller origin; `authorizeCapability` decides Agent write effects. |
| `invocation.signal` | `AbortSignal` | Omitted | Cancels execution; feature unload also cancels it. |

`map.capabilities.execute(id, input?, invocation?)` returns `Promise<T>`; `list(category?)`, `get(id)`, and `search(query)` discover capabilities, while `history()` returns at most 200 records. Agent reads run directly; host policy controls write effects.

## Inspect the actual runtime

```ts
import { inspectContext, inspectServices, settleContext } from '@mapseekai/emap/context';

console.table(inspectContext(map.ctx));
console.table(inspectServices(map.ctx));
await settleContext(map.ctx);
```

**Cordis Runtime / GIS Harness** shows versions, `Context.is(map.ctx)`, Fiber states, Providers, effects, optional modules, and four presets. ESM keeps `cordis` external; the script tag exports `emap.Context`, and cross-bundle checks use `Context.is()`.

## Runnable examples

- [Plugin runtime](/mapseekai/emap/examples/plugin-runtime/)
- [Export formats](/mapseekai/emap/examples/export-formats/)
- [Online map services](/mapseekai/emap/examples/online-map-services/)
