---
id: selection
slug: /guides/selection
title: Selection
api: ["BoxSelectHandler", "BoxSelectHandlerOptions", "BoxSelectStyle", "ClickSelectHandler", "DragPanHandler", "DragPanOptions", "DrawFeatureHandler", "DrawFeatureOptions", "DrawGeometryType", "Emap", "featureMatchesLasso", "LassoSelectHandler", "LassoSelectHandlerOptions", "LassoSelectStyle", "MergeSelectedOptions", "ModifierCombo", "pointInPolygon", "resolveMode", "ScrollZoomHandler", "ScrollZoomOptions", "SelectHandlerOptions", "Selection", "SelectionDiff", "SelectionSnapshot", "SelectMode", "TransformFeatureHandler", "TransformFeatureOptions", "VertexEditHandler", "VertexEditOptions", "FeatureQuery"]
examples: ["box-select","feature-rotate-scale","feature-selection","feature-translate","lasso-select","merge-selected"]
stability: stable
verifiedVersion: 0.12.0
---

# Selection

Emap identifies a selected feature by `{ source, layer, id }`. `source` is the map source ID, `layer` is the layer name inside that source, and `id` is the feature index in that layer.

## Use the selection API

`select()` replaces selection by default; `add` adds and `toggle` changes membership. Query results can be passed directly to `select()`.

```ts
map.select([{ source: 'parcels', layer: 'lots', id: 42 }]);

const hits = map.queryFeatures([240, 160], { layers: ['lots'] });
map.select(hits, { mode: 'add' });

map.deselect([{ source: 'parcels', layer: 'lots', id: 42 }]);
map.clearSelection();
const selected = map.getSelection();
```

The `layers` filter for `queryFeatures()` matches source-layer names or IDs, same as selection references and feature-event filters. The query scope already covers only source layers behind visible render layers, so `layers` rarely needs to restate visibility.

## Enable click, box, or lasso selection

These handlers start disabled. Use `setOptions()` to limit the source layers that participate or configure modifiers, then enable one:

```ts
map.clickSelect.setOptions({
  layers: ['lots'],
  modifiers: { replace: 'none', add: 'shift', toggle: 'shift+alt' },
});
map.clickSelect.enable();

map.boxSelect.setOptions({ layers: ['lots'], dragActivator: 'shift' });
map.boxSelect.enable();
```

`boxSelect` and `lassoSelect` both consume drag gestures and cannot be enabled together. Disable the active handler before switching:

```ts
map.boxSelect.disable();
map.lassoSelect.setOptions({ layers: ['lots'], includeIntersecting: true });
map.lassoSelect.enable();
```

## Listen for selection changes

When the set changes, `selectionchange` provides the full selection, added refs, and removed refs:

```ts
map.on('selectionchange', ({ selected, added, removed }) => {
  const selectionUpdate = { selected, added, removed };
});
```

Run bulk data operations through `map.ops` so the map can update selection, spatial indexes, and rendering.

## Runnable examples

- [Feature selection](/mapseekai/emap/examples/feature-selection/)
- [Box selection](/mapseekai/emap/examples/box-select/)
- [Lasso selection](/mapseekai/emap/examples/lasso-select/)
