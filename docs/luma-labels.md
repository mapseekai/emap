# 点、线、面绑定式文字注记

## 接入与所有权

注记保存在现有 `LayerSpecification.label` 中；图层类型仍只有 `circle`、`line`、`fill`。
不会为文字创建额外的数据源、图层 ID 或图层树节点。
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
现有安全样式表达式（如 `['get', 'name']`、`match`）。不是 QGIS 表达式解析器，
不接受 JavaScript 回调或 eval。空值、空字符串和对象不产生注记，数值 0/false 可以显示。

默认 Emap Canvas 路径具有同一配置和定位能力；luma 路径在现有 GPU RenderPass
内绘制文字。未开启注记不创建字体图集或注记空间索引，未改变默认渲染后端。

## luma 示例测试

在 Mac 上运行 `pnpm examples:luma`，或复用已经运行的 4187 服务。

- `/mapseekai/emap/examples/luma-benchmark/`：加载原有本地数据，在页面下方展开“图层注记”。
- `/mapseekai/emap/examples/luma-25d/`：在侧栏底部展开“图层注记”；演示数据已有 name/code 字段。
- `/mapseekai/emap/examples/luma-vertex-editing/`：同一个设置面板，编辑提交后按数据版本刷新。

在“所属矢量图层”中选择已有图层、字段并启用；可以分别设置点、线、面。
这只是父图层的设置面板，不是一个新的注记图层树。
混合 GeoJSON 的不同几何图层可能共享显示名称，luma 内部通过显式序号调用
`resolveLayerInList` 定位原始图层，不使用易混淆的同名匹配。已有字符串匹配规则不变。

## 定位和绘制

点注记尝试八个周边位置；MultiPoint 每个要素最多显示一处注记。
线注记选择最长可见线段链，在其中点按局部方向整体旋转，保持正向可读；
`placement: 'horizontal'` 可强制水平。短于文本的线或明显弯折的候选会跳过。
当前不是逐字随曲线弯曲排版，也没有沿线重复注记。

面注记使用原始环的偶奇填充规则扫描内部跨度，排除孔洞并支持凹面、多部件。
保证锚点在有效面内部，不保证整个文字矩形都在面内；不拆分为每个部件一条注记。
线/面定位不读取显示简化后的顶点，不更改原始坐标和拓扑。

所有图层共享屏幕包围盒碰撞网格；优先级高者先放置，相同优先级优先上层图层。
允许重叠时可覆盖已有注记；默认不重叠。避让使用保守旋转矩形，不是 QGIS PAL
全局最优排布；当前也没有几何障碍物、引线、规则式注记或手动保存的位置覆盖。

## MSDF 文字渲染

luma 文字路径使用真正的 RGB 多通道有符号距离场（MSDF），不是把 Canvas 位图复制到
三个通道。HarfBuzz 先按 bidi、脚本和字体段排版，输出 glyph ID、advance 和 offset；
msdfgen/FreeType 从同一份字体轮廓按 glyph ID 生成距离场。因此连字、组合附加符号
不被错误地当作独立 Unicode 字符平均排列。中文/拉丁和 NFC/NFD、ffi 连字有自动化测试。
这是水平排版路径，未实现竖排、彩色 emoji 和完整浏览器 CSS 字体匹配。

字形在独立的 `emap-msdf-worker.js` 中按需生成，空间索引、注记定位/避让保持原来的
绑定模型。只对放置通过的注记生成缺失字形；重复字形跨标签共享。每个字形一个 GPU
实例，线注记仍是整段文字平行旋转，不等同于逐字沿曲线布局。

MSDF 图集以线性 `rgba8unorm` 数据纹理上传，RGB 保存距离、A 固定为 255；着色器
使用 RGB 中位数恢复轮廓。字号、文字颜色、描边颜色/宽度不是普通字形缓存键，
描边与填充分两个 pass 绘制；不同重叠注记保留合成顺序。相同字形在 DPR 1/2、
12/24/48/96 px 下复用纹理。默认以 48 px/em、32 px 距离范围生成，不是无限分辨率：
极小字号的细笔画仍受像素网格影响。异常宽的描边需要更宽的距离范围档（64/128/256），
此时会生成对应档位，而不是裁掉描边或声称绝不重新生成。

最终字号和描边为 CSS 像素，2.5D 文字面向屏幕。MSDF 改善真正重绘时的缩放和描边，
不会让旧截图变成矢量：快速导航的整帧快照期间文字仍暂随旧画面变换，停止后刷新。
默认 Emap Canvas 兼容路径保留浏览器文字位图；luma-benchmark 切到 Canvas 对照时，
使用相同排版字形的轮廓 Path2D，而不是把彩色距离场直接画出来。

### 字体资源

MSDF 必须取得字体轮廓，不能从任意系统 CSS 字体名中读取字形。luma 示例默认自托管
Noto Sans SC、Noto Serif SC 和 Noto Sans Mono（等宽字体缺少中文时回退 Sans SC）。
默认资源提供 regular/bold 两档，数值字重以 600 为分界；没有字体文件时 italic 使用
合成倾斜，不伪称原生斜体。需要特定字体/字重时提供对应字体文件：

```ts
// 给已有父图层配置；fontUrl 仅用于 MSDF 轮廓加载，不创建文字图层。
renderer.setLayerLabel('vector-0', {
  field: 'name', fontFamily: 'My GIS Font', fontUrl: '/fonts/my-gis-font.woff',
  fontSize: 20, color: '#243447', haloColor: '#ffffff', haloWidth: 2,
});
```

支持 TTF、OTF、WOFF1，WOFF2 明确拒绝；HTTP(S) 字体须满足同源/CORS，支持宿主授权的
blob URL，不扫描用户系统字体。自定义字体 URL 应版本化；替换字体文件内容后需要更换 URL 或重载页面。未注册的字体名必须提供 `fontUrl`，不会假装使用该字体。
缺字计数可在诊断中查看，缺字不会偷偷退回 RGBA 系统字体。资源失败只报告注记错误，
不冻结点线面地图；修正设置可重试。默认 Noto 文件按 Unicode 子集懒加载，不访问外部 CDN。
构建产物约 18 MiB（含多字体/字重资源），不是每次打开页面的下载量。

`pnpm build` 生成 Worker/WASM/字体资源；修改 Worker 后可单独执行 `pnpm build:msdf`，
然后 `pnpm examples:build`。部署需保留 `emap-msdf-worker.js` 与旁边的 `msdf/` 目录。
所有默认字体来自锁定的 Fontsource OFL 包，授权声明随资源复制，不包含系统字体。

## 预算、缓存和边界

布局任务串行、可取消，按小时间片处理；结果过期则不发布，等待期间不展示错误位置的文字。
索引按原图层和几何版本缓存，面内部锚点可跨相机变化复用；MSDF 的字体/字形缓存与视图分离，取消和销毁会终止相关 Worker 工作。
注记优先级只在当前候选预算内比较，不保证超出预算的全部数据仍参与全局排序。

当前每个视图最多处理 20,000 个候选，最多显示 2,000 条注记；每个图层默认最多
1,000 条，`maxLabels` 可设 1–10,000，但仍受全视图上限约束。
文字最长 256 个 Unicode 码点、最多 4 行，过大或图集容纳不了的文字会跳过。
字号范围 6–96 CSS px，描边 0–12 CSS px；MSDF 生成分辨率独立于显示 DPR。
`minScale` / `maxScale` 使用 CSS 像素/源坐标单位，不是地理比例尺分母或 WebMercator zoom。

字体图集最多 4 张 1024×1024 RGBA 纹理，CPU 与 GPU 各最多约 16 MiB；
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
