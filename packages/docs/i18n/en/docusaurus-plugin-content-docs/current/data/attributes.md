---
id: attributes
slug: /data/attributes
title: Attributes
api: ["Emap", "Feature", "ApplyExpressionOptions", "JoinTableOptions", "CreateLayerOptions", "LayerFieldDefinition"]
examples: ["create-layer","attribute-editing","attribute-expressions","feature-attributes","join"]
stability: stable
verifiedVersion: 0.12.0
---

# Attributes

Emap stores each layer's attributes in a data table. A feature ID locates both its geometry and property record; use `map.features` to read and `map.attributes` or `map.ops` to modify them.

## Read properties

`queryFeatures()` queries by screen coordinate, while `map.features.get()` queries by source, layer, and ID:

```ts
const hits = map.queryFeatures([240, 180], {
  layers: ['districts'],
});

const feature = map.features.get({
  source: 'main',
  layer: 'districts',
  id: 3,
});

console.log(hits[0]?.properties, feature?.properties);
```

A `Feature` is a read view. Do not mutate `feature.properties` or source-dataset records directly; those changes bypass Emap's history, selection, and rendering updates.

## Layer display filtering

`map.setFilter(layerId, expression)` sets a display filter for a render layer. Expressions use the same
MapLibre subset as style expressions (`get / == != < <= > >= / ! / all / any / match / step / interpolate`)
and **must evaluate to a boolean for every feature**—if any feature produces a non-boolean value (for example,
`['get', 'enabled']` yielding the string `'false'` or the number `1`), the entire filter is disabled and an
`error` event fires; no truthiness coercion occurs.
When evaluation fails, the `error` event includes `layerId`, `filterExpression`, and `valueType`.

You can also declare a filter when calling `addLayer` through the layer specification's `filter` field:

```ts
map.addLayer({ id: 'cities', type: 'circle', source: 'src1', filter: ['>', ['get', 'pop'], 100000] });
```

Use `map.getFilter(layerId)` to read the current filter.

Filters only affect what is seen: rendering, picking/hover, highlighting, and the filtered attribute views
`map.features.iterFiltered(layerId)` / `map.features.countFiltered(layerId)`.
They do not alter data, enter undo history, or affect `map.ops.*` or exports; `map.features.iter()/count()`
retain their all-features semantics. `iterFiltered` accepts a render-layer ID (the `addLayer` ID), not a data-layer ID.

To show only filtered contents in an attribute table, iterate/count with `iterFiltered(layerId)` /
`countFiltered(layerId)`, and refresh the table on the `layerchange` event (`setFilter` fires it with reason
`'filter'`). Attribute-data changes continue to use the existing `data` event.

For layers without an attribute table, every feature evaluates against a `null` record (`['get', ...]` yields
`undefined`). `map.setFilter(layerId, null)` clears the filter.

## Change feature properties

`map.attributes.setFeatureProperty()` changes one field, and `setFeatureProperties()` writes several fields as one history entry. Assigning `undefined` to a field deletes it.

```ts
const result = map.attributes.setFeatureProperty(
  { source: 'main', layer: 'districts', id: 3 },
  'name',
  'New name',
);

if (!result.ok) console.error(result.error);

map.attributes.setFeatureProperties(
  { source: 'main', layer: 'districts', id: 3 },
  { name: 'New name', population: 120000 },
);
```

A complete no-op returns a validation error and creates no history entry.

## Manage fields

### Create an empty layer with fields

`map.createLayer(id, options)` creates and registers a separate source with default rendering.
`geometryType` supports `point`, `polyline`, and `polygon`; no imported file or placeholder feature is needed.

```ts
const source = await map.createLayer('survey', {
  name: 'Survey points',
  geometryType: 'point',
  crs: 'EPSG:4326',
  fields: [
    { name: 'name', type: 'string', defaultValue: '' },
    { name: 'height', type: 'number' },
    { name: 'checked', type: 'boolean', defaultValue: false },
  ],
});

// Field names and definitions are available even before drawing a feature.
console.log(source.getLayers()[0].data?.getFields?.());
console.log(source.getLayers()[0].fields);

map.drawFeature.setOptions({ source: 'survey', sourceLayer: 'Survey points', type: 'point' });
map.drawFeature.enable();
```

Field types are `string`, `number`, and `boolean`. They validate creation defaults, not later
expressions or property edits. Omitted defaults become `null` on newly drawn features.
Names must be nonempty and unique; defaults must match their types, with finite numbers.

`crs` specifies the initial source CRS. An established map normalizes the new source to its project CRS.
Source IDs must be unique, and failures reject the returned promise. Source creation does not enter
feature history; subsequent drawing and field edits support undo/redo.

Use `await TopologySource.create(id, options)` to prepare a detached source, then register it with
`await map.addSource(id, source)`. Definitions are emap layer metadata; exchange formats such as
GeoJSON do not represent empty-table field types or drawing defaults and cannot preserve them.

Field operations target a source-layer name and are undoable. Rename does not overwrite an existing destination field.

```ts
map.attributes.addField({
  source: 'main',
  target: 'districts',
  field: 'reviewed',
  defaultValue: false,
});

map.attributes.renameField({
  source: 'main',
  target: 'districts',
  from: 'old_name',
  to: 'name',
});

map.attributes.removeField({
  source: 'main',
  target: 'districts',
  field: 'temporary',
});
```

## Expressions, filtering, and joins

Expression, `where`, and `calc` options on `map.ops` obey `expressionPolicy`. Its default is `'disabled'`; set `'trusted'` only for expressions controlled by the application.

```ts
const map = await Emap.create({
  container: 'map',
  expressionPolicy: 'trusted',
});

await map.ops.applyExpression({
  source: 'main',
  target: 'districts',
  expression: 'POP_DENS = POP / AREA',
});

await map.ops.filterFields({
  source: 'main',
  target: 'districts',
  fields: ['name', 'population'],
});
```

Use `joinTable()` to join an external table to a layer by key fields. Key type and formatting must match on both sides: string `"001"` and number `1` are distinct keys.

```ts
await map.ops.joinTable({
  source: 'main',
  target: 'districts',
  keys: ['code', 'code'],
  data: { json: rows },
});
```

Attribute operations normally preserve feature IDs and selection. Operations that change feature count can shift record indexes; re-query results or handle `selectionchange` to refresh cached references.

## API

- [Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [Feature](/mapseekai/emap/api/interfaces/emap.Feature.html)
- [ApplyExpressionOptions](/mapseekai/emap/api/interfaces/emap.ApplyExpressionOptions.html)
- [JoinTableOptions](/mapseekai/emap/api/interfaces/emap.JoinTableOptions.html)

## Runnable examples

- [Feature attributes](/mapseekai/emap/examples/feature-attributes/)
- [Attribute editing](/mapseekai/emap/examples/attribute-editing/)
- [Create a layer](/mapseekai/emap/examples/create-layer/)
- [Attribute expressions](/mapseekai/emap/examples/attribute-expressions/)
- [Table join](/mapseekai/emap/examples/join/)
