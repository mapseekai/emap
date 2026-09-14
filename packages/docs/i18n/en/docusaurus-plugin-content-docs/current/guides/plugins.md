---
id: plugins
slug: /guides/plugins
title: Plugin architecture and AI Capability
api: ["AttributeService", "CapabilityAuthorization", "CapabilityAuthorizer", "CapabilityCallContext", "CapabilityDefinition", "CapabilityDescriptor", "CapabilityEffect", "CapabilityInvocation", "CapabilityOrigin", "CapabilityRegistry", "CapabilityRegistryContract", "CapabilityRun", "CapabilityService", "Cleanup", "ControlContext", "ControlsContract", "ControlsService", "DuckDbProcessing", "DuckDbProcessingService", "DuckDbRuntimeOptions", "DuckDbRuntimeScope", "DuckDbService", "EditSessionService", "EditStateContract", "EditStateService", "EffectScope", "EmapOptions", "EventService", "ExecutionContract", "ExecutionService", "FeatureReadContext", "FormatRegistry", "FormatRegistryContract", "FormatService", "HandlerRegistration", "HistoryContract", "HistoryService", "InputSchema", "InteractionContract", "InteractionService", "LayerContract", "LayerService", "MapLibreServiceDefinition", "MapshaperProcessingService", "MutationContract", "MutationService", "Plugin", "PluginContext", "PluginInspection", "PluginRuntime", "PluginStatus", "PolicyContract", "PolicyService", "PresetName", "ProjectionContract", "ProjectionService", "QueryContract", "QueryService", "RenderContract", "RenderService", "ScaleContract", "ScaleService", "SelectionContract", "SelectionService", "ServiceKey", "ServiceRegistry", "ServiceResolver", "ShortcutsContract", "ShortcutsService", "SnapshotContract", "SnapshotService", "SourceContract", "SourceService", "SurfaceContract", "SurfaceService", "ValidationContract", "ValidationService", "ViewContract", "ViewService", "arrowFormatsPlugin", "attributeCapabilityPlugins", "attributesPlugin", "autoCompletePolygonPlugin", "basemapControlPlugin", "boxSelectPlugin", "cachePlugin", "canvasPainterPlugin", "capabilitiesPlugin", "clickSelectPlugin", "controlContextPlugin", "controlPlugin", "controlsPlugin", "describeAgentTools", "documentPlugin", "dragPanPlugin", "drawFeaturePlugin", "duckDbCapabilityPlugins", "duckDbPlugin", "editCapabilityPlugins", "editSessionsPlugin", "editStatePlugin", "editorControlPlugins", "editorPreset", "eventsPlugin", "executionPlugin", "formatPlugin", "formatsPlugin", "headlessPreset", "historyPlugin", "interactionPlugin", "invokeAgentTool", "lassoSelectPlugin", "layersPlugin", "mapLibrePlugin", "mapshaperCapabilityPlugins", "mapshaperProcessingPlugin", "measurePlugin", "mutationPlugin", "operationHostPlugin", "partEditPlugin", "policyPlugin", "projectionPlugin", "queryPlugin", "renderPlugin", "renderSignalsPlugin", "reshapeFeaturePlugin", "resolvePlugins", "ringEditPlugin", "routingPlugin", "scalePlugin", "scrollZoomPlugin", "selectionPlugin", "serviceKey", "shortcutsPlugin", "snapshotPlugin", "sourcePlugin", "splitFeaturePlugin", "summarizeCapabilityResult", "surfacePlugin", "topologySourceFactoryPlugin", "topologyValidationPlugin", "transformFeaturePlugin", "validateCapabilityInput", "validationPlugin", "validatorPlugin", "vertexEditPlugin", "viewPlugin", "viewerControlPlugins", "viewerPreset", "workspaceCapabilityPlugins"]
examples: ["getting-started/geojson-viewer", "export-formats", "online-map-services"]
stability: experimental
verifiedVersion: 0.11.2
---

# Plugin architecture and AI Capability

emap is organized into five runtime layers: Kernel, Service, Provider, Feature Plugin, and AI Capability. `Emap` remains the stable façade; extensions compose typed services instead of subclassing Emap or reading private fields.

## Kernel and services

`PluginRuntime` owns dependency resolution, atomic mount rollback, waiting, disable/enable, and teardown. `EffectScope` owns event subscriptions, registry entries, and asynchronous resource cleanup. `ServiceKey` identities are stable across bundles, while every runtime keeps an instance-local `ServiceRegistry`.

Declare hard dependencies in `requires`. Use declared `optional` services for replaceable backends; the runtime reconciles consumers when a provider appears, disappears, or returns. Do not retain an optional service as an undeclared permanent dependency.

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

## Providers and feature plugins

Providers own state or external resources such as Canvas, workers, the format registry, Mapshaper, DuckDB, and MapLibre. Feature plugins consume services to register interactions, control factories, validators, or capabilities. Built-in interactions and controls use the same lifecycle as third-party plugins.

The `editor` preset preserves the editing experience, `viewer` omits modal editing features, `headless` has no DOM/Canvas dependency, and `empty` installs only instance options. Use `plugins` to replace a plugin with the same ID or `excludePlugins` to remove one explicitly.

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

MapLibre is an explicit optional provider. Passing `mapLibre` options without installing `mapLibrePlugin` fails immediately instead of loading a hidden dependency.

## Formats, Arrow, and DuckDB

Format registration is instance-scoped and reversible. Importing the Arrow/GeoParquet entry point no longer mutates global format state; optional codecs are owned by the workspace that mounts them.

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import { arrowFormatsPlugin } from '@mapseekai/emap/arrow';

const map = new Emap({ preset: 'headless', plugins: [arrowFormatsPlugin] });
const source = new TopologySource('upload', { formats: map.formats });
await source.setData({ filename: 'roads.arrow', content: bytes });
await map.addSource('upload', source);
```

A detached `TopologySource` owns its own format registry. If an optional format must be decoded before `addSource()`, pass the target workspace's `map.formats`. Third-party codecs can use `formatPlugin(codec)` or explicit `registerFormat(map.formats, codec)` and retain the returned disposer.

DuckDB low-level functions take an explicit runtime. `duckDbPlugin()` lazily owns one runtime for a workspace. Injected runtimes are borrowed by default and are closed only when `owned: true` transfers ownership.

```ts
import { duckDbPlugin, duckDbCapabilityPlugins } from '@mapseekai/emap/duckdb';

const map = new Emap({
  preset: 'headless',
  plugins: [duckDbPlugin(), ...duckDbCapabilityPlugins],
});
```

## AI Capability

`map.capabilities` is a machine-discoverable catalog shared by UI, workflows, and agents. Capabilities wrap existing domain services instead of reimplementing GIS operations. Arguments pass bounded JSON-schema validation, asynchronous execution re-checks lifecycle and source freshness, and bounded run history stores metadata rather than complete input data.

Agent-originated calls are read-only by default. Document, selection, view, or external side effects require the host's `authorizeCapability` policy. That policy is trusted application configuration and cannot be enabled by model-generated tool arguments.

```ts
const map = new Emap({
  preset: 'headless',
  authorizeCapability: request =>
    request.origin !== 'agent' ||
    request.capability.effects.every(effect => effect === 'read'),
});

const candidates = map.capabilities.search('buffer distance');
```

`@mapseekai/emap/ai` exposes provider-neutral tool descriptions and invocation adapters. It deliberately contains no model SDK, API-key handling, or network transport. `invokeAgentTool()` returns a small model-facing `content` summary while keeping the complete `value` local to UI or workflow code.

## Lifecycle and trust boundary

Consumers unregister before providers release their resources. An unloaded editing provider cancels an uncommitted drag preview; scoped Mapshaper operations cannot commit after their owner is revoked; stale format/capability disposers cannot remove replacement registrations. `map.remove()` starts teardown; `await map.dispose()` waits for asynchronous cleanup and surfaces cleanup failures.

The plugin system is not a sandbox for hostile JavaScript. Install trusted plugin code. Capability validation and agent authorization protect the tool-invocation boundary, not arbitrary code execution.
