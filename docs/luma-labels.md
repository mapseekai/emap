# 点、线、面绑定式文字注记

推荐新代码使用父图层的 `symbol.layout / symbol.paint`；以下原生接口仍然兼容。
参见 [附属 Symbol 样式映射](luma-symbol-style.md)。


## 接入与所有权

注记通过 `LayerSpecification.label` 绑定到 `circle`、`line`、`fill` 父图层，共用数据源、图层 ID 和图层树节点。
父图层隐藏、移除、过滤时，注记一起更新；修改属性或几何后使用对应版本重新布局。
`getLayer()` / `getLayers()` 返回的注记配置包含独立的表达式数组和 offset 副本。

```ts
map.addLayer({
  id: 'cities', source: 'cities', type: 'circle',
  paint: { 'circle-radius': 5, 'circle-color': '#2563eb' },
  label: { field: 'name', fontSize: 16, color: '#243447', haloColor: '#ffffff', haloWidth: 2 },
});
map.setLayerLabel('cities', {
  field: 'name', fontSize: 18, offset: [2, -2],
  allowOverlap: false, priority: ['get', 'population'],
});
map.setLayerLabel('cities', null); // 只移除注记，保留城市图层
```

`setLayerLabel` 替换整个 label 配置，不做隐式深合并。未知图层或非法配置会抛错；
校验失败不修改先前配置。`field` 与 `text` 二选一；`text` 可以是固定字符串或
现有安全样式表达式（如 `['get', 'name']`、`match`）。表达式使用 emap 的安全子集，
JavaScript 回调或 eval 会被拒绝。空值、空字符串和对象不产生注记，数值 0/false 可以显示。

Canvas 路径具有同一配置和定位能力；luma 路径在现有 GPU RenderPass
内绘制文字。字体图集和注记空间索引在启用注记后按需创建。

## luma 示例测试

在 Mac 上运行 `pnpm examples:luma`，或复用已经运行的 4187 服务。

- `/mapseekai/emap/examples/luma-benchmark/`：加载原有本地数据，在页面下方展开“图层注记”。
- `/mapseekai/emap/examples/luma-25d/`：在侧栏底部展开“图层注记”；演示数据已有 name/code 字段。
- `/mapseekai/emap/examples/luma-vertex-editing/`：同一个设置面板，编辑提交后按数据版本刷新。

在“所属矢量图层”中选择已有图层、字段并启用；可以分别设置点、线、面。
面板直接修改父图层的注记配置。
混合 GeoJSON 的不同几何图层可能共享显示名称，luma 内部通过显式序号调用
`resolveLayerInList` 定位原始图层，不使用易混淆的同名匹配。已有字符串匹配规则不变。

## 定位和绘制

点注记尝试八个周边位置；MultiPoint 每个要素最多显示一处注记。
线注记选择最长可见线段链，在其中点按局部方向整体旋转，保持正向可读；
`placement: 'horizontal'` 可强制水平。短于文本的线或明显弯折的候选会跳过。

面注记使用原始环的偶奇填充规则扫描内部跨度，排除孔洞并支持凹面、多部件。
每个要素使用位于有效面内部的锚点；文字矩形可延伸到面外，多部件共用一条注记。
线/面定位不读取显示简化后的顶点，不更改原始坐标和拓扑。

所有图层共享屏幕包围盒碰撞网格；优先级高者先放置，相同优先级优先上层图层。
允许重叠时可覆盖已有注记；默认不重叠。避让使用保守旋转矩形与当前候选的优先级顺序。

## MSDF 文字渲染

luma 文字路径使用 RGB 多通道有符号距离场（MSDF）。
HarfBuzz 先按 bidi、脚本和字体段排版，输出 glyph ID、advance 和 offset；
msdfgen/FreeType 从同一份字体轮廓按 glyph ID 生成距离场。因此连字、组合附加符号
不被错误地当作独立 Unicode 字符平均排列。中文/拉丁和 NFC/NFD、ffi 连字有自动化测试。
MSDF 提供水平轮廓排版；彩色 emoji 可通过下述浏览器位图回退显示。

字形在独立的 `emap-msdf-worker.js` 中按需生成，空间索引、注记定位/避让保持原来的
绑定模型。只对放置通过的注记生成缺失字形；重复字形跨标签共享。每个字形一个 GPU
实例，线注记按整段文字平行旋转。

MSDF 图集以线性 `rgba8unorm` 数据纹理上传，RGB 保存距离、A 固定为 255；着色器
使用 RGB 中位数恢复轮廓。字号、文字颜色、描边颜色/宽度在普通字形缓存之外处理，
描边与填充分两个 pass 绘制；不同重叠注记保留合成顺序。相同字形在 DPR 1/2、
12/24/48/96 px 下复用纹理。默认以 48 px/em、32 px 距离范围生成，其有限生成分辨率意味着
极小字号的细笔画仍受像素网格影响。异常宽的描边需要更宽的距离范围档（64/128/256），
此时会生成对应档位，以完整容纳所需描边。

最终字号和描边为 CSS 像素，2.5D 文字面向屏幕。MSDF 改善真正重绘时的缩放和描边，
不会让旧截图变成矢量：快速导航的整帧快照期间文字仍暂随旧画面变换，停止后刷新。
默认 Emap Canvas 兼容路径保留浏览器文字位图；luma-benchmark 切到 Canvas 对照时，
使用相同排版字形的轮廓 Path2D，并以轮廓填充和描边生成画面。

### 字体资源

MSDF 使用字体文件中的轮廓生成字形；自定义字体需提供可读取的轮廓资源。luma 示例默认自托管
Noto Sans SC、Noto Serif SC 和 Noto Sans Mono（等宽字体缺少中文时回退 Sans SC）。
默认资源提供 regular/bold 两档，数值字重以 600 为分界；没有字体文件时 italic 使用
合成倾斜。需要原生斜体、特定字体或字重时，提供对应字体文件：

```ts
// 给已有父图层配置；fontUrl 仅用于 MSDF 轮廓加载，不创建文字图层。
renderer.setLayerLabel('vector-0', {
  field: 'name', fontFamily: 'My GIS Font', fontUrl: '/fonts/my-gis-font.woff',
  fontSize: 20, color: '#243447', haloColor: '#ffffff', haloWidth: 2,
});
```

支持 TTF、OTF、WOFF1，WOFF2 明确拒绝；HTTP(S) 字体须满足同源/CORS，支持宿主授权的
blob URL，不扫描用户系统字体。自定义字体 URL 应版本化；替换字体文件内容后需要更换 URL 或重载页面。未注册的字体名必须提供 `fontUrl`，不会假装使用该字体。
MSDF 缺少字形时，整段文字复用浏览器字体图集并由 GPU 合成，保留浏览器的文字排版和
彩色 emoji；正常字形仍走 MSDF。诊断 `missingGlyphs` 保留轮廓缺字数，
`bitmapFallbackLabels` 显示本次布局实际使用位图回退的标注数。回退文字的测量和绘制
使用同一浏览器字体，依赖该设备可用字体；图集有独立的四页上限，并计入 atlas 内存统计。
回退文字改变颜色、字号或 DPR 时需要重新栅格化，采用对应字号和 DPR 的位图缓存。
字体 URL 加载失败仍报告注记错误，
不冻结点线面地图；修正设置可重试。默认 Noto 文件按 Unicode 子集懒加载，不访问外部 CDN。
构建产物约 18 MiB（含多字体/字重资源），每次打开页面按使用的字体子集下载。

`pnpm build` 生成 Worker/WASM/字体资源；修改 Worker 后可单独执行 `pnpm build:msdf`，
然后 `pnpm examples:build`。部署需保留 `emap-msdf-worker.js` 与旁边的 `msdf/` 目录。
所有默认字体来自锁定的 Fontsource OFL 包，授权声明随资源复制，不包含系统字体。

## 布局预算与缓存管理

布局任务串行、可取消，按小时间片处理；结果过期则不发布，等待期间不展示错误位置的文字。
索引按原图层和几何版本缓存，面内部锚点可跨相机变化复用；MSDF 的字体/字形缓存与视图分离，取消和销毁会终止相关 Worker 工作。
注记优先级只在当前候选预算内比较，超出预算的数据需调整候选范围后参与排序。

当前每个视图最多处理 20,000 个候选，最多显示 2,000 条注记；每个图层默认最多
1,000 条，`maxLabels` 可设 1–10,000，但仍受全视图上限约束。
文字最长 256 个 Unicode 码点、最多 4 行，过大或图集容纳不了的文字会跳过。
字号范围 6–96 CSS px，描边 0–12 CSS px；MSDF 生成分辨率独立于显示 DPR。
`minScale` / `maxScale` 使用 CSS 像素/源坐标单位，接入时按源坐标单位换算。

MSDF 图集最多 4 张 1024×1024 RGBA 纹理，位图回退另有最多 4 张，
两者当前图集的 CPU 与 GPU 载荷各最多约 32 MiB；旧显示帧持有的页面在替换后释放。
字形实例最多 65,536 个/视图；排版缓存最多 4,096 条，另有字形数量预算。
Worker 原始字体缓存约 32 MiB 上限，实际 WASM 堆单独报告；这些限制不等于浏览器总内存。
原始数据、空间索引、实例缓冲和 Worker 的临时结果不计入上述图集预算。
稳定视图重复绘制不会重新上传字图集或实例缓冲。删除、清空和销毁会释放资源。
大量要素首次建立空间索引、极复杂单面/长线的定位仍有成本；没有以小演示数据宣称大数据 FPS。

## 验证入口

```sh
pnpm build
pnpm exec vitest run src/engine/map/label.test.ts src/engine/rendering/labels \
  src/engine/providers/workspace/layers.test.ts src/engine/map/layer-registry.test.ts \
  src/integrations/msdf src/integrations/luma/msdf-text-renderer.test.ts
pnpm examples:build
pnpm exec playwright test --config playwright.luma.config.mjs luma-labels.spec.mjs
```

浏览器回归按每条已放置注记的屏幕范围检查真实着色像素，而不只检查布局数量。
覆盖 WebGL2/WebGPU、二维/2.5D、点线面混合导入、同名图层、中文、沿线方向、
父图层显隐、属性更新、字体纹理复用和资源释放；另有默认 Emap 的过滤/显隐/移除测试。

设计参考：deck.gl TextLayer 使用字体图集和实例化图标；QGIS 标签设置属于矢量图层属性。
参考只用于设计方向，不表示此实现具备它们的所有功能。
- https://deck.gl/examples/text-layer
- https://deck.gl/docs/api-reference/layers/text-layer
- https://docs.qgis.org/3.44/en/docs/user_manual/style_library/label_settings.html

MSDF 实现参考与锁定依赖：
- https://github.com/Chlumsky/msdfgen （轮廓距离、中位数重建、线性采样）
- https://github.com/md5crypt/msdfgen-wasm （`msdfgen-wasm@1.0.0`）
- https://github.com/harfbuzz/harfbuzzjs （`harfbuzzjs@0.10.3`，显式销毁接口）
- https://github.com/lojjic/bidi-js （`bidi-js@1.0.3`）

`patches/msdfgen-wasm@1.0.0.patch` 只开放上游已有 WASM factory 的包导出，以便用
HarfBuzz 的 glyph ID 直接生成。没有维护自制 MSDF 算法或改写上游 WASM 字节。
