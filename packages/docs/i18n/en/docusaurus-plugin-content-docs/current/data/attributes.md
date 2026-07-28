---
id: attributes
slug: /data/attributes
title: Attributes
api: ["Emap"]
examples: ["attribute-editing","attribute-expressions","data-engineering","feature-attributes","filter-features","join","split-layer"]
stability: stable
verifiedVersion: 0.5.0
---

# Attributes

A mapshaper layer may contain a data table. Shape and record indexes correspond,
so `FeatureRef.id` locates both geometry and its property record.

## Read properties

From a screen query:

```ts
const hits = map.queryFeatures([240, 180], {
  layers: ['district-fill'],
});

const first = hits[0];
if (first) {
  console.log(first.properties);
}
```

From a reference:

```ts
const feature = map.features.get({
  source: 'main',
  layer: 'districts',
  id: 3,
});

console.log(feature?.properties);
```

Feature accessors are read views. Mutate through `map.attributes`.

## Change one feature

```ts
const result = map.attributes.setFeatureProperty(
  { source: 'main', layer: 'districts', id: 3 },
  'name',
  'New name',
);

if (!result.ok) {
  console.error(result.error);
}
```

Set several properties in one history entry:

```ts
map.attributes.setFeatureProperties(
  { source: 'main', layer: 'districts', id: 3 },
  {
    name: 'New name',
    population: 120000,
  },
);
```

An `undefined` value deletes that key. A complete no-op returns a validation
error and does not create history.

## Field operations

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

`target` is a source-layer name. These operations are undoable. Rename refuses
to overwrite an existing destination field.

## Bulk expressions

```ts
const map = new Emap({
  container: 'map',
  expressionPolicy: 'trusted',
});

const result = await map.ops.applyExpression({
  source: 'main',
  target: 'districts',
  expression: 'POP_DENS = POP / AREA',
});
```

Mapshaper expressions execute JavaScript-like logic. The default policy is
`'disabled'`. Only enable `'trusted'` for application-owned expressions, never
for direct user or remote input.

Filter, sort, split, and `where` / `calc` options follow the same policy.

## Fields and joins

```ts
await map.ops.filterFields({
  source: 'main',
  target: 'districts',
  fields: ['name', 'population'],
});

await map.ops.joinTable({
  source: 'main',
  target: 'districts',
  keys: ['code', 'code'],
  data: { json: rows },
});
```

Normalize join key types and formatting; string `"001"` and number `1` are not
the same key.

## Selection and troubleshooting

Attribute-only operations normally preserve feature IDs and selection.
Shape-count operations may shift record indexes; refresh cached references after
those changes.

- A geometry-only layer may have no data table.
- Do not mutate `feature.properties` or `layer.data.getRecords()` directly.
- An `expression-disabled` result is the expected safe default.

## API

- [Emap](/emap/api/classes/index.Emap.html)
- [Feature](/emap/api/interfaces/index.Feature.html)
- [ApplyExpressionOptions](/emap/api/interfaces/index.ApplyExpressionOptions.html)
- [JoinTableOptions](/emap/api/interfaces/index.JoinTableOptions.html)

## Runnable examples

- [Feature attributes](/emap/examples/feature-attributes/)
- [Attribute editing](/emap/examples/attribute-editing/)
- [Attribute expressions](/emap/examples/attribute-expressions/)
- [Table join](/emap/examples/join/)
