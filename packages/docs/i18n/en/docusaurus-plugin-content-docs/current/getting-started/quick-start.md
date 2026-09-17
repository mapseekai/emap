---
id: quick-start
slug: /getting-started/quick-start
title: Your first map
api: ["Emap", "TopologySource", "LayerSpecification"]
examples: ["getting-started/geojson-viewer"]
stability: stable
verifiedVersion: 0.12.0
---

# Your first map

After [installation](./installation.md), create an interactive map with one GeoJSON source and two render layers.

```ts
import { Emap, TopologySource } from '@mapseekai/emap'; // import the map and data source
import '@mapseekai/emap/style.css'; // import map styles
const map = await Emap.create({ container: 'map', expressionPolicy: 'disabled' }); // create a safe interactive map
const source = await TopologySource.fromUrl('districts', '/data/districts.geojson'); // load GeoJSON
await map.addSource('districts', source); // register the data source
map.addLayer({
  id: 'district-fill',
  type: 'fill',
  source: 'districts',
  paint: { 'fill-color': '#60a5fa', 'fill-opacity': 0.45 },
}); // draw the fill
map.addLayer({
  id: 'district-outline',
  type: 'line',
  source: 'districts',
  paint: { 'line-color': '#1e3a8a', 'line-width': 1.5 },
}); // draw the outline
map.setExtent(source.getExtent()); // fit the data extent
```

## Core methods

| Method | Parameters | Description |
| --- | --- | --- |
| `Emap.create(options)` | `container`, `expressionPolicy` | Create the map. |
| `TopologySource.fromUrl(id, url)` | Source ID, data URL | Load GeoJSON. |
| `map.addSource(id, source)` / `map.addLayer(layer)` | Source ID, layer definition | Register and render data. |
| `map.setExtent(bounds)` | `Bounds` | Fit the view extent. |

## More setup and loading parameters

The map container must exist with a non-zero size:

```html
<div id="map" style="width: 100%; height: 480px"></div>
```

`Emap.create` returns after preset plugins are ready.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `container` | `string \| HTMLElement` | Required by browser presets | Container element or `id`; omit for `headless`. |
| `preset` | `'editor' \| 'viewer' \| 'headless' \| 'empty'` | `'editor'` | Editing, viewing, data-only processing, or empty plugin set. |
| `interactive` | `boolean` | `true` | Drag panning and scroll zooming. |
| `expressionPolicy` | `'disabled' \| 'trusted'` | `'disabled'` | mapshaper JavaScript-expression policy. |
| `plugins` / `excludePlugins` | `readonly Plugin[]` / `readonly string[]` | `[]` / `[]` | Add/replace or exclude preset plugins. |
| `authorizeCapability` | `CapabilityAuthorizer` | Unset | Host authorization for Agent capabilities. |

`fromUrl` resolves after its first `data` event and is ready to register.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` | Required | Source identifier. |
| `url` | `string` | Required | Data URL; extension or `Content-Type` selects format. |
| `options.formats` | `FormatRegistryContract` | New empty registry | Format-plugin registry. |
| `options.resourceLimits.maxInputBytes` | `number` | `2 GiB` | Raw-byte ceiling per import. |
| `options.zipLimits.maxCompressedBytes` | `number` | `2 GiB` | Shapefile ZIP compressed-input limit. |
| `options.zipLimits.maxBytes` | `number` | `2 GiB` | ZIP total uncompressed-size limit. |
| `options.zipLimits.maxEntries` | `number` | `5000` | ZIP entry-count limit. |
| `options.zipLimits.maxRatio` | `number` | `100` | ZIP maximum expansion ratio. |
| `options.adapter` | `MapshaperAdapter` | Default adapter | mapshaper execution adapter. |

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` | Required | Map-unique source ID. |
| `source` | `TopologySource` | Required | Loaded source; registration preflights and reprojects CRS. |
| `answers.sourceCrs` | `string` | Unset | CRS for data without CRS metadata. |

## More layer and view parameters

Later layers draw above earlier layers; `source` references a registered source ID.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `layer.id` / `layer.type` / `layer.source` | `string` / `'fill' \| 'line' \| 'circle'` / `string` | Required | Unique layer ID, renderer, and registered source ID. |
| `layer['source-layer']` | `string` | Unset | Source layer in the dataset. |
| `layer.paint` | `FillLayerPaint \| LinePaint \| CirclePaint` | Unset | Layer style. |
| `layer.layout.visibility` | `'visible' \| 'none'` | `'visible'` | Layer visibility switch. |
| `layer.filter` | `StyleExpression` | Unset | Rendering, picking, and attribute-view filter. |
| `layer.styleSource` | `'mapshaper'` | Unset | Baked `fill` or `stroke` fields. |
| `layer.pointLod` | `false \| { cellSize?: number }` | `{ cellSize: 8 }` | CSS-pixel grid thinning for `circle`. |
| `before` | `string` | Unset | Layer ID to insert before. |

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `'fill-color'` | `string \| StyleExpression` | Theme muted color | Fill color or expression. |
| `'fill-opacity'` | `number` | Color alpha retained | Fill opacity. |
| `'line-color'` | `string \| StyleExpression` | Theme primary color | Line color or expression. |
| `'line-width'` | `number` | `0.8` | Line width. |
| `'line-dasharray'` | `readonly number[]` | Solid line | Dash and gap lengths (CSS pixels). |
| `'line-dashstyle'` | `LineDashStyle \| StyleExpression` | `'solid'` | Named line style; `arrow-dot` supports arrows. |
| `'line-arrow-spacing'` | `number` | `32` | `arrow-dot` spacing (CSS pixels). |
| `'line-arrow-size'` | `number` | `6` | `arrow-dot` wing length (CSS pixels). |
| `'circle-color'` | `string \| StyleExpression` | Theme primary color | Marker color or expression. |
| `'circle-radius'` | `number` | `4` | Marker radius (CSS pixels). |
| `'circle-fill'` | `boolean` | `true` | Marker fill switch. |
| `'circle-shape'` | `PointMarkerShape \| StyleExpression` | `'circle'` | Marker shape or expression. |

| Method / parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `map.setExtent(bounds).bounds` | `Bounds` | Required | View data extent. |
| `map.fitBounds(bounds, options).bounds` | `Bounds` | Required | Extent to center and scale. |
| `options.padding` | `number` | `0` | Side inset in CSS pixels. |
| `options.maxScale` | `number` | Unset | Maximum fitted scale. |
| `options.duration` / `easing` / `animate` | `number` / `(t: number) => number` / `boolean` | `1000` ms / `Tween.sineInOut` / `true` | Fit animation duration, easing, and switch. |

## More local data and disposal

User files load through `fromBytes`, which identifies format from the filename:

```ts
const file = input.files?.[0];
if (!file) throw new Error('Choose a file first');

const source = await TopologySource.fromBytes('upload', await file.arrayBuffer(), {
  filename: file.name,
});
await map.addSource('upload', source);
```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` | Required | Source ID. |
| `bytes` | `Uint8Array \| ArrayBuffer` | Required | Raw file bytes. |
| `options.filename` | `string` | `` `${id}.geojson` `` | Extension selects importer. |
| `options.formats`, `resourceLimits`, `zipLimits`, `adapter` | Same as `fromUrl` | Same as `fromUrl` | Inherits `fromUrl` options. |

Tighten `zipLimits` for public uploads; see [Sources and layers](../concepts/source-layer.md). Wait for `dispose()` before removing the host view:

```ts
await map.dispose();
```

## Next steps

- [Concepts overview](../concepts/overview.md)
- [Styling](../guides/styling.md)
- [Editing](../guides/editing.md)

## Runnable examples

- [GeoJSON viewer example](/mapseekai/emap/examples/getting-started/geojson-viewer/)
