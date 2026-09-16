---
id: attributes
slug: /data/attributes
title: 属性
api: ["Emap", "Feature", "ApplyExpressionOptions", "JoinTableOptions", "CreateLayerOptions", "LayerFieldDefinition"]
examples: ["create-layer","attribute-editing","attribute-expressions","feature-attributes","join"]
stability: stable
verifiedVersion: 0.12.0
---

# 属性

Emap 将 layer 属性保存在 data table；要素 ID 定位 geometry 和属性。`map.features` 读取，`map.attributes` 或 `map.ops` 修改。

```ts
const hits = map.queryFeatures([240, 180], { // 按屏幕位置拾取要素
  layers: ['districts'],
});
const feature = map.features.get({ // 按 source、图层和 ID 读取要素
  source: 'main',
  layer: 'districts',
  id: 3,
});
console.log(hits[0]?.properties, feature?.properties); // 读取冻结属性快照
```

## 核心方法

| 方法 | 参数 | 说明 |
| --- | --- | --- |
| `queryFeatures(geometryOrOptions, options?)` | 像素坐标/范围，`QueryFeaturesOptions` | 查询可见要素。 |
| `map.features.get(ref)` | `FeatureRef` | 按 source、图层和 ID 读取要素。 |
| `setFeatureProperty(ref, key, value)` / `setFeatureProperties(ref, props)` | 要素引用、字段和值 | 更新属性并记录历史。 |

## 更多读取属性

### 查询与 Feature 参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `queryFeatures.geometryOrOptions` | `[number, number] \| [[number, number], [number, number]] \| QueryFeaturesOptions` | 当前视口 | 像素点拾取、像素 bbox 框选，或选项。 |
| `queryFeatures.options.layers` | `string[]` | `undefined` | 限定图层；空数组查询全部可见图层。 |
| `map.features.get(ref).source` | `string` | — | 所属 source ID。 |
| `map.features.get(ref).layer` | `string` | — | source 内图层名或 ID。 |
| `map.features.get(ref).id` | `number` | — | 非负要素 ID；未解析返回 `null`。 |
| `Feature.geometry` | `PathShape \| PointShape \| LegacyPointShape \| null` | — | 要素几何；可为 `null`。 |
| `Feature.properties` | `Readonly<Record<string, unknown>>` | `{}` | 冻结属性快照。 |

### DataTable 方法

底层属性表位于 `source.getLayers()[layerIndex].data`；要素 ID 对应记录索引。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `getRecords()` | `() => Record<string, unknown>[]` | — | 按要素 ID 排列的记录。 |
| `getRecordAt(id)` 的 `id` | `number` | — | 指定要素的属性记录。 |
| `getFields()` | `() => string[]` | — | 当前字段名。 |
| `size()` | `() => number` | — | 属性记录数。 |

## 更多属性操作

### 图层显示过滤

`map.setFilter(layerId, expression)` 为渲染层设置 MapLibre 子集表达式过滤器。表达式**必须对每个要素返回 boolean**；非布尔结果禁用过滤器并触发携带 `layerId`、`filterExpression`、`valueType` 的 `error` 事件。
过滤器也可在 `addLayer` 时通过图层 spec 的 `filter` 字段声明：

```ts
map.addLayer({ id: 'cities', type: 'circle', source: 'src1', filter: ['>', ['get', 'pop'], 100000] });
```

`map.getFilter(layerId)` 读取过滤器。

过滤器影响渲染、拾取、悬停、高亮及 `iterFiltered(layerId)` / `countFiltered(layerId)`，不影响属性、历史、`map.ops.*`、导出或 `iter()` / `count()`。`iterFiltered` 接受渲染层 ID。

属性表使用 `iterFiltered` / `countFiltered`，并在 reason 为 `'filter'` 的 `layerchange` 事件刷新。无属性表时按 `null` 记录求值；`map.setFilter(layerId, null)` 清除过滤器。

### 过滤参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `setFilter.id` | `string` | — | 渲染层 ID。 |
| `setFilter.expression` | `StyleExpression \| null` | — | MapLibre 子集表达式；`null` 清除过滤器。 |
| `getFilter.id` | `string` | — | 渲染层 ID；未设置返回 `undefined`。 |
| `iter(sourceId, layerId)` 的 `sourceId` / `layerId` | `string` | — | 数据 source 和图层；产生全部 `Feature`。 |
| `count(sourceId, layerId)` 的 `sourceId` / `layerId` | `string` | — | 全部要素数。 |
| `iterFiltered(renderLayerId)` 的 `renderLayerId` | `string` | — | 当前过滤器可见的 `Feature`。 |
| `countFiltered(renderLayerId)` 的 `renderLayerId` | `string` | — | 过滤器可见要素数。 |

### 修改要素属性

`map.attributes.setFeatureProperty()` 写一个字段，`setFeatureProperties()` 合并多字段为一条历史；`undefined` 删除字段。

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

相同属性值返回 `validation`，不创建历史项。

#### 属性写入参数

两个方法返回 `OpResult<void>`；成功为 `{ ok: true }`。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `setFeatureProperty.ref.source` | `string` | — | source ID。 |
| `setFeatureProperty.ref.layer` | `string` | — | 图层名或 ID。 |
| `setFeatureProperty.ref.id` | `number` | — | 要素 ID 和属性记录索引。 |
| `setFeatureProperty.key` | `string` | — | 字段名。 |
| `setFeatureProperty.value` | `unknown` | — | 新值；`undefined` 删除字段。 |
| `setFeatureProperties.ref` | `FeatureRef` | — | 批量写入目标要素。 |
| `setFeatureProperties.props` | `Record<string, unknown>` | — | 字段新值映射；合并为一条撤销历史。 |
### 管理字段

#### 创建带字段的空图层

`map.createLayer(id, options)` 创建并注册带默认渲染的 source；`geometryType` 支持 `point`、`polyline`、`polygon`。

```ts
const source = await map.createLayer('survey', {
  name: '调查点',
  geometryType: 'point',
  crs: 'EPSG:4326',
  fields: [
    { name: 'name', type: 'string', defaultValue: '' },
    { name: 'height', type: 'number' },
    { name: 'checked', type: 'boolean', defaultValue: false },
  ],
});

// 即使没有要素，字段名称和定义也可以读取。
console.log(source.getLayers()[0].data?.getFields?.());
console.log(source.getLayers()[0].fields);

map.drawFeature.setOptions({ source: 'survey', sourceLayer: '调查点', type: 'point' });
map.drawFeature.enable();
```

#### 创建图层参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | — | 唯一 source ID。 |
| `options.name` | `string` | — | 非空图层名。 |
| `options.geometryType` | `'point' \| 'polyline' \| 'polygon'` | — | 图层几何类型。 |
| `options.crs` | `string` | — | 输入 CRS；注册后统一为项目 CRS。 |
| `options.fields` | `readonly LayerFieldDefinition[]` | `[]` | 空表字段定义。 |
| `options.fields[].name` | `string` | — | 非空且唯一的字段名。 |
| `options.fields[].type` | `'string' \| 'number' \| 'boolean'` | — | 默认值验证类型。 |
| `options.fields[].defaultValue` | `string \| number \| boolean \| null` | `undefined` | 新要素初始值；省略写入 `null`，数值有限。 |

`map.createLayer` 返回已注册的 `Promise<ConcreteTopologySource>`；`TopologySource.create` 用相同参数创建待注册 source。字段类型验证默认值，名称需非空唯一。

`crs` 是初始 CRS；已有地图会统一新 source。源 ID 必须唯一。

字段操作针对 source layer，可撤销；目标字段已存在时重命名返回冲突。

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

#### 字段操作参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `addField.source` | `string` | — | source ID。 |
| `addField.target` | `string` | — | 目标图层名或 ID。 |
| `addField.field` | `string` | — | 新字段名。 |
| `addField.defaultValue` | `unknown` | `null` | 缺失字段的值；已有值不变。 |
| `removeField.source` / `removeField.target` | `string` | — | source 和图层。 |
| `removeField.field` | `string` | — | 要删除的字段。 |
| `renameField.source` / `renameField.target` | `string` | — | source 和图层。 |
| `renameField.from` | `string` | — | 原字段名。 |
| `renameField.to` | `string` | — | 新字段名；唯一且不同于 `from`。 |

#### 字段名校验

导入 `isValidFieldName` 和 `findInvalidFieldName` 复用操作层校验。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `isValidFieldName(value)` 的 `value` | `unknown` | — | 非空安全字段名。 |
| `findInvalidFieldName(values)` 的 `values` | `ReadonlyArray<unknown>` | — | 首个无效值；全有效或空数组返回 `null`。 |

名称排除逗号、等号、冒号、引号、反斜杠和控制字符。

### 表达式、筛选和连接

`map.ops` 的表达式、`where`、`calc` 遵守 `expressionPolicy`；默认 `'disabled'`，应用受控表达式可用 `'trusted'`。

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

#### 表达式与字段筛选参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `applyExpression.source` | `string` | — | source ID。 |
| `applyExpression.target` | `string` | — | 图层名或 ID。 |
| `applyExpression.expression` | `string` | — | 每要素 JavaScript 表达式；`this.<field>` 访问属性。 |
| `applyExpression.where` | `string` | `undefined` | 真值记录应用表达式。 |
| `filterFields.source` | `string` | — | source ID。 |
| `filterFields.target` | `string` | — | 图层名或 ID。 |
| `filterFields.fields` | `string[]` | — | 保留字段；`['*']` 移除全部字段。 |
| `filterFields.invert` | `boolean` | `false` | 移除列出字段。 |

#### 属性分级参数

`classifyFeatures()` 写入颜色字段并返回断点、类别、计数和空值颜色。

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

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `source` | `string` | — | source ID。 |
| `target` | `string` | — | 写入颜色的图层。 |
| `field` | `string` | — | 分级属性字段。 |
| `method` | `'quantile' \| 'equal-interval' \| 'nice' \| 'categorical'` | — | 分位数、等距、易读断点或类别。 |
| `classes` | `number` | `4` | 顺序类别数；至少 `2`。 |
| `breaks` | `number[]` | `undefined` | 显式内部断点；优先于 `method`。 |
| `categories` | `(string \| number)[]` | 按出现顺序的非 `null`/`undefined` 唯一值 | 分类类别。 |
| `colors` | `string[]` | — | 类别或区间颜色。 |
| `saveAs` | `string` | `'fill'` | 颜色字段名。 |
| `nullValue` | `string` | 主题的 muted 色 | 空值颜色。 |
| `otherColor` | `string` | `nullValue` | 未列出类别的颜色。 |
| `invert` | `boolean` | `false` | 反转颜色数组。 |

`joinTable()` 按键字段连接外部表；两侧类型和格式必须一致。

```ts
await map.ops.joinTable({
  source: 'main',
  target: 'districts',
  keys: ['code', 'code'],
  data: { json: rows },
});
```

#### 表连接参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `source` | `string` | — | 目标图层的 source ID。 |
| `target` | `string` | — | 接收字段的图层。 |
| `data` | `JoinTableData` | — | CSV、JSON 或同 source 图层。 |
| `keys` | `[string, string]` | — | `[targetKey, sourceKey]` 非空键对。 |
| `fields` | `string[]` | 除 source key 外的全部字段 | 复制字段。 |
| `prefix` | `string` | `undefined` | 连接字段名前缀。 |
| `where` | `string` | `undefined` | 连接前筛选表达式。 |
| `calc` | `string` | `undefined` | 多对一聚合表达式。 |
| `unjoined` | `boolean` | `false` | 保留未匹配目标记录。 |
| `unmatched` | `boolean` | `false` | 未匹配外部记录输出为图层。 |

`where`、`calc`、`applyExpression` 需要 `expressionPolicy: 'trusted'`。

属性操作通常保留 feature ID 和选择；改变要素数后重新查询。

## API

- [Emap](/mapseekai/emap/api/classes/emap.Emap.html)
- [Feature](/mapseekai/emap/api/interfaces/emap.Feature.html)
- [ApplyExpressionOptions](/mapseekai/emap/api/interfaces/emap.ApplyExpressionOptions.html)
- [JoinTableOptions](/mapseekai/emap/api/interfaces/emap.JoinTableOptions.html)

## 可运行示例

- [要素属性](/mapseekai/emap/examples/feature-attributes/)
- [属性编辑](/mapseekai/emap/examples/attribute-editing/)
- [创建图层](/mapseekai/emap/examples/create-layer/)
- [属性表达式](/mapseekai/emap/examples/attribute-expressions/)
- [表连接](/mapseekai/emap/examples/join/)
