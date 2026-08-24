---
id: selection
slug: /guides/selection
title: Selection
api: ["BoxSelectHandler","BoxSelectHandlerOptions","BoxSelectStyle","ClickSelectHandler","DragPanHandler","DragPanOptions","DrawFeatureHandler","DrawFeatureOptions","DrawGeometryType","Emap","featureMatchesLasso","LassoSelectHandler","LassoSelectHandlerOptions","LassoSelectStyle","LassoStyle","MergeSelectedOptions","ModifierCombo","pointInPolygon","resolveMode","ScrollZoomHandler","ScrollZoomOptions","SelectHandlerOptions","Selection","SelectionDiff","SelectionSnapshot","SelectMode","TransformFeatureHandler","TransformFeatureOptions","VertexEditHandler","VertexEditOptions"]
examples: ["box-select","feature-rotate-scale","feature-selection","feature-translate","lasso-select","merge-selected"]
stability: stable
verifiedVersion: 0.5.0
---

# Selection

A selected feature is identified by `{ source, layer, id }`: `source` is a map
source ID, `layer` is a source-layer name inside the dataset, and `id` is the
feature index in that source layer. Selection state is independent from render
layer styling.

## Select through the API

Replace the current selection:

```ts
map.select([
  {
    source: 'main',
    layer: 'districts',
    id: 3,
  },
]);
```

The default mode is `'replace'`. Other modes are:

```ts
map.select(features, { mode: 'add' });
map.select(features, { mode: 'toggle' });
```

| Mode | Behavior |
|---|---|
| `replace` | Replace the complete set |
| `add` | Keep existing features and add new ones |
| `toggle` | Remove selected inputs and add unselected inputs |

Remove features or clear the set:

```ts
map.deselect([{ source: 'main', layer: 'districts', id: 3 }]);
map.clearSelection();
```

Read and test selection:

```ts
const selected = map.getSelection();
const active = map.isSelected({
  source: 'main',
  layer: 'districts',
  id: 3,
});
```

## Select query results

Objects returned by `queryFeatures` are structurally compatible with
`FeatureRef`:

```ts
const hits = map.queryFeatures([240, 180], {
  layers: ['district-fill'],
});

map.select(hits);
```

Here `queryFeatures.layers` uses render-layer IDs. The `layer` field in the
results is a source-layer name. Do not interchange them.

## Listen for changes

```ts
map.on('selectionchange', ({ selected, added, removed }) => {
  updateSelectionCount(selected.length);
  updatePropertyPanel(selected);
  console.log({ added, removed });
});
```

The event only fires when the set actually changes. Adding an already-selected
feature does not produce a redundant notification.

## Click, box, and lasso selection

Click selection is disabled by default:

```ts
map.clickSelect.setOptions({
  layers: ['district-fill'],
});
map.clickSelect.enable();
```

Disable it through the same Handler:

```ts
if (map.clickSelect.isEnabled()) {
  map.clickSelect.disable();
}
```

Switch box and lasso handlers explicitly:

```ts
map.boxSelect.enable();
map.lassoSelect.disable();
```

Or add the built-in controls:

```ts
map.addControl(new BoxSelectControl(), 'top-left');
map.addControl(new LassoSelectControl(), 'top-left');
```

Box, lasso, drawing, and editing are gesture-owning modes. Keep only the handler
needed by the current tool enabled so one pointer gesture has one meaning.

## Delete selected features

```ts
const deleted = map.deleteSelected();

if (deleted) {
  console.log('Deleted and undoable');
}
```

All deleted features form one history entry. One undo restores the complete
batch. Selection clears after success. An empty selection returns `false`
without adding history.

## Merge selected features

After selecting at least two features from one source and source layer, merge them into one:

```ts
const selected = map.getSelection();
const result = await map.ops.mergeSelected({
  attributeSource: selected[1],
});

if (!result.ok) {
  console.error(result.error.message);
}
```

Polygon features use a true geometric union: internal boundaries between adjacent or overlapping
parts are removed, while disconnected polygons become one multipart feature. `attributeSource`
must belong to the current selection and supplies the complete output record; omitting it uses the
first selected feature. Success clears the selection and creates one undoable and redoable history
entry.

## Selection and data operations

Data operations may change shape count, topology, attributes, or CRS. Emap uses
the operation effect to preserve, remap, or clear selection. Run bulk changes
through `map.ops`; otherwise feature IDs may become stale.

## Troubleshooting

- Feature-event filters use source-layer names; `queryFeatures.layers` uses
  render-layer IDs.
- Feature IDs are indexes and may shift after deletes or shape-count changes.
  Refresh cached references from events or a new query.
- Disabling a selection tool should not implicitly clear the selected result.
  Clear it only when that matches application intent.

## API

- [Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [Selection](/mapseekai/emap/api/classes/emap.Selection.html)
- [FeatureRef](/mapseekai/emap/api/interfaces/emap.FeatureRef.html)
- [MergeSelectedOptions](/mapseekai/emap/api/interfaces/emap.MergeSelectedOptions.html)
- [BoxSelectControl](/mapseekai/emap/api/classes/emap.BoxSelectControl.html)
- [LassoSelectControl](/mapseekai/emap/api/classes/emap.LassoSelectControl.html)

## Runnable examples

- [Feature selection](/mapseekai/emap/examples/feature-selection/)
- [Box selection](/mapseekai/emap/examples/box-select/)
- [Lasso selection](/mapseekai/emap/examples/lasso-select/)
- [Merge selected](/mapseekai/emap/examples/merge-selected/)
