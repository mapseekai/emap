# 现有点图层的图片符号

推荐新代码使用父图层的 `symbol.layout / symbol.paint`；以下原生接口仍然兼容。
参见 [附属 Symbol 样式映射](luma-symbol-style.md)。


## 配置与所有权

图标保存在 `CircleLayerSpecification.icon`，不新增 icon 图层、数据源或图层树节点。
点图层 ID、原始坐标、属性、MultiPoint、现有点聚合和 `label` 注记保持原来的所有权。
`Emap.setLayerIcon(id, options)` 替换整个配置；传 `null` 恢复普通点。
非点图层拒绝 icon 配置，非法配置不会覆盖旧配置；读取配置会复制嵌套数组。

```ts
map.addLayer({
  id: 'poi', source: 'poi', type: 'circle',
  paint: { 'circle-radius': 4, 'circle-color': '#2563eb' },
  icon: { url: '/images/poi.png', size: 32, anchor: [0.5, 1] },
  label: { field: 'name', fontSize: 14, haloWidth: 1.5 },
});
map.setLayerIcon('poi', {
  url: '/images/poi.png', size: 40, anchor: [0.5, 1],
  rotation: 25, offset: [0, -2], opacity: 0.8,
});
map.setLayerIcon('poi', null);
```

| 属性 | 行为 |
| --- | --- |
| `url` | PNG/JPEG/WebP 或自包含 SVG 的 URL；支持 HTTP(S)、blob 和 image data URL |
| `enabled` | 默认开启；false 保留配置并显示原点符号 |
| `size` | 默认 32；数字代表 CSS 像素高度并保持宽高比，数组表示显式 `[宽,高]` |
| `anchor` | 裁剪图片中的归一化锚点；默认 `[0.5,0.5]`，定位针通常为 `[0.5,1]` |
| `rotation` | 屏幕空间顺时针角度，围绕锚点旋转，默认 0 |
| `offset` | 旋转后额外的屏幕 CSS 像素偏移 `[x,y]`，默认 `[0,0]` |
| `opacity` | 0–1，默认 1 |
| `tint` | 可选 CSS 颜色；设置后保留图片 alpha，用指定颜色替换 RGB；省略保留原色 |
| `rect` | 可选图集像素裁剪 `[x,y,width,height]`，必须完整位于图片内 |

尺寸每个维度限 1–512 CSS px；数字尺寸按宽高比解析后也不得超过 512。
偏移限 ±512，裁剪像素为整数。透明度独立于原来的 circle paint。
原 circle paint 保留，用于关闭、加载期间或失败后的普通点回退。

## 共享图集

多个点图层使用同一个 `url` 和不同 `rect` 时，只读取、解码和上传一次图片。
例如图集中第二个 64×64 图标：

```ts
map.setLayerIcon('poi', {
  url: '/images/poi-atlas.png', rect: [64, 0, 64, 64],
  size: 32, anchor: [0.5, 1], tint: '#d93456',
});
```

此版本每个点图层使用一种图标配置。没有自动打包任意 URL 成新图集，也没有新增
逐要素的 icon 字段映射；已有 filtered 点图层可以各自配置符号。

## 渲染与性能

luma 在原来的点/LOD GPU Buffer 上实例化图标四边形；不复制整套点数据，不在主线程
逐点重新计算屏幕坐标。高低位坐标和 2.5D billboard 投影复用现有相机。
图标替换的是点图层的绘制步骤，不是最后覆盖到所有图层上；点与线面之间的顺序不变。
文字仍是独立的绑定注记绘制步骤，注记位置会为图标的保守屏幕范围留空。

着色、透明度、尺寸、偏移和旋转在 GPU 中处理；同一图片这些参数改变不重新上传纹理。
图集采样限制在裁剪区内，防止线性采样读到相邻图标。默认始终面向屏幕且保持 CSS 尺寸。
图片本身不是 MSDF；SVG 以 image 模式一次解码后上传，既不会执行其中的脚本，也不会作为
HTML 插入页面。彩色图片/头像需要保留原色，这与已有 MSDF 文字的距离场路径不同。
低分辨率图片放大仍会变糊，需提供合适分辨率图片。地图手势快照期间沿用上一帧，停止后重绘。

未设置 icon 不建立图标图片缓存，也不发图片请求。启用后沿用现有 point LOD 代表点，
不强制退回全部原始点；图标体积/透明区与 overdraw 仍会改变 GPU 成本，不能据复用缓冲声称 FPS 不变。
点聚合仍是既有的密度显示规则，不是 deck.gl 示例中的带数量聚类图标。

正式 Emap 默认 Canvas 路径使用相同配置、图片、过滤/LOD 选择和层级顺序。
Canvas 着色变体单独受 8 MiB 缓存预算约束；luma 着色不生成额外彩色纹理。

## 加载、安全与释放

图片请求最多并发 4 个，每张编码文件不超过 8 MiB，尺寸不超过 4096×4096；
最多保留 32 张活动图片，解码后的像素合计不超过 32 MiB。GPU 纹理还服从既有 renderer 图片预算。
这些预算不包含浏览器网络/解码临时开销、点数据、注记缓存或 URL 配置字符串。
跨域图片服务需提供 CORS。拒绝非图片 data URL、不支持的协议和带明文用户名/密码的 URL。
SVG 建议自包含并声明 width/height。外部引用及有缺陷的图片可能无法解码，不能作为 DOM/SVG 节点执行。

加载、解码或裁剪失败不冻结底图：保留普通点并报告错误。luma 面板显示失败原因且可重试。
正式 Canvas 通过 warning 事件报告。隐藏/移除最后一个所有者或替换源时取消请求、关闭位图和释放纹理；
晚到的图片会关闭，不得覆盖新配置。相机与样式变化不会重新发起同一图片请求。

拾取和顶点编辑仍依据原始点几何；没有添加整张图标矩形/alpha 像素级拾取，也没有把图标变成可独立编辑的要素。
尚未提供地面贴合 billboard=false、动画图片、规则式逐要素图标映射或图标碰撞避让。

## 现有示例

`pnpm examples:luma` 后打开现有 `luma-benchmark`、`luma-25d` 或 `luma-vertex-editing`。
展开“点图标（替换现有点符号）”，选择已有点图层并开启图标。
面板提供定位针、医院、相机、旗帜预设，可选择本地图片或输入 URL，并调整样式。
预设仅是测试用 SVG 图片，不增加图层类型。切换图片时清除旧图集裁剪区。

## 验证

```sh
pnpm exec vitest run src/engine/map/icon.test.ts src/engine/rendering/icons \
  src/engine/providers/workspace/layers.test.ts src/integrations/luma/gpu-renderer.test.ts
pnpm build && pnpm examples:build
EMAP_BENCHMARK_DATA_DIR='/path/to/authorized/data' \
  pnpm exec playwright test --config playwright.luma.config.mjs luma-icons.spec.mjs
```

浏览器测试使用可验证的 RGBA 图案，检查两套后端的每个实例、透明孔洞、锚点、旋转、
图集 UV、着色/透明度、DPR 2、普通点回退、注记共存和源释放；真实 points.geojson 测试
检查点 LOD 和暖帧坐标/纹理上传次数，不以演示数据代替真实吞吐数据。

参考：deck.gl IconLayer 的图片图集、锚点、屏幕偏移与 mask 设计；未引入 deck.gl。
- https://deck.gl/examples/icon-layer
- https://deck.gl/docs/api-reference/layers/icon-layer
