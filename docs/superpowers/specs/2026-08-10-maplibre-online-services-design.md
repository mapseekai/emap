# MapLibre Online Map Services Design

**Date:** 2026-08-10
**Status:** Approved in conversation

## Context

`BasemapControl` currently owns a lazily imported MapLibre map that is placed
behind the emap canvas. It accepts an array of `BasemapStyle` values and can
switch between raster XYZ templates and MapLibre style URLs. The current
surface is intentionally small: `BasemapStyle` contains only `name`, `url`,
and an optional `type`; one button is rendered per style; and the public
`defaultStyle` option is declared but never applied.

That implementation does not provide a durable model for online map
services. It cannot register MapLibre sources and layers as independently
visible overlays, restore those overlays after a basemap style swap, update
services at runtime, report per-service state, or expose overlays alongside
emap's own layers. It also has no direct test coverage.

The new capability keeps one MapLibre canvas below the emap canvas. A single
basemap may be active, while any number of online overlay services may be
active at the same time. All service descriptions and rendering behavior use
MapLibre-native style, source, and layer specifications; emap does not create
a parallel WMS or WMTS protocol stack.

## Goals

- Load online basemaps and overlays through MapLibre-native specifications.
- Support XYZ/TMS templates, WMS raster templates, WMTS tile templates,
  TileJSON sources, and MapLibre style URLs or JSON where MapLibre supports
  them.
- Keep zero or one basemap active and allow multiple overlays to be visible.
- Render basemaps and online overlays in one MapLibre canvas below all emap
  business and editing content.
- Add, update, remove, show, and hide services at runtime.
- Preserve visible overlays when the active basemap style changes.
- Expose the underlying `maplibregl.Map` as an advanced escape hatch without
  making unmanaged resources part of emap's persistence contract.
- Present basemaps in `BasemapControl` and present online overlays together
  with emap business layers in a new `LayerControl`.
- Preserve the existing `BasemapStyle`, `styles`, `defaultStyle`, and
  `isOn()` contracts.
- Add deterministic loading, error, teardown, and rapid-switch behavior with
  focused automated coverage.

## Non-goals

- No `GetCapabilities` request or parser for WMS or WMTS.
- No emap-specific WMS, WMTS, XYZ, or TileJSON protocol abstraction.
- No automatic service catalog or remote layer picker.
- No simultaneous basemap composition; basemaps remain mutually exclusive.
- No layer reordering in the first release. In particular, online overlays
  cannot be interleaved with emap layers because they render in different
  canvases.
- No opacity editor, style editor, token editor, or authentication UI.
  Callers use MapLibre source/layer paint and `transformRequest` options.
- No persistence guarantee for sources, layers, or images added directly
  through the raw MapLibre map.
- No interactive MapLibre navigation. Emap remains the camera and pointer
  owner.
- No attempt to align an arbitrary emap projection with the MapLibre canvas.
  The existing Web Mercator alignment contract remains in force.

## Approaches Considered

### Emap-owned manager with separate controls (selected)

`Emap` lazily owns one `MapLibreServiceManager`. `BasemapControl` and
`LayerControl` subscribe to the same manager, so UI removal does not destroy
service state. The manager owns MapLibre initialization, the service registry,
style switching, overlay reconciliation, camera synchronization, and cleanup.

This structure is selected because two independent controls must share a
single source of truth and a single MapLibre canvas. It also keeps protocol
and asynchronous lifecycle logic out of control DOM code.

### BasemapControl-owned manager

Keeping the manager inside `BasemapControl` would minimize changes to `Emap`,
but it would tie online overlays to the lifetime of a basemap UI control and
force `LayerControl` to depend on another control instance. Removing or not
installing `BasemapControl` would unexpectedly remove overlay capability.

### Raw MapLibre map only

Exposing the MapLibre instance and making applications call `setStyle`,
`addSource`, and `addLayer` directly would be the smallest wrapper. It would
not provide a service registry, overlay restoration, shared control state,
transactional updates, or deterministic teardown, so it does not meet the
requested user-facing behavior.

## Architecture

The rendering and ownership stack is:

```text
Emap
  -> MapLibreServiceManager
       -> one MapLibre map
       -> one MapLibre canvas container
       -> basemap and overlay service registry
       -> service runtime state
  -> BasemapControl
       -> basemap selection only
  -> LayerControl
       -> emap rendered layers
       -> MapLibre overlay services
```

The visual stack, from bottom to top, is:

```text
active MapLibre basemap style
visible MapLibre overlay services
emap business-layer canvas
emap selection and editing content
emap controls
```

The manager is constructed without importing or initializing MapLibre. The
dynamic `import('maplibre-gl')`, container creation, and `maplibregl.Map`
construction happen only when a basemap or overlay first needs to be shown.
When no MapLibre service is visible, the container is hidden. `Emap.remove()`
is the sole owner of final manager and MapLibre teardown.

Engine-level state notifications use `EventDispatcher`. DOM events remain
inside the controls. Camera synchronization continues to listen to emap's
`move` signal and applies `jumpTo({ center, zoom })` to MapLibre; it never
mutates state inline from `Emap.render()`.

## Public Service Model

The public service type is a discriminated union:

```ts
export type MapLibreService = MapLibreBasemapService | MapLibreOverlayService;

export interface MapLibreBasemapService {
  id: string;
  name: string;
  role: 'basemap';
  style: string | maplibregl.StyleSpecification;
}

export interface MapLibreOverlayService {
  id: string;
  name: string;
  role: 'overlay';
  sources: Record<string, maplibregl.SourceSpecification>;
  layers: maplibregl.LayerSpecification[];
  visible?: boolean;
}
```

Basemaps use complete styles because that is MapLibre's native unit for
`setStyle()`. A full remote style URL or style JSON is therefore a basemap.
XYZ, TMS, WMS, or WMTS can also be used as a basemap by placing their raster
source and raster layer in a normal version-8 style.

Overlays mirror MapLibre's runtime `addSource()` and `addLayer()` APIs. A WMS
overlay uses a raster source whose tile URL contains
`{bbox-epsg-3857}`. XYZ, TMS, and WMTS use MapLibre-compatible tile templates.
A TileJSON source uses the native source `url` property. A vector service may
declare one vector source and several MapLibre layers referencing its
`source-layer` values.

Service IDs are unique in the service registry. Overlay source and layer IDs
are globally unique across all registered overlays and must not collide with
the active basemap style. Every source referenced by an overlay layer must be
declared by that same overlay service; cross-service source dependencies are
not supported because they make atomic update and removal ambiguous.

Layer array order is preserved inside one overlay. Overlay services are
applied in service registration order. Updating a service preserves its
registry position. Changing a service's `role` is rejected; callers remove
and re-add the service when its role changes.

## Map Configuration and Manager API

`MapOptions` gains an optional MapLibre integration block:

```ts
export interface MapLibreIntegrationOptions {
  services?: readonly MapLibreService[];
  defaultBasemap?: string;
  mapOptions?: Omit<
    maplibregl.MapOptions,
    'container' | 'style' | 'center' | 'zoom' | 'interactive'
  >;
}

export interface MapOptions {
  // existing fields
  mapLibre?: MapLibreIntegrationOptions;
}
```

The omitted fields are owned by emap so the two canvases cannot diverge.
Other native options are forwarded. In particular, callers may use
`transformRequest` for tokens, headers, URL rewriting, or other provider
requirements. Compatibility defaults remain `interactive: false`,
`attributionControl: false`, `maxPitch: 0`, and `renderWorldCopies: true`
unless an allowed option explicitly overrides a compatible default.

`Emap` exposes its shared manager through a read-only
`mapLibreServices` getter. The manager provides:

```ts
addService(service: MapLibreService): Promise<void>;
updateService(id: string, service: MapLibreService): Promise<void>;
removeService(id: string): Promise<void>;
setBasemap(id: string | null): Promise<void>;
setOverlayVisibility(id: string, visible: boolean): Promise<void>;
getServices(): readonly MapLibreService[];
getServiceState(id: string): MapLibreServiceState | undefined;
getMapLibreMap(): maplibregl.Map | null;
```

The runtime state is separate from the immutable service definition:

```ts
export interface MapLibreServiceState {
  id: string;
  active: boolean;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: Error;
}
```

Methods may be called before MapLibre is initialized. Registration state is
updated immediately; MapLibre mutations are applied when the host is ready.
The asynchronous methods resolve only after their requested state has been
applied or reject on validation, loading, or supersession failure.

## Basemap and Overlay Lifecycle

### Initial state

`MapOptions.mapLibre.services` initializes the registry. `defaultBasemap`, if
present, must refer to a registered basemap. Every overlay with
`visible: true` is scheduled for activation. If an overlay is active without
a basemap, the manager creates or sets an empty version-8 style with no
sources or layers and mounts the overlays onto it.

Before the first visible MapLibre service is applied, the manager preserves
the current basemap alignment behavior by awaiting
`emap.reproject('webmercator')` when the emap CRS is not Web Mercator. This is
an emap/MapLibre camera alignment step, not protocol conversion. All service
source, tile, and style projection behavior remains MapLibre's responsibility.

### Basemap switching

`setBasemap(id)` validates that `id` names a basemap, records the desired
selection, and calls MapLibre `setStyle(service.style)`. A monotonic style
revision identifies the current request. `style.load` from an older revision
cannot commit UI or service state.

At the matching `style.load`, the manager reconciles every visible overlay in
registry order:

1. Add each missing source.
2. Add each missing layer in declared order.
3. Leave an already-present manager-owned source or layer in place.
4. Mark the basemap and successfully reconciled overlays ready.

This reconciliation is required because MapLibre may preserve runtime
resources on a style diff but removes them on a full style rebuild. Checking
for existing resources makes the same code safe in both paths.

`setBasemap(null)` selects no basemap. If overlays remain visible, the blank
style is installed and the overlays are reconciled. If no overlay remains,
the MapLibre container is hidden. Removing the active basemap has the same
result and does not silently select another registered basemap.

### Overlay mutations

Showing an overlay adds its sources and layers through MapLibre. Hiding it
removes layers in reverse order and removes its now-unreferenced sources.
Removing a service first removes its active resources and then deletes its
registry entry.

Updating an inactive service replaces its definition after validation.
Updating an active overlay removes the old resources and applies the new
definition transactionally. Updating the active basemap is equivalent to
setting its replacement style and following the normal style-load path.

The latest request wins during rapid changes. A request superseded before it
commits rejects with `AbortError`. Stale `style.load`, source, or layer
callbacks cannot overwrite the latest registry intent.

## Compatibility

`BasemapStyle`, `BasemapOptions.styles`, `BasemapOptions.defaultStyle`, and
`BasemapControl.isOn()` remain public.

Legacy behavior is normalized as follows:

- Explicit legacy styles become basemap services with deterministic internal
  IDs based on array position.
- A legacy raster URL becomes a normal raster style using the existing tile
  size and zoom defaults.
- A non-raster URL remains a MapLibre style URL.
- `defaultStyle` selects the first matching legacy style by `name` and is now
  actually applied.
- `new BasemapControl()` registers the existing built-in defaults only when
  the map-level service registry is empty.
- An explicit legacy `styles` configuration and an existing map-level service
  configuration are rejected as a configuration conflict instead of being
  merged implicitly.
- When map-level services already exist, `new BasemapControl()` without legacy
  options is a pure UI view over that registry.

The legacy `isOn()` result means that a basemap is active. Visible overlays do
not make `isOn()` return `true`.

## BasemapControl

`BasemapControl` displays only basemaps. Its trigger opens a panel containing
a radio list of registered basemaps plus a "no basemap" choice. It subscribes
to manager change and error events, reflects loading and error state, and
routes every selection through `setBasemap()`.

The control retains the `.emap-basemap-ctrl` container class for compatibility.
It supports keyboard navigation, closes on `Escape` or an outside click, and
uses an accessible group label and live status text. Dynamic registry changes
rerender the list without creating a second source of truth.

Removing the control only removes its DOM and listeners. It does not remove
registered services, hide a basemap, or destroy MapLibre.

## LayerControl

`LayerControl` is a new public control that gives emap business layers and
MapLibre overlays one user-facing layer surface. Its panel contains two
visually consistent groups ordered like the real rendering stack:

1. Emap business layers, which render above MapLibre.
2. Online overlays, which render below every emap layer.

Each row has a visibility checkbox and a label. The online rows may carry a
small type indicator, but use the same interaction and row layout as business
layers. The first release has no drag handles or ordering controls.

Business-layer toggles call `Emap.setLayerVisibility()`. Online-overlay
toggles call `MapLibreServiceManager.setOverlayVisibility()`. Both state
sources publish events, so API-driven changes and UI-driven changes remain in
sync.

The current public `getLayers()` returns only explicitly configured layer
specifications, while emap can render generated defaults when that list is
empty. `LayerControl` must display the effective rendered layers, not an empty
list. Emap therefore adds
`getRenderedLayers(): readonly LayerSpecification[]`, which returns cloned
effective specifications without changing the existing `getLayers()`
contract. When a user first changes the visibility of a generated default
layer, emap materializes the complete current default list into explicit layer
state and applies the visibility change. This preserves the existing visual
appearance while making future toggles stable.

Emap publishes a `layerchange` signal when an explicit layer is added,
removed, or shown/hidden, and when source loading/removal changes the generated
effective layer list. Its payload contains the reason (`add`, `remove`,
`visibility`, or `effective`), an optional affected layer id, and the current
`getRenderedLayers()` snapshot. The control subscribes on `onAdd()` and fully
detaches on `onRemove()`.

## Events and Error Handling

The manager extends `EventDispatcher` and publishes typed `change` and `error`
events. A change includes the service id, role, new runtime state, and the
reason (`add`, `update`, `remove`, `basemap`, `visibility`, or `status`). An
error includes the service id when known, a phase (`style`, `source`, `layer`,
`tile`, or `lifecycle`), the original error, and whether the failure is fatal
for the service.

Validation rejects:

- Duplicate service IDs.
- Unknown service IDs.
- Calling a basemap operation on an overlay or an overlay operation on a
  basemap.
- Role changes through `updateService()`.
- Duplicate overlay source or layer IDs.
- Overlay layers whose source is not declared by the same service.
- Invalid `defaultBasemap` references.

Applying an overlay is transactional. If one source or layer fails, the
manager removes only the layers and sources added for that attempt, restores
the previous definition when updating, marks the service as errored, and
leaves other services untouched.

If a new basemap style fails before `style.load`, the manager marks that
basemap errored and attempts to restore the last successfully loaded basemap.
If there is none, it installs the blank style. Visible overlays are reconciled
after either recovery path.

MapLibre tile-request errors are non-fatal service events because an
individual network tile may fail transiently. Style parse/load errors and
source/layer installation failures are fatal for the affected operation.
Errors retain their original cause and are not reduced to console warnings.

Resources added through `getMapLibreMap()` are unmanaged. The manager neither
records nor restores them after a style change. Public documentation calls out
that persistent content must be registered as an overlay service.

## Testing Strategy

Implementation follows red-green-refactor. Automated tests do not depend on
public tile servers; a MapLibre module and map test double drive lifecycle and
event behavior deterministically.

### Manager tests

- Lazy module import, container creation, and allowed `mapOptions` forwarding.
- Registration and validation for basemap and overlay definitions.
- Zero-or-one basemap exclusivity and `defaultBasemap` activation.
- Several simultaneously visible overlays.
- Blank-style behavior when overlays are active without a basemap.
- Overlay source/layer application order.
- `setStyle` followed by matching `style.load` reconciliation.
- Overlay preservation in both MapLibre diff-preserving and full-rebuild
  simulations.
- Rapid basemap switching, stale callback rejection, and `AbortError`.
- Add, update, remove, show, and hide before and after MapLibre creation.
- Transactional overlay rollback without disturbing sibling services.
- Failed basemap recovery to the previous successful basemap or blank style.
- Fatal configuration errors versus non-fatal tile errors.
- Raw MapLibre getter behavior before and after initialization.
- Camera synchronization and Web Mercator preparation.
- Complete MapLibre, DOM, and listener cleanup from `Emap.remove()`.

### Control and emap tests

- `BasemapControl` displays basemaps only, including the no-basemap choice.
- `LayerControl` displays effective emap layers and online overlays in the
  approved group order.
- Each checkbox calls the correct engine or manager visibility API.
- API-driven changes update both controls without duplicate events.
- Dynamic service and emap layer changes rerender the relevant panel.
- Default rendered layers materialize correctly on the first visibility
  change.
- `layerchange` fires for add, remove, visibility, and generated-list changes.
- `onRemove()` detaches control DOM and listeners without destroying services.
- Keyboard, outside-click, ARIA, loading, and error-state contracts.

### Compatibility and type tests

- Existing `styles` values still produce equivalent raster or style-url
  basemaps.
- `defaultStyle` now selects the intended legacy style.
- Existing no-option `BasemapControl` defaults remain available on an empty
  registry.
- Legacy and map-level configuration conflicts fail clearly.
- Public declarations accept MapLibre `StyleSpecification`,
  `SourceSpecification`, `LayerSpecification`, and allowed `MapOptions`
  fields without weakening existing emap types.

## Documentation and Example

Update the English and Chinese README control sections, the controls guide,
and generated public API inputs. Documentation includes concise native
MapLibre examples for:

- XYZ and TMS raster tile templates.
- WMS with `{bbox-epsg-3857}`.
- WMTS tile templates.
- TileJSON through a source `url`.
- A complete MapLibre style URL or style JSON as a basemap.
- `transformRequest` for provider authentication.
- Runtime service CRUD and the raw MapLibre escape hatch warning.

Add one canonical runnable online-map-services example. It contains at least
one emap business layer, more than one mutually exclusive basemap choice, and
two overlays that may be enabled together. The example demonstrates the
separate `BasemapControl` and unified `LayerControl` presentation. Automated
tests validate its configuration and UI contract without fetching remote
tiles; real providers are checked manually in the browser example.

## Verification

Completion requires fresh successful runs of:

1. Focused manager, basemap control, layer control, emap layer-event, and
   compatibility tests.
2. TypeScript type checking, including public type-contract fixtures.
3. Formatting checks.
4. The complete Vitest suite.
5. Production build and documentation/API checks affected by new exports.
6. The runnable example in a browser, verifying actual XYZ/WMS/WMTS requests,
   basemap switching, overlay persistence, canvas order, and cleanup.
7. GitNexus `detect_changes` to confirm the implementation affects only the
   MapLibre service, control, map lifecycle/event, documentation, and example
   flows expected by this design.

## Success Criteria

- A map can register native MapLibre basemap and overlay service definitions
  at construction time or runtime.
- Exactly zero or one basemap is active, while several overlays can be visible.
- Switching or updating the basemap preserves every selected overlay.
- The MapLibre canvas contains both basemap and overlay content and remains
  below the complete emap canvas.
- `BasemapControl` presents basemaps only; `LayerControl` presents emap layers
  and online overlays together in the approved fixed groups.
- Runtime CRUD, API calls, and both controls observe one consistent state.
- Configuration, loading, rapid-switch, rollback, and teardown failures are
  deterministic and observable.
- Existing basemap callers remain source-compatible, and `defaultStyle`
  finally honors its documented purpose.
- No capabilities parser, cross-canvas ordering abstraction, or unrelated
  rendering refactor is introduced.
