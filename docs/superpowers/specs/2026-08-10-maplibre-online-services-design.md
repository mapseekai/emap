# MapLibre Online Map Services Design

**Date:** 2026-08-10
**Status:** Approved in conversation; implementation details refined during
planning review on 2026-08-11

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
  The existing Web Mercator alignment contract remains in force: first
  activation may reproject emap to Web Mercator, and a later external
  projection change suspends the MapLibre canvas until emap returns to Web
  Mercator or the caller explicitly activates a previously inactive service.

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

The Emap stylesheet contains only the structural MapLibre canvas rules needed
for this managed, non-interactive map. Applications that use raw MapLibre
controls, popups, or markers through the escape hatch must also import
`maplibre-gl/dist/maplibre-gl.css`.

The manager listens for later emap CRS changes. Moving away from Web Mercator
hides and suspends the MapLibre container without changing registered service
intent or active/status state. Returning to Web Mercator reveals, resizes, and
resynchronizes the existing MapLibre map. This prevents knowingly misaligned
canvases without treating a projection change as a service removal. While
suspended, an inactive-to-active service transition explicitly calls the same
Web Mercator preparation and resumes rendering. Same-value visibility calls
remain no-ops; hiding/removing services and updating an already-active service
may mutate the hidden MapLibre runtime but do not force a reprojection or
reveal the container. Their promises settle when those hidden-runtime changes
finish.

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
the active basemap style. A native `background` layer may omit `source`;
otherwise, every source referenced by an overlay layer must be declared by
that same overlay service. Cross-service source dependencies are not supported
because they make atomic update and removal ambiguous.

Layer array order is preserved inside one overlay. Overlay services are
applied in service registration order, using MapLibre's `beforeId` argument
when a previously hidden or updated overlay is reinserted. Updating a service
preserves its registry position and current active state; the replacement
definition's `visible` value does not toggle it. `visible` is initial/add
intent only. Changing a service's `role`, or replacing id `A` with a
definition whose `id` is not `A`, is rejected; callers remove and re-add the
service for either identity change.

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

The style supplied to the `maplibregl.Map` constructor is registered as the
first in-flight style operation. Constructor startup, ordinary basemap
switches, blank-style transitions, and recovery all pass through one
serialized style coordinator; a constructor `style.load` can never be
mistaken for a later switch.

Before the first visible MapLibre service is applied, the manager preserves
the current basemap alignment behavior by awaiting
`emap.reproject('webmercator')` when the emap CRS is not Web Mercator. This is
an emap/MapLibre camera alignment step, not protocol conversion. All service
source, tile, and style projection behavior remains MapLibre's responsibility.

### Basemap switching

`setBasemap(id)` validates that `id` names a basemap and records the desired
selection. A monotonic style revision identifies the current request. Only
one actual style load runs at a time; a newer desired revision supersedes the
older public promise with `AbortError`, and an older terminal event cannot
commit UI or service state.

At supersession time, the old selected basemap becomes
`{ active: false, status: 'idle' }`, clears any prior error, and emits that
snapshot in its inactive `basemap` change before the new selection's active
change. This includes an old target that was still loading. Its later physical
terminal event is silent, so no service can remain stuck in loading after it
has been superseded.

Because manager events dispatch synchronously, each selection first allocates
and installs its complete desired revision/request and commits the old/new
state snapshots before emitting anything. After every event callback returns,
the caller rechecks that its revision is still desired before emitting the
next event or starting physical style work. A listener that synchronously
selects a newer basemap therefore wins without the outer call overwriting it.

If an obsolete physical style load reports an error after a newer revision is
desired, the manager terminates and detaches that obsolete load, emits no
service error/change events for it, and starts the newest request. Failure
state and recovery are committed only when the failing applied revision still
equals the desired revision.

Immediately before every actual base, blank, or recovery `setStyle()` call,
the manager removes all manager-owned overlay layers in reverse visual order,
then their sources, and invalidates their ownership handles. This deliberate
detach step avoids relying on MapLibre's style-diff object reuse semantics.
After it, any source or layer id already present in the newly loaded basemap
is base-owned and is therefore a deterministic collision with an overlay.

At the matching `style.load`, the manager reconciles every visible overlay in
registry order through the same per-service serialized reconciliation path
used by public overlay calls:

1. Add each missing source.
2. Add each missing layer in declared and service registration order, using
   `beforeId` when reinserting ahead of later overlays.
3. Reject an id already supplied by the loaded base style as a transactional
   source or layer collision.
4. Mark the basemap and successfully reconciled overlays ready.

This produces the same managed result whether MapLibre internally performs a
style diff or a full rebuild. Managed overlay persistence comes from explicit
detach/reinstall, not from assumptions about objects MapLibre may preserve.
The coordinator exposes the generation internally as parsed for this
reconciliation, but publishes it to public-operation waiters as stable only
after reconciliation finishes. Overlay calls already waiting for it join or
observe the same per-service job instead of attempting duplicate
`addSource()`/`addLayer()` mutations.

The coordinator rechecks the desired style revision again after all overlay
jobs settle. A selection made during reconciliation invalidates those jobs,
prevents the parsed generation from becoming stable or committing ready
state, and immediately advances to the newest desired style.

`setBasemap(null)` selects no basemap. If overlays remain visible, the blank
style is installed and the overlays are reconciled. If no overlay remains,
the MapLibre container is hidden. Removing the active basemap has the same
result and does not silently select another registered basemap. Once this
no-basemap state commits, it clears the recovery candidate; a later failed
selection recovers to blank rather than resurrecting a basemap that preceded
the user's successful no-basemap choice.

### Overlay mutations

Showing an overlay adds its sources and layers through MapLibre. Hiding it
removes layers in reverse order and removes its now-unreferenced sources.
Removing a service first removes its active resources and then deletes its
registry entry.

Updating an inactive service replaces its definition after validation.
Updating an active overlay removes the old resources and applies the new
definition transactionally. Updating the active basemap is equivalent to
setting its replacement style and following the normal style-load path.

The latest request wins during rapid changes. In addition to the global style
revision, every overlay record has its own operation revision. Overlay work
waits until the current desired style is stable, captures that ready style
generation, and rechecks both the service revision/intent and style generation
after every asynchronous boundary and before committing a resource mutation.
If only the style generation changes, the still-current overlay operation
waits for the new stable generation and reconciles there; if its own service
revision is superseded, its promise rejects with `AbortError`. Dynamic import,
reprojection, initial-style readiness, installation, update, hide, and remove
therefore cannot write into an obsolete or in-flight style.

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
- An explicit legacy configuration (`styles` or `defaultStyle`) and an existing
  map-level service configuration are rejected as a configuration conflict
  instead of being merged implicitly. With an empty registry,
  `{ defaultStyle }` without `styles` selects from the built-in legacy list.
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
removed, moved, or shown/hidden, and when source loading/removal changes the
generated effective layer list. Its payload contains the reason (`add`,
`remove`, `visibility`, or `effective`), an optional affected layer id, and the
current `getRenderedLayers()` snapshot. Move and generated-list changes use
`effective`. The control subscribes on `onAdd()` and fully detaches on
`onRemove()`.

## Events and Error Handling

The manager extends `EventDispatcher` and publishes typed `change` and `error`
events. A change includes the service id, role, new runtime state, and the
reason (`add`, `update`, `remove`, `basemap`, `visibility`, or `status`). A
basemap selection emits the previous service's inactive `basemap` change
before the new service's active change; selecting `null` emits only the
previous service change. An error includes the service id when known, a phase
(`style`, `source`, `layer`, `tile`, or `lifecycle`), the original error, and
whether the failure is fatal for the service.

All events are post-mutation snapshots. Any manager method that continues
after a synchronous `fire()` rechecks its operation/style revision first;
event-listener reentrancy cannot resume an obsolete mutation.

Validation rejects:

- Duplicate service IDs.
- Unknown service IDs.
- Calling a basemap operation on an overlay or an overlay operation on a
  basemap.
- Role or id changes through `updateService()`.
- Duplicate overlay source or layer IDs.
- Overlay layers, except source-free native background layers, whose source is
  not declared by the same service.
- Invalid `defaultBasemap` references.

Applying an overlay is transactional. If one source or layer fails, the
manager removes only the layers and sources added for that attempt, restores
the previous definition when updating, and leaves other services untouched.
An active-overlay update emits the fatal failure and rejects its promise; if
the old definition and resources are restored successfully, it emits the
restored `update` plus loading/ready status changes and finishes
`active: true, status: 'ready'`. Only a failed rollback leaves that service in
final `error` state.

If a new basemap style fails before `style.load`, the manager marks that
basemap inactive with final status `error`, emits its fatal `error`, `status`,
and inactive `basemap` changes, and rejects the matching public request. It
then attempts to restore the last successfully loaded basemap only when the
registry still contains the same service id at the same definition revision.
Deleting or updating that inactive record invalidates the recovery candidate;
the manager must not resurrect it or load an unproven replacement. A valid
recovery emits that service's active `basemap` change, moves it through
`loading` to `ready`, and reconciles visible overlays. Without a valid
candidate, the manager installs the blank style, leaves every basemap
inactive, and reconciles visible overlays without inventing a service change
for the blank style. Recovery never converts the failed caller's rejected
promise into a success.

Definition revisions come from one manager-wide monotonically increasing
counter on every add or update, so removing and re-adding the same service id
cannot accidentally validate an older recovery candidate. A successful
active-update rollback restores the retained old definition revision while
advancing its operation token to invalidate replacement work.

An active-basemap update is the same transaction with one identity: the old
definition and its definition revision are retained until the replacement
style commits. If the replacement fails, the service emits the same
error/inactive transition, the retained record is restored before recovery
candidate validation, and recovery moves that same service id back through
active/loading to final `ready`. In this case the failure remains observable
in the event sequence and rejected update promise, while the final registry
state correctly describes the restored definition rather than retaining
`error`.

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
- Managed-overlay detachment before every style change and deterministic
  restoration in both MapLibre diff-preserving and full-rebuild simulations.
- Base-style source/layer collisions after managed overlay detachment.
- Rapid basemap switching, stale callback rejection, and `AbortError`.
- A stale physical style error after a newer selection produces no stale
  service-state events.
- Overlay operation revisions across show/hide/add/update/remove races.
- Overlay show/update racing a basemap switch applies only to the newest stable
  style generation.
- Add, update, remove, show, and hide before and after MapLibre creation.
- Transactional overlay rollback without disturbing sibling services.
- Failed basemap recovery states and change ordering for the previous
  successful basemap or blank style.
- Deleted or definition-revised recovery candidates fall back to blank.
- Active overlay/base update rollback final states and rejected promises.
- Fatal configuration errors versus non-fatal tile errors.
- Raw MapLibre getter behavior before and after initialization.
- Camera synchronization, Web Mercator preparation, CRS suspension, and
  restoration.
- Suspended no-op/deactivation/update behavior versus explicit reactivation.
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
