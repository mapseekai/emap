---
id: attributes
slug: /data/attributes
title: 属性
api: ["Emap","Feature","ApplyExpressionOptions","JoinTableOptions"]
examples: ["attribute-editing","attribute-expressions","feature-attributes","join"]
stability: stable
verifiedVersion: 0.9.0
---

# 属性

Emap 将每个 layer 的属性保存在 data table 中。要素 ID 同时定位 geometry 和对应属性记录；使用 `map.features` 读取，使用 `map.attributes` 或 `map.ops` 修改。

## 读取属性

`queryFeatures()` 按屏幕坐标查询，`map.features.get()` 按 source、layer 和 ID 查询：

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

`Feature` 是读取视图。不要直接改写 `feature.properties` 或 source dataset 的 records；这些修改不会经过 Emap 的历史、选择和渲染更新流程。

## 修改要素属性

`map.attributes.setFeatureProperty()` 修改一个字段，`setFeatureProperties()` 将多个字段写成一次历史记录。为字段赋值 `undefined` 会删除它。

```ts
const result = map.attributes.setFeatureProperty(
  { source: 'main', layer: 'districts', id: 3 },
  'name',
  '新名称',
);

if (!result.ok) console.error(result.error);

map.attributes.setFeatureProperties(
  { source: 'main', layer: 'districts', id: 3 },
  { name: '新名称', population: 120000 },
);
```

相同的完整属性值会返回 validation 错误，不创建空的历史项。

## 管理字段

字段操作针对 source layer 名称，并可撤销。重命名不会覆盖已有目标字段。

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

## 表达式、筛选和连接

`map.ops` 的表达式、`where` 和 `calc` 选项遵守 `expressionPolicy`。默认值为 `'disabled'`；只对由应用控制的表达式设置 `'trusted'`。

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

用 `joinTable()` 按键字段把外部表连接到 layer。两侧键的类型和格式必须一致，例如字符串 `"001"` 与数字 `1` 是不同的键。

```ts
await map.ops.joinTable({
  source: 'main',
  target: 'districts',
  keys: ['code', 'code'],
  data: { json: rows },
});
```

属性操作通常保留 feature ID 和选择；改变要素数量的操作可能改变记录索引。处理结果后重新查询或响应 `selectionchange` 来更新缓存引用。

## API

- [Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [Feature](/mapseekai/emap/api/interfaces/emap.Feature.html)
- [ApplyExpressionOptions](/mapseekai/emap/api/interfaces/emap.ApplyExpressionOptions.html)
- [JoinTableOptions](/mapseekai/emap/api/interfaces/emap.JoinTableOptions.html)

## 可运行示例

- [要素属性](/mapseekai/emap/examples/feature-attributes/)
- [属性编辑](/mapseekai/emap/examples/attribute-editing/)
- [属性表达式](/mapseekai/emap/examples/attribute-expressions/)
- [表连接](/mapseekai/emap/examples/join/)
