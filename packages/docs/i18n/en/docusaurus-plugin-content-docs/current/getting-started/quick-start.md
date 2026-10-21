---
id: quick-start
slug: /getting-started/quick-start
title: Your first map
api: ["Emap", "TopologySource", "LayerSpecification"]
examples: ["getting-started/vector-file"]
stability: stable
verifiedVersion: 0.14.0
---

# Your first map

After [installation](./installation.md), draw a pannable map from one GeoJSON source and two layers.

The container needs a height:

```html
<div id="map" style="width: 100%; height: 480px"></div>
```

```ts
import { Emap, TopologySource } from '@mapseekai/emap';
import '@mapseekai/emap/style.css';

const map = await Emap.create({ container: 'map' });
const source = await TopologySource.fromUrl('districts', '/data/districts.geojson');
await map.addSource('districts', source);
map.addLayer({
  id: 'district-fill',
  type: 'fill',
  source: 'districts',
  paint: { 'fill-color': '#60a5fa', 'fill-opacity': 0.45 },
});
map.addLayer({
  id: 'district-outline',
  type: 'line',
  source: 'districts',
  paint: { 'line-color': '#1e3a8a', 'line-width': 1.5 },
});
map.setExtent(source.getExtent());
```

`districts` is the source ID. The fill and the outline are two layers reading the same data. Creation options, import limits, and layer fields live in [Core concepts](../concepts/overview.md) and [Styling](../guides/styling.md).

## Next

- [Map, source, and layer](../concepts/overview.md)
- [Styling](../guides/styling.md)
- [Editing](../guides/editing.md)

## Runnable example

- [Open a vector file](/mapseekai/emap/examples/getting-started/vector-file/)
