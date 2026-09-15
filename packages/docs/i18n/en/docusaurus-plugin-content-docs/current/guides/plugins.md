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

This branch uses the exact official upstream package `cordis@4.0.0-rc.10`, a release candidate rather than a stable-release guarantee. The custom runtime, service tokens and effect scope have been removed. `map.ctx` is a native Cordis `Context`; emap does not keep a second dependency graph or plugin state machine.

## Initialization and disposal

Native plugin loading is asynchronous. Await initialization before accessing GIS services:

```ts
import { Emap } from '@mapseekai/emap';
const map = await Emap.create({ container: 'map', preset: 'editor' });
await map.controls.add('navigation');
console.log(map.ctx.view.getCRS());
await map.dispose();
```

Alternatively, construct a map and await `map.ready`. Constructor completion does not mean services are active. `remove()` requests teardown; `dispose()` waits for native Cordis disposal. Wait before reusing the container. Cleanup failures use the native Cordis logger instead of the previous kernel's aggregate-error contract.

## Native plugin and service contracts

Services use standard TypeScript declaration merging, not custom Symbol tokens:

```ts
import type { Plugin } from 'cordis';

declare module 'cordis' {
  interface Context {
    counter: { value: number };
  }
}
const counterPlugin: Plugin.Object = {
  name: 'demo.counter',
  apply(ctx) { ctx.provide('counter', { value: 1 }); },
};
const readerPlugin: Plugin.Object = {
  name: 'demo.reader',
  inject: ['counter'],
  apply(ctx) { console.log(ctx.counter.value); },
};
const reader = map.ctx.plugin(readerPlugin);
const provider = await map.ctx.plugin(counterPlugin);
await reader.await();
await provider.dispose(); // The reader becomes PENDING through Cordis.
await map.ctx.plugin(counterPlugin); // It reactivates when the service returns.
```

Native function plugins and `Service` subclasses also work directly. Declare hard dependencies with `inject` and consume typed properties. Query optional services with `ctx.get('mapLibre')`; a lookup is not a hard dependency and should not be cached as a permanently valid object.

Use native `Fiber.dispose()`, reinstallation through `ctx.plugin()`, `Fiber.restart()` and `Fiber.update(config)`. There is no emulated ID-based disable/enable API. Presets use plugin names for explicit overrides; Cordis itself identifies instances by callback and Fiber, and its multi-instance semantics remain intact.

## Effects and asynchronous resources

Use a native generator effect to ensure consumers stop before their resource is closed:

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

The group releases in reverse order: revoke the service and await its consumers, then close the resource. `ctx.on()` subscriptions participate in the same native lifecycle. Existing GIS object events remain on `ctx.mapEvents`, an ordinary domain EventDispatcher rather than a plugin scheduler.

Asynchronous GIS operations use AbortControllers registered as native effects to prevent stale commits. Cancellation does not forcibly interrupt every synchronous GIS algorithm. Control instances are native child plugins: `map.addControl()`, `map.removeControl()` and `map.controls.add()` return promises.

## Responsibilities

| Layer | Responsibility |
| --- | --- |
| Kernel | Upstream Cordis Context, Registry, Fiber, Service, events, effects and isolation. |
| Service | Context augmentation and explicit domain contracts in `src/runtime/services/`. |
| Provider | Document, Canvas, camera, history, Mapshaper, topology, Worker and codec implementations. |
| Feature Plugin | Interactions, control factories, validators and capability contributions. |
| AI Capability | Domain tool schemas, discovery, host authorization, bounded run records and summaries; not another plugin kernel. |

Existing algorithms and authoritative GIS data structures are reused. Rendering and pointer hot paths do not pass through JSON or an agent. `src/runtime/context/` contains native re-exports, read-only diagnostics, a native-transition waiter and effect-owned cancellation; it does not schedule dependencies.

## Presets and optional providers

`editor` supplies modal editing interactions; `viewer` retains processing without those handlers; `headless` creates no DOM or Canvas; `empty` only installs options. Override a preset with a same-name native plugin. `excludePlugins` contains names. Missing mandatory services reject `map.ready`.

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

Codec registrations remain instance-local with no import-time registration. DuckDB initializes lazily. Supplied runtimes are borrowed unless `owned: true`; factory-created runtimes are owned. MapLibre stays an optional peer and needs service configuration before a basemap initializes.

## Agent access

```ts
import { describeAgentTools, invokeAgentTool } from '@mapseekai/emap/ai';
const tools = describeAgentTools(map.capabilities);
const result = await invokeAgentTool(map.capabilities, 'view.getCRS', {});
console.log(result.content);
// Keep result.value local for UI or workflow use.
```

Agent calls are read-only by default. Mutating document, selection, view or external state requires the host's `authorizeCapability` policy; model arguments cannot grant authorization. Existing geometry, CRS, freshness and transaction checks still apply. Run records are bounded metadata, not persistent event sourcing.

## Inspect the actual runtime

```ts
import { inspectContext, inspectServices, settleContext } from '@mapseekai/emap/context';
console.table(inspectContext(map.ctx));
console.table(inspectServices(map.ctx));
await settleContext(map.ctx);
```

The **Cordis Runtime / GIS Harness** example displays the pinned version, `Context.is(map.ctx)`, native Fiber states, service providers, effects, optional-module installation/disposal and four presets. The diagnostic helpers do not maintain shadow runtime state.

ESM output leaves `cordis` external so the application and emap share one library instance. Script-tag output bundles Cordis and exports `emap.Context`; use native `Context.is()` across different bundles instead of class-reference identity.
