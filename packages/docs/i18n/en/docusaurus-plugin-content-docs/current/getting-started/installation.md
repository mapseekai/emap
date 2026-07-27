---
slug: /getting-started/installation
title: Installation
---

# Installation

Install emap with your package manager:

```bash
pnpm add @zwishing/emap
```

Import the stylesheet at your application entry point and provide a sized map container:

```ts
import { Emap, TopologySource } from '@zwishing/emap';
import '@zwishing/emap/style.css';
```

```html
<div id="map"></div>
```

```css
html,
body,
#map {
  width: 100%;
  height: 100%;
  margin: 0;
}
```

Create the map, load a source, and fit the view to the data extent:

```ts
const map = new Emap({ container: 'map' });

const response = await fetch('/data/china.geojson');
const content = await response.text();
const source = new TopologySource('china');

await source.setData({ filename: 'china.geojson', content });
map.addSource('china', source);
map.setExtent(source.getExtent());
```

`source.setData(...)` waits for the dataset to load. `map.addSource(...)` registers the source with the map, and `map.setExtent(...)` sets the initial view from the source bounds.
