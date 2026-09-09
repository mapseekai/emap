---
id: attributes
slug: /data/attributes
title: 属性
api: ["Emap","Feature","ApplyExpressionOptions","JoinTableOptions"]
examples: ["attribute-editing","attribute-expressions","feature-attributes","join"]
stability: stable
verifiedVersion: 0.9.1
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

## 图层显示过滤

`map.setFilter(layerId, expression)` 为渲染层设置显示过滤器：表达式使用与样式表达式相同的
MapLibre 子集（`get / == != < <= > >= / ! / all / any / match / step / interpolate`），
并且**必须对每个要素求值为 boolean**——任一要素返回非布尔值（如 `['get', 'enabled']`
得到字符串 `'false'` 或数值 `1`）时，过滤器整体失效并触发 `error` 事件，不做真值转换。
求值失败的 `error` 事件携带 `layerId`、`filterExpression` 和 `valueType`。

过滤器也可在 `addLayer` 时通过图层 spec 的 `filter` 字段声明：

```ts
map.addLayer({ id: 'cities', type: 'circle', source: 'src1', filter: ['>', ['get', 'pop'], 100000] });
```

使用 `map.getFilter(layerId)` 读取当前过滤器。

过滤器只影响“看”：渲染、拾取/悬停、高亮，以及属性过滤视图
`map.features.iterFiltered(layerId)` / `map.features.countFiltered(layerId)`。
数据本身不变、不进撤销历史、不影响 `map.ops.*` 与导出；`map.features.iter()/count()`
保持全量语义，`iterFiltered` 接收的是渲染层 id（`addLayer` 的 id），不是数据层 id。

属性表要只显示过滤后的内容：迭代/计数改用 `iterFiltered(layerId)` / `countFiltered(layerId)`，
并监听 `layerchange` 事件（`setFilter` 会以 reason `'filter'` 触发）刷新表格；属性数据本身的
变化仍走既有 `data` 事件。

无属性表的图层中每个要素按 `null` 记录求值（`['get', ...]` 得到 `undefined`）。
`map.setFilter(layerId, null)` 清除过滤器。

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
