---
id: selection
slug: /guides/selection
title: Selection
api: ["BoxSelectHandler", "BoxSelectHandlerOptions", "BoxSelectStyle", "ClickSelectHandler", "DragPanHandler", "DragPanOptions", "DrawFeatureHandler", "DrawFeatureOptions", "DrawGeometryType", "Emap", "featureMatchesLasso", "LassoSelectHandler", "LassoSelectHandlerOptions", "LassoSelectStyle", "MergeSelectedOptions", "ModifierCombo", "pointInPolygon", "resolveMode", "ScrollZoomHandler", "ScrollZoomOptions", "SelectHandlerOptions", "Selection", "SelectionDiff", "SelectionSnapshot", "SelectMode", "TransformFeatureHandler", "TransformFeatureOptions", "VertexEditHandler", "VertexEditOptions", "FeatureQuery"]
examples: ["box-select","feature-rotate-scale","feature-selection","feature-translate","lasso-select","merge-selected"]
stability: stable
verifiedVersion: 0.13.0
---

# Selection

Emap identifies selected features by `{ source, layer, id }`; a selection can span sources and source layers.

```ts
const refs = [{ source: 'parcels', layer: 'lots', id: 42 }]; // identify features
map.select(refs, { mode: 'add' }); // add them to the selection
map.deselect(refs); // remove specified features
map.clearSelection(); // clear every selected feature
const selected = map.getSelection(); // read the current selection
```

## Core methods

### Feature references
`FeatureRef` is shared by selection methods and `selectionchange`:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `source` | `string` | Required | Map source ID. |
| `layer` | `string` | Required | Source-layer ID or name. |
| `id` | `number` | Required | Feature index within the layer. |

### Mutate and read


`select(features, options?)`:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `features` | `ReadonlyArray<FeatureRef>` | Required | References to add, replace, or toggle; deduplicated per call. |
| `options.mode` | `SelectMode` | `'replace'` | `'replace'` replaces, `'add'` unions, `'toggle'` flips membership. |

Remaining methods:

| API | Signature | Description |
| --- | --- | --- |
| `deselect` | `(features: ReadonlyArray<FeatureRef>) => void` | Removes supplied references. |
| `clearSelection` | `() => void` | Clears every selection. |
| `getSelection` | `() => FeatureRef[]` | References in source, layer, and insertion order. |

`queryFeatures()` accepts source-layer IDs or names in `layers`; without it, queries cover layers behind visible render layers.

## More selection gestures

All three handlers start disabled and share:

| API | Signature | Description |
| --- | --- | --- |
| `enable()` / `disable()` | `handler.enable(): void` | Enables the gesture (box and lasso show a crosshair) / disables the gesture and active preview. |
| `isEnabled` | `handler.isEnabled(): boolean` | Current enabled state. |
| `setOptions` | `handler.setOptions(options: Partial<Options>): void` | Shallow-merges top-level configuration; `modifiers` and `style` replace wholesale. |
| `getOptions` | `handler.getOptions(): Readonly<Options>` | Current merged configuration. |

`SelectHandlerOptions` provides scope and modifier configuration:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `layers` | `string[]` | `undefined` (all visible source layers) | Source-layer IDs or names participating in hits. |
| `source` | `string` | `undefined` | Reserved source identifier; `layers` controls query scope. |
| `modifiers` | `Partial<Record<SelectMode, ModifierCombo>>` | Per handler, below | Maps to `'replace'`, `'add'`, or `'toggle'`; unmatched combinations use `'replace'`. |

`ModifierCombo` is `'none'` or values joined in `shift+ctrl+alt+meta` order; `meta` equals `ctrl`.

### Click selection

`map.clickSelect` handles primary-button clicks: hits write selection by mode, blank `'replace'` clicks clear it. Defaults: `replace: 'none'`, `add: 'shift'`, `toggle: 'shift+alt'`.

```ts
map.clickSelect.setOptions({
  layers: ['lots'],
  modifiers: { replace: 'none', add: 'shift', toggle: 'shift+alt' },
});
map.clickSelect.enable();
```


### Box selection

`map.boxSelect` draws a rectangle with a primary-button drag and queries its pixel bounding box. Defaults: `replace: 'none'`, `add: 'shift'`, `toggle: 'shift+alt'`.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `dragThreshold` | `number` | `4` | Minimum drag diagonal in CSS pixels. |
| `dragActivator` | `ModifierCombo` | `'none'` | Combination required on primary-button down. |
| `style` | `BoxSelectStyle` | See below | Rectangle preview styling. |

Mode matching removes `dragActivator` from the release combination before looking up `modifiers`.

| `style` parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `stroke` | `string` | Current theme primary color | Dashed border color. |
| `strokeWidth` | `number` | `1.5` | Border width in CSS pixels. |
| `fill` | `string` | `'transparent'` | Rectangle fill. |

```ts
map.boxSelect.setOptions({
  layers: ['lots'],
  dragActivator: 'shift',
  modifiers: { replace: 'none', add: 'ctrl', toggle: 'alt' },
});
map.boxSelect.enable();
```

### Lasso selection

`map.lassoSelect` closes a free-form drag into a polygon: it queries by bounding box, then filters by lasso. Default activator: `'shift'`; defaults: `replace: 'none'`, `add: 'ctrl'`, `toggle: 'alt'`.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `dragThreshold` | `number` | `4` | Minimum lasso bounding-box diagonal in CSS pixels. |
| `dragActivator` | `ModifierCombo` | `'shift'` | Combination starting the lasso with the primary button. |
| `includeIntersecting` | `boolean` | `true` | `true` selects intersecting features; `false` selects contained features only. |
| `style` | `LassoSelectStyle` | See below | SVG lasso preview styling. |

| `style` parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `stroke` | `string` | Current theme primary color | Polyline color. |
| `strokeWidth` | `number` | `1.5` | Polyline width in CSS pixels. |
| `fill` | `string` | `'none'` | Closed-area fill. |
| `strokeDasharray` | `string` | `'4 3'` | SVG dash pattern. |

Box and lasso selection share a drag gesture; disable the active handler before switching:

```ts
map.boxSelect.disable();
map.lassoSelect.setOptions({ layers: ['lots'], includeIntersecting: true });
map.lassoSelect.enable();
```

## Listen for selection changes

All three handlers write through `map.select()`; subscribe to `selectionchange` for mutations from calls and gestures:

```ts
map.on('selectionchange', ({ selected, added, removed }) => {
  const selectionUpdate = { selected, added, removed };
});
```

| Event field | Type | Description |
| --- | --- | --- |
| `selected` | `FeatureRef[]` | Complete selection after the mutation. |
| `added` | `FeatureRef[]` | References added by this mutation. |
| `removed` | `FeatureRef[]` | References removed by this mutation. |

Run bulk data operations through `map.ops` to update selection, spatial indexes, and rendering.

## Runnable examples

- [Feature selection](/mapseekai/emap/examples/feature-selection/)
- [Box selection](/mapseekai/emap/examples/box-select/)
- [Lasso selection](/mapseekai/emap/examples/lasso-select/)
