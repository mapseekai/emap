# 附属 Symbol 样式映射

## 目标与边界

现有点、线、面图层新增 `symbol: { layout, paint }`。这是 emap 的附属样式对象，
不是 MapLibre 的 `type: "symbol"` 图层，不新增图层 ID、数据源或图层树节点。
这里只复用常见 MapLibre 属性名称与单位约定；没有引入 MapLibre 样式运行时或替换现有渲染器。

`symbol.ts` 负责纯校验和单位映射；`symbol-compat.ts` 处理旧接口；`symbol-layer.ts`
只在添加图层、替换样式或设置属性时生成现有 `LabelOptions` / `IconOptions`。
MSDF、HarfBuzz、字体 Worker、图片缓存、点 LOD、透视相机、GPU shader、避让和拾取全部沿用原有实现。
渲染循环不编译 Symbol Style，不扫描源要素，也不引入新网络请求。

## 完整用法

```ts
map.addLayer({
  id: 'poi',
  type: 'circle',
  source: 'poi',
  paint: { 'circle-radius': 4, 'circle-color': '#2563eb' },
  symbol: {
    // emap 本地资源声明。相同 URL 仍由已有图片缓存共享。
    images: { marker: { url: '/images/marker@2x.png', size: [24, 32] } },
    layout: {
      'icon-image': 'marker',
      'icon-size': 1,
      'icon-anchor': 'bottom',
      'text-field': ['get', 'name'],
      'text-size': 14,
      'text-offset': [0, 1.2],
      'text-allow-overlap': false,
    },
    paint: {
      'icon-opacity': 1,
      'text-color': '#243447',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.5,
    },
  },
});

map.setSymbolLayoutProperty('poi', 'text-size', 20);
map.setSymbolLayoutProperty('poi', 'icon-size', 1.5);
map.setSymbolPaintProperty('poi', 'text-color', '#b42318');
map.setSymbolPaintProperty('poi', 'icon-opacity', 0.6);
map.setSymbolLayoutProperty('poi', 'text-offset', null); // 删除显式值，恢复默认
const style = map.getLayer('poi')?.symbol; // 深拷贝，适合保存或编辑 JSON
```

`setLayerSymbol(id, style)` 替换整个附属样式；不做隐式深合并。
`removeLayerSymbol(id)` 同时移除文字和图标，保留父图层和普通点符号；它与
`setLayerSymbol(id, null)` 完全等价，前者更适合表达“移除附属符号”的意图。
两个单属性接口只更新对应的 `layout` / `paint`，`null` 或 `undefined` 删除属性。
只修改父几何时继续使用 `setPaintProperty`；它不路由 text/icon 属性。

## 支持的映射

| 对外属性 | 现有内部参数 / 行为 |
| --- | --- |
| `text-field` | 简单 `['get', field]` → `label.field`；其他安全表达式或固定字符串 → `label.text` |
| `text-size` | `label.fontSize`，CSS px，6–96；默认沿用 emap 的 14 |
| `text-font` | 一个字体家族/字面名称 → `fontFamily`；内置 Noto 的 Regular/Bold 后缀可映射字重 |
| `text-offset` | em × 当前 `text-size` → 屏幕像素 offset；字号改变后重新换算 |
| `text-allow-overlap` | `label.allowOverlap` |
| `text-padding` | `label.padding`，CSS px |
| `text-color` / `text-halo-color` / `text-halo-width` | 原有文字颜色、描边颜色与宽度 |
| `icon-image` | 查找 `symbol.images`，取得已有 URL 和可选 rect |
| `icon-size` | 倍率 × 资源声明的基准尺寸；0 表示关闭图标并恢复普通点 |
| `icon-anchor` | 九种命名锚点 → `[x,y]` 归一化锚点 |
| `icon-rotate` | 屏幕顺时针角度，围绕锚点旋转 |
| `icon-offset` | 先乘 icon-size，再按 icon-rotate 旋转，映射为现有屏幕像素偏移 |
| `icon-opacity` / `icon-color` | 原有透明度 / alpha 蒙版单色着色 |
| `symbol.layout.visibility` | 只开关附属文字/图标，不隐藏父几何 |

父图层的 `layout.visibility`、过滤器与源数据版本仍独立生效。
文字的自动点周边定位、线段定位、面内部锚点和碰撞策略继续使用 emap，并非 MapLibre placement。
因此 `text-offset` 保留原有定位算法后的屏幕偏移语义；不承诺与 MapLibre 的逐字沿线/可变锚点行为一致。

## 图片与字体资源

`symbol.images` 是 emap 的小型声明表，不是完整 Sprite 服务。每项包含 `url`、必需的
`size` 和可选 `rect`。`size` 是基准 CSS 像素高度（数字，保持裁剪图片的宽高比），或
显式 `[width,height]`。它与源图片分辨率独立：64px 的高清图可以声明 32px 基准高度。
`icon-size: 2` 将基准 32px 放大为 64px，不重新解码或上传图片。

同一图片的不同子图使用 `rect: [x,y,width,height]`（原图像素）。没有自动猜测尺寸、
自动下载 sprite JSON、全局 addImage 注册表或按要素 icon-image 表达式。
引用不存在的名字会在设置时抛错，原样式保持不变。表最多 32 项，已有图片尺寸、缓存与文件预算仍有效。
图标映射后的尺寸仍须在 1–512 CSS px 内（icon-size 0 除外），超范围明确拒绝而非截断。

`text-font` 当前接受一个字体家族/字面名称，不伪装支持完整 font stack。
可用 `['sans-serif']`、`['serif']`、`['monospace']`、`['Noto Sans SC']`，也接受内置
`['Noto Sans SC Bold']` 等名称。任意自定义字体仍需要真实 TTF/OTF/WOFF1 轮廓 URL。
不实现 MapLibre glyph PBF 或 glyphs URL 模板。

参考 QGIS 的注记设置组织方式，通用文字外观继续放在 `layout / paint`，而高级 GIS 注记行为
放在更直观的 `symbol.labeling`：

```ts
map.setLayerSymbol('roads', {
  layout: { 'text-field': ['get', 'name'], 'text-size': 16, 'text-font': ['Noto Sans SC'] },
  paint: { 'text-color': '#243447', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
  labeling: {
    placement: 'parallel', // auto / horizontal / parallel，沿用原有定位算法
    priority: ['get', 'rank'], // 高值优先，不冒充 symbol-sort-key 的低值优先
    maxLabels: 500,
    // fontUrl: '/fonts/custom.ttf', fontWeight: 700, fontStyle: 'italic',
    // enabled: false,
  },
});
```

`minScale`、`maxScale` 仍为 CSS 像素/源坐标单位，不是 MapLibre zoom 或比例尺分母。
图标通常完全使用 `layout / paint / images`；只有旧接口中的自定义归一化锚点和独立 enabled
需要兼容时，才放在 `symbol.icon: { anchor, enabled }`。显式 `icon-anchor` 始终优先。

## 兼容与验证规则

未提供 `symbol` 的旧 `label` / `icon` 配置与 API 保持原行为。
`symbol` 存在时它是唯一权威配置，`getLayer()` 中的 `label` / `icon` 是映射后的兼容视图；
同一个 addLayer 配置里同时出现时以 symbol 为准，不在两套配置之间猜测优先级。
旧的 `setLayerLabel` / `setLayerIcon` 在这种图层上会同步改写对应 symbol 通道，并保留另一通道。
单属性新接口作用于旧图层时，先无损映射其当前 label/icon，再修改目标属性。

设置时先完成克隆、校验与单位转换，再一次性更新图层；错误不修改原状态或父图层列表。
表达式使用现有安全子集，不引入 eval 或函数回调。当前只有 `text-field` 和
`labeling.priority` 支持属性表达式，颜色、字号、旋转和图标选择仍为图层级常量。
未知键、错误的 layout/paint 分组、多字体 stack、未实现的 `text-anchor`、`symbol-sort-key`、
`icon-text-fit`、`text-opacity` 等都会明确拒绝，不能把名称接收成功等同于效果实现。

## 测试与示例

原有 benchmark、2.5D、顶点编辑页面的注记/图标面板改为写入 symbol。
字号和偏移分别展示 px/em，图标同时展示基准尺寸与缩放倍率，并可以展开查看实际 symbol JSON。

```sh
pnpm exec vitest run src/engine/map/symbol.test.ts src/engine/map/symbol-compat.test.ts \
  src/engine/map/symbol-layer.test.ts src/engine/providers/workspace/layers.test.ts
pnpm build && pnpm examples:build
pnpm exec playwright test --config playwright.luma.config.mjs luma-symbols.spec.mjs
```

浏览器检查对同一数据、同一相机比较映射配置与旧原生配置的完整 RGBA SHA-256；
另验证样式调整时沿用 MSDF 图集和点 GPU buffer、UI 数据回写、错误回滚与图层 ID 不变。

单位与属性名称参考：
- https://maplibre.org/maplibre-style-spec/layers/#icon-size
- https://maplibre.org/maplibre-style-spec/layers/#icon-offset
- https://maplibre.org/maplibre-style-spec/layers/#text-offset
