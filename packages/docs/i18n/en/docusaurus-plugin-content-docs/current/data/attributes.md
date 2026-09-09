---
id: attributes
slug: /data/attributes
title: Attributes
api: ["Emap","Feature","ApplyExpressionOptions","JoinTableOptions"]
examples: ["attribute-editing","attribute-expressions","feature-attributes","join"]
stability: stable
verifiedVersion: 0.9.1
---

# Attributes

Emap stores each layer's attributes in a data table. A feature ID locates both its geometry and property record; use `map.features` to read and `map.attributes` or `map.ops` to modify them.

## Read properties

`queryFeatures()` queries by screen coordinate, while `map.features.get()` queries by source, layer, and ID:

```ts
const hits = map.queryFeatures([240, 180], {
  layers: ['district-fill'],
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
const map = new Emap({
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
- [Attribute expressions](/mapseekai/emap/examples/attribute-expressions/)
- [Table join](/mapseekai/emap/examples/join/)
