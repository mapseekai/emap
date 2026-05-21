# emap Feature Overview

This document lists the current public capabilities of `emap`. It complements
the quick-start focused [README.md](README.md).

## 1. Runtime and Packaging

- Browser-only TypeScript library.
- Framework-agnostic: usable from vanilla HTML, React, Vue, Svelte, Angular, or
  any other browser app.
- IIFE and ESM builds.
- Self-contained browser bundler path with Mapshaper supplied as package
  sibling bundles.
- Optional worker bundle for off-thread dataset operations.
- Public CSS entry: `@zwishing/emap/style.css`.

## 2. Public API Stability

Recommended stable integration surface:

- `Emap`
- `TopologySource`
- map source/layer/camera APIs
- named handlers exposed on `map.*`
- feature events and typed map events
- `map.ops.*`
- `map.features`, `map.validators`, `map.editSession`
- built-in controls
- documented types exported from the package root

Advanced but less stable surfaces:

- `HandlerManager`
- concrete handler classes
- `CanvasPainter` and `EditOverlayRenderer`
- `MapshaperAdapter` replacement hooks
- edit command classes
- raw Mapshaper topology types

These advanced exports are useful for custom integrations and tests, but they
may change faster than the main `Emap` and `TopologySource` API while the
project is still pre-production.

## 3. Data Sources

Supported inputs:

| Input | Entry |
|---|---|
| GeoJSON | `TopologySource.fromUrl()`, `fromBytes()`, `setData()` |
| TopoJSON | `TopologySource.fromUrl()`, `fromBytes()`, `setData()` |
| ZIP Shapefile | `TopologySource.fromUrl()`, `fromBytes()`, `setData()` |
| Mapshaper snapshot | `map.loadSnapshot()` |

Source capabilities:

- Awaitable loading contract: `setData()` resolves after data is ready.
- Order-independent `map.addSource()`.
- CRS inference from GeoJSON defaults and Shapefile `.prj`.
- ZIP extraction limits for archive count, decompressed size, and ratio checks.
- `getLayers()`, `getDataset()`, `getExtent()`, `getArcs()`, and export helpers.
- `DisplayArcs` LOD wrapper for large datasets.

## 4. Layers and Rendering

Layer types:

- `line`
- `fill`
- `circle`

Layer APIs:

- `map.addLayer(layer, before?)`
- `map.removeLayer(id)`
- `map.getLayer(id)`
- `map.getLayers()`
- `map.moveLayer(id, beforeId?)`
- `map.setLayerVisibility(id, visibility)`
- `map.setPaintProperty(id, name, value)`

Rendering capabilities:

- HTML5 Canvas 2D renderer.
- Batched stroke drawing for topology arcs.
- Shared-arc line rendering so polygon boundaries can be drawn once.
- Polygon fill rendering with even-odd fill handling.
- Point rendering.
- Highlight overlay rendering.
- Edit and draw overlay rendering.

## 5. Camera and View

Camera methods:

- `jumpTo()`
- `setCenter()`
- `setZoom()`
- `easeTo()`
- `flyTo()`
- `panTo()`
- `panBy()`
- `zoomTo()`
- `fitBounds()`
- `stop()`

View and coordinate methods:

- `getCenter()`
- `getZoom()`
- `getExtent()`
- `setExtent()`
- `reset()`
- `project()`
- `unproject()`
- `resize()`

Camera events:

- `movestart`
- `move`
- `moveend`
- `zoomstart`
- `zoom`
- `zoomend`

## 6. Named Interaction Handlers

`emap` exposes built-in interactions as named handlers. Third-party apps can use
these directly without using bundled UI controls.

| Handler | Purpose |
|---|---|
| `map.dragPan` | Pointer drag map panning |
| `map.scrollZoom` | Wheel zoom |
| `map.clickSelect` | Click selection |
| `map.boxSelect` | Shift-drag rectangular selection |
| `map.lassoSelect` | Free-form lasso selection |
| `map.vertexEdit` | Topology-aware vertex editing |
| `map.drawFeature` | Point, polyline, and polygon drawing |
| `map.transformFeature` | Translate, rotate, or scale selected features |

Uniform handler surface:

- `enable()`
- `disable()`
- `isEnabled()`
- `setOptions()`
- `getOptions()`
- `handlePointer()`
- optional `getCursor()`

`HandlerManager` arbitrates pointer events with priority ordering, exclusive
gesture locking, and cursor resolution.

## 7. Selection, Hit Testing, and Feature Events

Selection APIs:

- `map.select(features, { mode })`
- `map.deselect(features)`
- `map.clearSelection()`
- `map.getSelection()`
- `map.isSelected(feature)`
- `map.deleteSelected()`

Selection modes:

- `replace`
- `add`
- `toggle`

Feature querying:

- Point query: `map.queryFeatures([x, y], options?)`
- BBox query: `map.queryFeatures([[x1, y1], [x2, y2]], options?)`
- Layer filtering through `{ layers: [...] }`
- Lazy Flatbush spatial indexes.
- `map.prebuildSpatialIndex(sourceId?)`
- `map.clearSpatialIndex(sourceId?)`

Delegated events:

- `feature:click`
- `feature:hover`
- `feature:enter`
- `feature:leave`
- `mousemove`

Feature accessor:

- `map.features.get(ref)`
- `map.features.iter(sourceId, layerId)`
- `map.features.count(sourceId, layerId)`

Highlighting:

- `map.setHighlightedFeatures(features, style?)`
- `map.clearHighlightedFeatures()`
- `map.setHighlightStyle(style)`

## 8. Editing Model

Undoable command families:

- Vertex commands: `VertexMoveCommand`, `VertexInsertCommand`,
  `VertexDeleteCommand`.
- Feature commands: `FeatureCreateCommand`, `FeatureDeleteCommand`,
  `BulkFeatureDeleteCommand`, `FeatureTranslateCommand`, `FeatureAffineCommand`.
- Topology commands: `SplitSharedArcsCommand`.
- Dataset replace: `DatasetReplaceCommand`.
- Attribute and schema commands: `FeaturePropertyChangeCommand`,
  `FieldAddCommand`, `FieldRemoveCommand`, `FieldRenameCommand`.
- Multi-command envelope: `CompositeCommand`.

Session editing:

- `map.editSession.translateSelected(dx, dy)`
- `map.editSession.rotateSelected(angle, origin?)`
- `map.editSession.scaleSelected(sx, sy?, origin?)`
- `map.editSession.beginTranslateSession(options?)`
- `map.editSession.beginAffineSession(matrix?, origin?)`

Transactions:

- `map.beginTransaction()`
- `tx.commit(label?)`
- `tx.rollback()`

Undo/redo:

- `map.undo()`
- `map.redo()`
- `map.canUndo()`
- `map.canRedo()`
- `map.clearHistory()`
- `map.bindHistoryShortcuts()`

## 9. Mapshaper Operations

All operations live under `map.ops` and return `Promise<OpResult>`.

Geometry and topology:

- `clipLayer`
- `eraseLayer`
- `dissolveLayer`
- `bufferLayer`
- `simplifyLayer`
- `projectLayer`
- `affineLayer`
- `cleanLayer`
- `snapLayer`
- `rebuildTopology`
- `checkGeometry`

Set and overlay operations:

- `mosaicLayer`
- `unionLayers`
- `divideLayer`
- `intersectionPointsLayer`

Geometry conversion:

- `pointsLayer`
- `linesLayer`
- `polygonsLayer`
- `innerlinesLayer`
- `explodeLayer`

Layer management:

- `renameLayer`
- `mergeLayers`
- `splitLayer`
- `dropLayer`

Filtering and attributes:

- `applyExpression`
- `filterFeatures`
- `filterIslands`
- `filterSlivers`
- `filterGeom`
- `sortFeatures`
- `uniqueFeatures`
- `filterFields`
- `renameFields`
- `joinTable`
- `dataFill`

Selection-driven:

- `mergeSelected`

Operation runtime features:

- Parsed command objects instead of shell strings.
- Effect-aware selection preservation.
- Dataset-replace undo barriers.
- Optional worker routing.
- Structured `OpResult` and `OpError` responses.

## 10. Validation

Validator registry:

- `map.validators.register(validator)`
- returned unregister function
- `validationfailed` event

Built-in validator:

- `topologyValidator(options)`

Validation runs after committed history changes. The engine reports failures and
leaves application policy decisions to the host app.

## 11. Worker Offloading

Worker options:

- `useWorker: false | true | 'auto'`
- `workerMode` compatibility alias
- `workerThreshold`
- `workerUrl`
- `workerPoolSize`
- `workerPool`
- `workerRouting(info)`

Worker features:

- Lazy worker creation.
- Multiple worker instances through `MapshaperWorkerPool`.
- Command-family-aware routing.
- Cancellation through `map.cancelWorkerJobs()`.
- Transferable arc buffers where supported by the Mapshaper pack/unpack path.

## 12. Snapshots and Export

Map snapshot APIs:

- `map.exportSnapshot(options?)`
- `map.loadSnapshot(input, options?)`

Source export formats:

- GeoJSON
- TopoJSON
- Shapefile ZIP

Snapshots use Mapshaper pack data with `emap` source metadata for multi-source
restore.

## 13. Built-In Controls

| Control | Purpose |
|---|---|
| `NavigationControl` | Zoom in, zoom out, reset |
| `StatusControl` | Pointer coordinates and CRS |
| `BasemapControl` | MapLibre raster basemap toggle |
| `HistoryControl` | Undo/redo |
| `EditToolbar` | Combined edit toolbar |
| `VertexEditControl` | Button shell over `map.vertexEdit` |
| `DrawFeatureControl` | Button shell over `map.drawFeature` |
| `BoxSelectControl` | Thin shell over `map.boxSelect` |
| `LassoSelectControl` | Thin shell over `map.lassoSelect` |
| `SimplifyControl` | Simplification UI |

Custom controls implement:

- `onAdd(map): HTMLElement`
- `onRemove(map?)`

Control positions:

- `top-left`
- `top-right`
- `bottom-left`
- `bottom-right`

## 14. Events

Typed map events include:

- `data`
- `error`
- `selectionchange`
- `historychange`
- `editmodechange`
- `validationfailed`
- `crschange`
- `resize`
- camera lifecycle events

`EmapEventMap` is augmentable through TypeScript module augmentation for
application-specific events.

## 15. CRS and Geometry Utilities

Exports:

- `Bounds`
- `AffineTransform`
- `Viewport`
- `Projection`
- `DEFAULT_CRS`
- `inferFromPrj`
- `normalizeCrsString`
- `resolveDatasetCRS`

Mapshaper topology types are also exported for consumers that need to build
custom commands or inspect raw datasets.

## 16. Public Advanced Surfaces

Advanced exports include:

- `DefaultMapshaperAdapter`
- `getDefaultMapshaperAdapter`
- `setDefaultMapshaperAdapter`
- `MapshaperWorkerPool`
- `HandlerManager`
- built-in handler classes
- `CanvasPainter`
- `EditOverlayRenderer`
- edit command classes
- `ValidatorRegistry`
- `Err`, `OK`, and `okValue`
- layer paint resolvers
- CLI safety helpers: `quoteCliArg`, `isValidLayerName`, `isValidFieldName`

## 17. Security and Constraints

- Browser runtime only.
- No server dependency.
- Mapshaper internals are isolated behind `MapshaperAdapter`.
- Expression-bearing APIs default to `expressionPolicy: 'disabled'`.
- Apps must opt in to `expressionPolicy: 'trusted'` before executing trusted
  expression strings.
- Worker assets must be served by the host app when worker offloading is used.

## 18. Examples and Tests

- Manual examples: `test/examples/*.html`.
- Unit tests: `src/**/*.test.ts`.
- Type tests: `*.test-d.ts`.
- Build and verification:

```bash
cmd /c npm run typecheck
cmd /c npm run test:run
cmd /c npm run build
```
