---
id: attributes
slug: /data/attributes
title: Attributes
api: ["Emap", "Feature", "ApplyExpressionOptions", "JoinTableOptions", "CreateLayerOptions", "LayerFieldDefinition"]
examples: ["create-layer","attribute-editing","attribute-expressions","feature-attributes","join"]
stability: stable
verifiedVersion: 0.14.0
---

# Attributes

Emap supports attribute queries, display filters, undoable field edits, classification, and table joins. Layer attributes live in data tables; feature IDs locate geometry and attributes. Read through `map.features` and write through `map.attributes` or `map.ops`.

```ts
const hits = map.queryFeatures([240, 180], {
  // pick features at a screen position
  layers: ['districts'],
});
const feature = map.features.get({
  // read one feature by source, layer, and ID
  source: 'main',
  layer: 'districts',
  id: 3,
});
console.log(hits[0]?.properties, feature?.properties); // read frozen property snapshots
```

## Core methods

| Method | Parameters | Description |
| --- | --- | --- |
| `queryFeatures(geometryOrOptions, options?)` | Pixel coordinate/bounds, `QueryFeaturesOptions` | Query visible features. |
| `map.features.get(ref)` | `FeatureRef` | Read one feature by source, layer, and ID. |
| `setFeatureProperty(ref, key, value)` / `setFeatureProperties(ref, props)` | Feature reference, field, value | Update properties with history. |

## More property reading

### Query and Feature parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `queryFeatures.geometryOrOptions` | `[number, number] \| [[number, number], [number, number]] \| QueryFeaturesOptions` | Current viewport | Pixel point, pixel bbox, or options. |
| `queryFeatures.options.layers` | `string[]` | `undefined` | Limits layers; empty queries all visible layers. |
| `map.features.get(ref).source` | `string` | — | Owning source ID. |
| `map.features.get(ref).layer` | `string` | — | Layer name or ID. |
| `map.features.get(ref).id` | `number` | — | Nonnegative feature ID; unresolved returns `null`. |
| `Feature.geometry` | `PathShape \| PointShape \| LegacyPointShape \| null` | — | Feature geometry; may be `null`. |
| `Feature.properties` | `Readonly<Record<string, unknown>>` | `{}` | Frozen property snapshot. |

### DataTable methods

The underlying table is `source.getLayers()[layerIndex].data`; feature IDs match record indexes.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `getRecords()` | `() => Record<string, unknown>[]` | — | Records ordered by feature ID. |
| `getRecordAt(id)` — `id` | `number` | — | Feature property record. |
| `getFields()` | `() => string[]` | — | Current field names. |
| `size()` | `() => number` | — | Attribute-record count. |

## More property operations

### Layer display filtering

`map.setFilter(layerId, expression)` sets a MapLibre-subset render-layer filter. It **must return boolean for every feature**; a non-boolean result disables the filter and fires an `error` with `layerId`, `filterExpression`, and `valueType`.

You can also declare a filter when calling `addLayer` through the layer specification's `filter` field:

```ts
map.addLayer({
  id: 'cities',
  type: 'circle',
  source: 'src1',
  filter: ['>', ['get', 'pop'], 100000],
});
```

`map.getFilter(layerId)` reads the filter.

Filters affect rendering, picking, hover, highlighting, and `iterFiltered(layerId)` / `countFiltered(layerId)`, not attributes, history, `map.ops.*`, export, or `iter()` / `count()`. `iterFiltered` takes a render-layer ID.

Attribute tables use `iterFiltered` / `countFiltered` and refresh on `layerchange` with reason `'filter'`. Layers without tables evaluate against `null`; `map.setFilter(layerId, null)` clears the filter.

### Filter parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `setFilter.id` | `string` | — | Render-layer ID. |
| `setFilter.expression` | `StyleExpression \| null` | — | MapLibre-subset expression; `null` clears. |
| `getFilter.id` | `string` | — | Render-layer ID; unset returns `undefined`. |
| `iter(sourceId, layerId)` — `sourceId` / `layerId` | `string` | — | Data source and layer; yields all `Feature`. |
| `count(sourceId, layerId)` — `sourceId` / `layerId` | `string` | — | Complete feature count. |
| `iterFiltered(renderLayerId)` — `renderLayerId` | `string` | — | Current-filter visible `Feature`. |
| `countFiltered(renderLayerId)` — `renderLayerId` | `string` | — | Current-filter visible count. |

### Change feature properties

`map.attributes.setFeatureProperty()` writes one field; `setFeatureProperties()` combines fields into one history entry; `undefined` deletes a field.

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

Identical values return `validation` without a history entry.

#### Property write parameters

Both methods return `OpResult<void>`; success is `{ ok: true }`.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `setFeatureProperty.ref.source` | `string` | — | Source ID. |
| `setFeatureProperty.ref.layer` | `string` | — | Layer name or ID. |
| `setFeatureProperty.ref.id` | `number` | — | Feature ID and record index. |
| `setFeatureProperty.key` | `string` | — | Field name. |
| `setFeatureProperty.value` | `unknown` | — | New value; `undefined` deletes. |
| `setFeatureProperties.ref` | `FeatureRef` | — | Bulk-write feature. |
| `setFeatureProperties.props` | `Record<string, unknown>` | — | Field-value map; one undo entry. |

### Manage fields

#### Create an empty layer with fields

`map.createLayer(id, options)` creates and registers a source with default rendering; `geometryType` supports `point`, `polyline`, and `polygon`.

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

#### Create-layer parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | `string` | — | Unique source ID. |
| `options.name` | `string` | — | Nonempty layer name. |
| `options.geometryType` | `'point' \| 'polyline' \| 'polygon'` | — | Layer geometry type. |
| `options.crs` | `string` | — | Input CRS; normalizes to project CRS. |
| `options.fields` | `readonly LayerFieldDefinition[]` | `[]` | Empty-table field definitions. |
| `options.fields[].name` | `string` | — | Nonempty unique field name. |
| `options.fields[].type` | `'string' \| 'number' \| 'boolean'` | — | Default-value validation type. |
| `options.fields[].defaultValue` | `string \| number \| boolean \| null` | `undefined` | New-feature value; omitted writes `null`, numbers finite. |

`map.createLayer` returns an immediately registered `Promise<ConcreteTopologySource>`; `TopologySource.create` prepares an unregistered source. Field types validate defaults; names are nonempty and unique.

`crs` is the initial CRS; an established map normalizes the source. Source IDs are unique.

Field operations target a source layer and are undoable; an existing destination field makes rename conflict.

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

#### Field-operation parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `addField.source` | `string` | — | Source ID. |
| `addField.target` | `string` | — | Target layer name or ID. |
| `addField.field` | `string` | — | New field name. |
| `addField.defaultValue` | `unknown` | `null` | Value for missing fields; existing values persist. |
| `removeField.source` / `removeField.target` | `string` | — | Source and layer. |
| `removeField.field` | `string` | — | Field to remove. |
| `renameField.source` / `renameField.target` | `string` | — | Source and layer. |
| `renameField.from` | `string` | — | Current field name. |
| `renameField.to` | `string` | — | New unique name, distinct from `from`. |

#### Field-name validation

Import `isValidFieldName` and `findInvalidFieldName` for operation-layer validation.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `isValidFieldName(value)` — `value` | `unknown` | — | Nonempty safe field name. |
| `findInvalidFieldName(values)` — `values` | `ReadonlyArray<unknown>` | — | First invalid value; `null` if valid or empty. |

Names exclude commas, equals, colons, quotes, backslashes, and controls.

### Expressions, filtering, and joins

`map.ops` expressions, `where`, and `calc` obey `expressionPolicy`: default `'disabled'`; application-controlled expressions may use `'trusted'`.

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

#### Expression and field-filter parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `applyExpression.source` | `string` | — | Source ID. |
| `applyExpression.target` | `string` | — | Layer name or ID. |
| `applyExpression.expression` | `string` | — | Per-feature JavaScript; `this.<field>` accesses attributes. |
| `applyExpression.where` | `string` | `undefined` | Truthy records receive expression. |
| `filterFields.source` | `string` | — | Source ID. |
| `filterFields.target` | `string` | — | Layer name or ID. |
| `filterFields.fields` | `string[]` | — | Retained fields; `['*']` removes all. |
| `filterFields.invert` | `boolean` | `false` | Removes listed fields. |

#### Classification parameters

`classifyFeatures()` writes colors and returns breaks, categories, counts, and null color.

```ts
const result = await map.ops.classifyFeatures({
  source: 'main',
  target: 'districts',
  field: 'population',
  method: 'quantile',
  classes: 5,
  colors: ['#eff3ff', '#bdd7e7', '#6baed6', '#4292c6', '#084594'],
});
```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `source` | `string` | — | Source ID. |
| `target` | `string` | — | Layer receiving colors. |
| `field` | `string` | — | Classification field. |
| `method` | `'quantile' \| 'equal-interval' \| 'nice' \| 'categorical'` | — | Quantile, interval, nice, or categorical. |
| `classes` | `number` | `4` | Sequential classes; at least `2`. |
| `breaks` | `number[]` | `undefined` | Explicit interior breaks; overrides `method`. |
| `categories` | `(string \| number)[]` | Distinct non-nullish values in appearance order | Categorical values. |
| `colors` | `string[]` | — | Category or interval colors. |
| `saveAs` | `string` | `'fill'` | Color-field name. |
| `nullValue` | `string` | Theme muted color | Null color. |
| `otherColor` | `string` | `nullValue` | Unlisted-category color. |
| `invert` | `boolean` | `false` | Reverses colors. |

`joinTable()` joins an external table by key; both sides need matching type and formatting.

```ts
await map.ops.joinTable({
  source: 'main',
  target: 'districts',
  keys: ['code', 'code'],
  data: { json: rows },
});
```

#### Join parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `source` | `string` | — | Target layer's source ID. |
| `target` | `string` | — | Layer receiving fields. |
| `data` | `JoinTableData` | — | CSV, JSON, or same-source layer. |
| `keys` | `[string, string]` | — | Nonempty `[targetKey, sourceKey]`. |
| `fields` | `string[]` | All fields except the source key | Copied fields. |
| `prefix` | `string` | `undefined` | Joined-field prefix. |
| `where` | `string` | `undefined` | Pre-join filter expression. |
| `calc` | `string` | `undefined` | Many-to-one aggregation expression. |
| `unjoined` | `boolean` | `false` | Retains unmatched targets. |
| `unmatched` | `boolean` | `false` | Outputs unmatched external records as a layer. |

`where`, `calc`, and `applyExpression` require `expressionPolicy: 'trusted'`.

Attribute operations usually preserve feature IDs and selection; re-query after count changes.

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
