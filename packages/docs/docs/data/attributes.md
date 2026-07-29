---
id: attributes
slug: /data/attributes
title: 属性
api: ["Emap"]
examples: ["attribute-editing","attribute-expressions","data-engineering","feature-attributes","filter-features","join","split-layer"]
stability: stable
verifiedVersion: 0.5.0
---

# 属性

每个 mapshaper layer 可以包含一张 data table。shape 索引与 record 索引对应，因此
`FeatureRef.id` 同时定位几何和属性记录。

## 读取要素属性

从屏幕查询：

```ts
const hits = map.queryFeatures([240, 180], {
  layers: ['district-fill'],
});

const first = hits[0];
if (first) {
  console.log(first.properties);
}
```

按引用读取：

```ts
const feature = map.features.get({
  source: 'main',
  layer: 'districts',
  id: 3,
});

console.log(feature?.properties);
```

Feature accessor 返回读取视图。修改属性应使用 `map.attributes`。

## 修改单个要素

```ts
const result = map.attributes.setFeatureProperty(
  { source: 'main', layer: 'districts', id: 3 },
  'name',
  '新名称',
);

if (!result.ok) {
  console.error(result.error);
}
```

一次更新多个字段会形成一条历史记录：

```ts
map.attributes.setFeatureProperties(
  { source: 'main', layer: 'districts', id: 3 },
  {
    name: '新名称',
    population: 120000,
  },
);
```

值设为 `undefined` 表示删除该 key。请求值与现有记录完全相同时返回 validation
错误，不会添加空历史项。

## 字段操作

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

`target` 是 source layer 名称。字段新增、重命名和删除都可撤销。重命名不会覆盖
已经存在的目标字段。

## 批量表达式

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

mapshaper expression 可以执行 JavaScript 风格逻辑。默认 policy 是 `'disabled'`。
只有表达式由可信应用代码提供时才启用 `'trusted'`；不要直接执行用户输入或远程配置。

受 policy 控制的接口还包括 filter、sort、split，以及 `where` / `calc` 选项。

## 过滤字段

```ts
const result = await map.ops.filterFields({
  source: 'main',
  target: 'districts',
  fields: ['name', 'population'],
});
```

这是 dataset operation，可能替换当前 layer data。处理结果通过 `OpResult` 返回。

## 连接外部表

`joinTable` 使用 key 字段把应用内表数据连接到 source layer：

```ts
const result = await map.ops.joinTable({
  source: 'main',
  target: 'districts',
  keys: ['code', 'code'],
  data: { json: rows },
});
```

连接前确保 key 类型和格式一致，例如不要把字符串 `"001"` 与数字 `1` 当成同一值。

## 属性与选择

`attribute-only` operation 可以保留 feature ID，因此 Emap 会尽量保留当前选择。
shape-count operation 可能改变记录索引，应用应在操作后从 `selectionchange` 或新查询
刷新缓存。

## 常见问题

### layer 没有 data table

纯几何 layer 可能没有属性表。需要字段操作前先确认导入数据包含 records。

### 修改没有进入撤销记录

不要直接修改 `feature.properties` 或 `layer.data.getRecords()`；使用
`map.attributes` 或 `map.ops`。

### 表达式返回 expression-disabled

这是默认安全行为。确认表达式由可信代码生成后，再设置
`expressionPolicy: 'trusted'`。

## API

- [Emap](/mapseekai/emap/api/classes/index.Emap.html)
- [Feature](/mapseekai/emap/api/interfaces/index.Feature.html)
- [ApplyExpressionOptions](/mapseekai/emap/api/interfaces/index.ApplyExpressionOptions.html)
- [JoinTableOptions](/mapseekai/emap/api/interfaces/index.JoinTableOptions.html)

## 可运行示例

- [要素属性](/mapseekai/emap/examples/feature-attributes/)
- [属性编辑](/mapseekai/emap/examples/attribute-editing/)
- [属性表达式](/mapseekai/emap/examples/attribute-expressions/)
- [表连接](/mapseekai/emap/examples/join/)
