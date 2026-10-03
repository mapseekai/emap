# Canvas2D、WebGL2 与 WebGPU 能力及验收记录

2026 年 10 月 2 日，基于提交 `3044af15` 和当前本地工作区。先审查已有功能切换到正式 WebGL2 或 WebGPU 后的风险，再按用户要求确认并修复缺陷。保留此前修复示例路由的工作区改动。下文像素表是修复前的复现记录。

## 当前发布验收结论（2026-10-03）

**emap 0.14.0 已通过本地完整 `pnpm run release:verify`，完成约定浏览器范围的本地包发布验收。正式发布时需提交已审核工作区、验证远程发布工作流，再按授权执行标签和发布步骤。** 下文包含历轮失败与修复历史；最终结果以文末“完整门禁通过”记录为准。

验收覆盖 Chrome／Firefox 的 Canvas2D、WebGL2、WebGPU，以及 Playwright WebKit 的 Canvas2D、WebGL2。真实 Safari／WebGPU 按用户要求暂缓；文档安全公告采用有期限的精确豁免，具体路径和到期日见文末。接入实际宿主扩展、字体、设备与业务大文件时，按相同操作流程追加项目验收。文档站此前缺失的 API 参数链接与按语言返回文档入口已补齐，并完成专项人工验收，见文末。

## 已验收能力与使用方式

| 能力 | 可以完成的工作 | 配置与验收依据 |
| --- | --- | --- |
| 三种渲染器 | 用 Canvas2D、WebGL2 或 WebGPU 显示点、线、面、图标、文字与正式栅格瓦片 | 创建时选择 renderer；默认 WebGL2 |
| 共享地图服务 | 复用数据源、图层、样式、查询、过滤、选择、编辑与历史 | 三后端使用同一正式 Emap API |
| 编辑与历史 | 绘制、顶点和边吸附、取消、裁切、线重塑、属性与选择恢复、撤销重做 | 正式编辑浏览器回归覆盖主画布像素与状态 |
| 面与点样式 | even-odd 自交面显示、半透明点叠加、零半径隐藏、独立空心描边 | 几何和点样式回归保留源拓扑及颜色断言 |
| 文字 | MSDF 字形绘制、缺字时浏览器位图回退、跨图层字体错误隔离 | 内置字体或显式 fontUrl；按实际文本验证字体覆盖 |
| 资源生命周期 | Worker 取消、旧结果隔离、GPU 设备恢复及销毁 | 正式渲染器与资源测试覆盖 |
| 可部署包 | 独立 npm 安装、ESM、严格 Bundler 类型检查和浏览器打包 | 最终 tgz 消费者验证及生产依赖审计通过 |

## 初始排查结论（历史记录）

正式地图共用图层、查询、过滤、编辑和历史服务，切换渲染器时可以复用这些 GIS 功能。本轮确认并修复了两个 GPU 后端的自相交面填充消失，以及一个字体配置错误连带隐藏其他正常图层标注的问题。宿主扩展的接入配置与验收步骤见下文。

后续功能完整性复审又确认了默认字体覆盖和点样式语义差异，详见“再次功能完整性复审”的修复前记录。用户随后授权修复，四项差异现已处理，见文末修复记录。专项结果对应报告列出的场景；复杂业务交互、宿主扩展和目标设备按项目追加验收。

这里的“后端”指浏览器渲染后端；luma 的渲染、交互和数据处理在浏览器内运行。

## 已复现的问题

### 自相交编辑结果的面填充消失

建议优先级 P2。影响顶点拖动、改形或外部几何更新后形成自相交环的显示；源数据保持完整。

复现过程：

1. 通过正式 `Emap.create` 和 `TopologySource` 加入普通矩形。
2. 将环坐标改为 `[-2,-2] → [2,2] → [-2,2] → [2,-2] → [-2,-2]`，形成蝴蝶结形状，并调用 `bumpEditVersion`。
3. 设置红色面填充、线宽 0，使用相同范围和画布，等待 GPU 的 `frameComplete`。
4. 读取主画布的红色填充像素。

| 后端 | 红色填充像素 | 结果 |
| --- | ---: | --- |
| Canvas2D | 142844 | 两个区域仍有填充 |
| WebGL2 | 0 | 填充消失 |
| WebGPU | 0 | 填充消失 |

像素数记录本次机器和画布的结果。复现通过直接更新拓扑并增加版本来模拟编辑后输入；鼠标交互由正式编辑用例验证。零有符号面积的 GeoJSON 在直接导入时会经过清理，因此复现使用编辑后的拓扑状态。

原因：GPU 三角化路径用有符号面积为零剔除环，但自相交环的两个区域面积可能抵消；Canvas 使用 even-odd 填充规则，仍可显示这两个区域。

修复前的代码位置：

- [flat-polygon.ts](../src/engine/rendering/luma/flat-polygon.ts) 第 83 行，以及单环路径第 185 行。
- [geometry.ts](../src/engine/rendering/luma/geometry.ts) 第 180 行，小几何路径也有相同判断。
- [canvas-painter.ts](../src/engine/rendering/canvas-painter.ts) 第 1196 行附近，逐要素 `fill('evenodd')`。

修复采用显示层 even-odd 三角化，保留源拓扑。正常轮廓仍走原 Earcut 路径；检测到自交、轮廓交叠或接触时使用 `libtess`，交点只加入绘制网格。短环批量路径也转入支持新增交点的路径。新增测试覆盖零面积与非零面积自交、重叠轮廓、重复轮廓、孔洞中的自交、较大坐标和批量短环，并用独立射线奇偶规则核对随机轮廓。数学病态输入与业务大文件可按相同步骤追加数据验收。

### 字体配置错误导致跨图层标注消失（已修复）

建议优先级 P1，尤其是允许用户配置字体或加载外部样式的产品。

复现过程：

1. 加入一个点图层，标注使用 `sans-serif`，颜色 `#00aaee`、24px，等待文字显示。
2. 再加入独立点图层，标注使用 `fontFamily: 'Arial'`，不提供 `fontUrl`。
3. 等待文字任务结束，读取文字颜色像素。

| 后端 | 加入前文字像素 | 加入后文字像素 | 结果 |
| --- | ---: | ---: | --- |
| Canvas2D | 1002 | 2461 | 两层文字均显示 |
| WebGL2 | 998 | 0 | 原来正常的文字也消失 |
| WebGPU | 998 | 0 | 原来正常的文字也消失 |

GPU 报错为 `MSDF cannot read system font outlines. Supply fontUrl for this fontFamily.`。MSDF 使用真实字体轮廓；这里确认的缺陷是字体错误扩散至其他图层。`stats.placed` 可能保留上一轮结果，验收时应同时检查当前帧像素。

修复前的原因链：

- [atlas.ts](../src/integrations/msdf/atlas.ts) 第 33–45 行拒绝未提供 URL 的非内置字体。
- [manager.ts](../src/engine/rendering/labels/manager.ts) 第 412 行对多个图层的候选一起 `prepare`；异常中断整个布局任务。
- 同文件第 189–202 行报告异常，但新内容不能复用旧 frame，返回空标注帧。

修复后正常图层继续合批；失败时拆分定位图层，报告包含图层 ID 的错误，并重新排版其余图层，释放失败图层占用的碰撞空间和字形预留。字体修正后自动重试，过期或取消的任务不会排除新任务中的图层。覆盖 `prepare`、`prepareGlyphs`、`measure`、`reserve`、`get` 五个阶段的隔离与恢复。

迁移时为 MSDF 提供可读取的 TTF、OTF 或 WOFF1 字体文件，格式校验见 [woff.ts](../src/integrations/msdf/woff.ts)。后续缺字修复通过浏览器位图路径使用系统字体与彩色 emoji，详见“四项功能差异的修复”。

## 渲染器接入配置

| 能力或接入点 | 当前行为 | 使用方式 |
| --- | --- | --- |
| 默认渲染器 | 正式地图默认 WebGL2 | 通过 renderer 显式选择 Canvas2D、WebGL2 或 WebGPU |
| 更换渲染器 | 创建实例时选择；示例按钮重新加载页面 | 保存编辑与数据，重新创建地图并恢复所需业务状态 |
| GPU 初始化与回退 | 创建失败通过 Promise reject 返回 | 宿主捕获错误后可显式创建 Canvas2D 地图 |
| 自定义 Provider | provider.canvas2d 可替代默认 provider.renderer | 按插件组合配置 painterFactory，用 getRenderer() 核对实际后端 |
| 绘制扩展 | RenderPass 使用 CorePainter 契约 | 将扩展绘制映射到 CorePainter；Canvas 专用绘制选择 Canvas2D |
| 异步初始化 | GPU、管线和依赖服务就绪后提供地图 | await Emap.create() 或 map.ready 后访问画布及 Handler |
| 截图与绘制完成 | 冷几何通过 Worker 渐进生成 | 宿主建立场景就绪检查，结合资源完成与画布呈现状态取样 |
| 标注字体 | HarfBuzz/MSDF 配合默认 Noto 子集，缺字使用浏览器位图回退 | 提供覆盖目标文字的 TTF、OTF 或 WOFF1 字体，检查字重、斜体、避让和字号 |
| 静态资源 | 几何/MSDF Worker、WASM 与字体按需加载 | 部署 Worker 和同级 msdf 目录，按打包路径配置 geometryWorkerUrl、msdfWorkerUrl |
| 数据版本 | GPU 缓存跟随源身份、几何和属性版本 | 使用正式编辑 API；直接修改 dataset 时更新对应版本 |
| 大数据 | 分块准备、传输、上传与预算控制 | 用业务数据测首屏、拖动、回全图、编辑和峰值内存 |
| 正式栅格 | 数据服务读取、着色、重投影瓦片，Painter 负责合成 | 用正式 GeoTIFF 示例验收栅格业务；原生整数纹理使用专用实验入口 |
| 2.5D | 专用实验提供 pitch/bearing 相机 | 在对应实验中验证相机效果；正式地图提供二维编辑、拾取和测量 |

本表介绍源码确认的配置契约；下文按阶段保存实际测试及修复证据。

依据：[renderer.ts](../src/engine/map/renderer.ts)、[renderer-plugin.ts](../src/engine/providers/workspace/renderer-plugin.ts)、[presets/index.ts](../src/runtime/presets/index.ts)、[renderer-choice.ts](../packages/examples/src/renderer-choice.ts)、[render.ts](../src/runtime/services/contracts/render.ts)、[正式三后端说明](renderer-backends.md)。

## 首轮功能覆盖记录（历史）

| 功能组 | 本轮判断 |
| --- | --- |
| 常规点线面、孔洞、样式和过滤 | 共用正式图层逻辑；实际 GPU 回归结果见下节；不覆盖任意无效几何 |
| 点击查询、选择、平移选中要素、顶点拖动、撤销重做 | 正式三后端浏览器用例覆盖部分完整链路；复杂真实文件另需数据验收 |
| 绘制、切割、改形、环／部件编辑、测量、吸附 | 原 Handler／命令与 Canvas 覆盖层仍保留；本轮未逐项完成三后端鼠标交互矩阵，不能宣称全部验收 |
| 标注、图标、Symbol 映射 | 共用配置与所属图层逻辑，绘制路径不同；已修复字体错误隔离，字体资源和格式边界仍需适配 |
| 栅格／混合图层 | 需要区分正式瓦片合成与实验原生整数纹理；真实 TIFF 未提供时专项用例会跳过 |
| 数据导入导出、拓扑处理、DuckDB | 这些功能不直接由 Painter 实现；没有发现单纯选择 renderer 必须重写它们的证据；全量单元测试之外，未逐一验收全部格式和 SQL 的浏览器流程 |
| MapLibre 底图 | 独立 DOM／画布容器组合，不直接要求 Emap 主画布是 2D；本轮未做三后端底图像素验收 |

## 修复前的审查验证记录

- 渲染、luma、栅格、几何及生命周期：60 个测试文件、589 项测试通过。
- MSDF 及额外检查：5 个文件、12 项测试通过。
- 编辑命令、历史、交互 Handler、测量和相关集成：41 个文件、410 项测试通过。这些测试覆盖共享逻辑；三后端鼠标操作以浏览器用例记录为准。
- 上述三组 Node/jsdom 测试合计 1011 项通过。
- 最新构建的 Chrome 浏览器检查共 70 项：48 通过、21 跳过、1 失败。跳过项依赖未提供的真实大文件，包含五种矢量文件编辑、真实点数据标注／图标、真实矢量导航及 TIFF 场景。
- 失败项为 `map-renderers.spec.mjs:293` 的 `webgl2: style/filter/source invalidations replace snapshots during a live gesture`。失败在第 302 行，期待 GPU replay 计数增加，实际为 0；此前绿色点像素断言已通过。随后独立重复 3 次全部通过。将它列为尚未稳定复现的导航策略／测试时序风险，不能写成已经证实的样式或过滤失效，也不能隐去首次失败。自适应导航可选择位图变换，是否与计数断言冲突仍需单独记录诊断。
- 通过的正式三后端场景包括常规点线面与孔洞、图层过滤与显隐、点选择／平移、顶点拖动／撤销、图标与文字、正式 GeoTIFF 合成、分数 DPR、动画中断、WebGL2／WebGPU 设备恢复及销毁。专用实验的结果对应各自实验入口。
- 使用最新开发 bundle 的三后端针对性复现确认了上面两个问题。
- 生产 Rollup bundle 和 examples 构建已重新生成。初次浏览器执行使用旧生产 bundle，出现当前源码已有方法不存在等错误；那轮已作废，不作为缺陷或通过证据。
- GitNexus 本地索引已更新到当前提交；最后写全局 registry 被权限限制。后续使用本地 CLI 查询，确认 flatPolygonGeometry → build → buildGeometryPacket → Worker 的影响链；不依赖旧服务端索引作结论。

本地复现脚本保存在 `test-results/luma-migration-audit/reproduce.mjs`，通过 ego-browser 的现有测试 TaskSpace 使用页面内正式 Emap API。测试辅助脚本和日志在被忽略的 test-results 中，作为独立的验收证据保存。

主要命令：

```sh
pnpm exec vitest run src/integrations/luma src/engine/rendering src/engine/map/renderer.test.ts src/engine/map/layer-renderer.test.ts test/integration/runtime/renderer-lifecycle.test.ts
pnpm exec vitest run src/integrations/msdf src/engine/providers/workspace/render.test.ts
pnpm exec vitest run src/domain/edit src/engine/core/handlers test/integration/edit test/integration/interaction src/domain/geo/measurement.test.ts
pnpm exec playwright test --config playwright.luma.config.mjs test/browser/map-renderers.spec.mjs test/browser/luma-labels.spec.mjs test/browser/luma-icons.spec.mjs test/browser/luma-symbols.spec.mjs test/browser/luma-editor.spec.mjs test/browser/luma-navigation.spec.mjs test/browser/luma-raster.spec.mjs --reporter=line
pnpm exec playwright test --config playwright.luma.config.mjs test/browser/map-renderers.spec.mjs --grep 'webgl2: style/filter/source invalidations' --repeat-each=3 --reporter=line
```

未执行完整 release gate，未发布。未取得外部项目中用户自写功能的代码，关于自定义 Provider、截图和直接 Canvas 操作的影响是基于本仓库接口边界的检查，仍需对接实际宿主。

## 修复实现与验证

实现范围：

- 新增 [polygon-tessellation.ts](../src/integrations/luma/polygon-tessellation.ts)，以 `libtess@1.2.2` 实现显示层 even-odd 三角化。检测阶段对较长轮廓使用已有 Flatbush 空间索引；普通轮廓保留原三角化路径。新增依赖已锁定，未升级其他依赖。
- 将该判断接入普通几何、扁平几何及批量短环路径。交点不会写回 `TopologySource`，原有编辑、撤销重做和版本机制保持原契约。
- 标注错误隔离在 `BoundLabelManager` 内部完成；正常批处理不变，异常图层不占用其他图层的碰撞或字形预算，修正配置后重新尝试。
- 导航偶发失败已定位为测试假设过窄：[render.ts](../src/engine/providers/workspace/render.ts) 的 `_applyFastTransform` 在帧耗时超过阈值时合法使用 CSS 快照变换，replay 计数不会增加。自适应失效测试现接受两条实际导航路径；专门验证快速回放的测试固定“快设备”耗时输入，与已有“慢设备”测试对称。两者仍使用真实 GPU 提交和像素，并继续验证位置、颜色、过滤、上传次数和销毁。本轮没有更改导航策略。

验证结果：

- 修复前新增回归中 7 项失败；当前三组重点测试 35 项全部通过，包括随机轮廓的独立奇偶覆盖检查、五阶段标注异常、取消与恢复、正常跨图层批处理。
- 全量 Vitest 首轮：4382 通过、56 跳过、2 个超时。201 MiB 压缩包测试和 15 万顶点路径测试与生产构建同时运行；单进程复查中前者通过、后者仍略超默认 5 秒。以 `--maxWorkers=1 --testTimeout=20000` 复核这两个文件，94 项全部通过。没有修改用例的断言或仓库默认超时时间；首轮全量检查不能表述为零失败。
- 针对性真实 Chrome 回归 7 项全部通过：三后端自交面像素与源顶点保持、两个 GPU 后端的系统字体配置失败、HTTP 404 字体失败与恢复，以及两个 GPU 后端的导航失效处理。
- 相关浏览器套件首轮共 75 项：53 通过、21 因缺少真实数据文件跳过、1 个快速回放计数断言失败。该断言与此前的自适应策略误报原因相同，随后按上述方法固定了快设备测试条件；没有删除 GPU 回放计数、像素或上传断言。
- 修正测试条件后，完整正式渲染器浏览器文件重跑 **31 项全部通过，无跳过**。包括三后端编辑与撤销、标注、几何、GeoTIFF、发布版 ESM、快速／慢速导航、样式失效、动画中断、设备恢复与资源释放。其余已通过的相关浏览器文件未作修改，没有重复运行。
- TypeScript 源码检查、类型契约检查、声明生成、架构检查、测试布局检查、修改文件 lint、生产构建、示例构建及 bundle smoke 通过。Bundle smoke 验证了 11 个必要文件和 36 个 package export 目标。
- 开发 IIFE bundle 已更新，现有 5173 服务的 `geopackage-viewer/index.html` 返回 HTTP 200。

新增的浏览器回归位于 [map-renderers.spec.mjs](../test/browser/map-renderers.spec.mjs)。真实大文件与目标浏览器设备仍需业务数据验收；本轮没有执行发布流程。

## 建议迁移顺序

1. 本轮已修复自相交显示和标注错误隔离，并加入正式后端的浏览器回归。
2. 清点宿主自定义 Painter、直接 2D context 绘图、截图完成条件及字体资源。
3. 先迁移只读浏览场景，再迁移编辑；每批使用相同数据和业务操作对照。
4. 用实际大文件补测新增／删除／分割／合并／改形／孔洞、取消、撤销重做、过滤中编辑、源替换及快速缩放。
5. 最后在目标 Chrome、Safari、Firefox 和受限 GPU 设备上验证初始化失败处理、设备恢复及资源释放。

## 本地跟踪记录

用户随后授权确认并修复，以上实现保存在本地工作区。未获外部 issue 写入授权，当前工具也没有可用 Multica 连接；其余迁移边界保存在本地报告。未创建外部 issue、提交或推送代码。

## 再次功能完整性复审

范围：同一提交及当轮工作区修复后的开发 bundle；在实际 Chromium 中创建正式 `Emap`，分别指定 `canvas2d`、`webgl2`、`webgpu`。检查共享业务服务、三种 Painter、MSDF 字体和回归覆盖，并核对实际操作及画布像素。

### 新确认的差异

以下优先级针对“原 Canvas2D 项目直接切换后端”的迁移场景。

#### P2：默认字体的多语言字形覆盖差异（已修复）

复现：点图层使用 `fontFamily: 'sans-serif'`、24px，依次显示 `Hello`、`北京上海`、`مرحبا`、`नमस्ते`、`😀`，不设置 `fontUrl`。

| 文字 | Canvas2D | WebGL2 | WebGPU |
| --- | --- | --- | --- |
| 拉丁字母、所测中文 | 有字形 | missingGlyphs = 0 | missingGlyphs = 0 |
| 阿拉伯文 مرحبا | 浏览器字体绘制 | missingGlyphs = 5 | missingGlyphs = 5 |
| 天城文 नमस्ते | 浏览器字体绘制 | missingGlyphs = 6 | missingGlyphs = 6 |
| emoji 😀 | 浏览器字体绘制 | missingGlyphs = 1 | missingGlyphs = 1 |

两个 GPU 后端在缺字场景仍报告 `placed: 1`，地图 `error` 事件为空；正确性检查同时核对字形与像素。缺字计数对应 HarfBuzz 的 glyph 0，默认字体回退没有找到实际字形。验收需要联合检查 `placed`、缺字计数与实际字形。

另用 28px 的并排截图核对可见结果：Canvas 显示实际字形，WebGL2 与 WebGPU 的后三行显示缺字方框。截图保存在本地 `test-results/luma-migration-audit/functional-parity/fonts.png`。

根因位置：[font-engine.ts](../src/integrations/msdf/font-engine.ts) 的 `choose()`（第 155–189 行附近）只搜索自定义字体和内置 Noto 资源；失败后选择 Latin fallback，`shape()` 在 glyph 0 时增加 missing 计数。Canvas 的字体栅格化由浏览器处理，可使用系统字体回退。字体覆盖随操作系统和字体资源变化；显式提供覆盖目标文字的字体文件后，可用相同文本验收 GPU 排版。

MSDF 的配置前提是为 `Arial` 等自定义字体提供 URL，文件使用 TTF、OTF 或 WOFF1。系统字体和 emoji 的浏览器位图路径见后续修复；迁移时准备字体资源并检查缺字反馈。

#### P2：重叠半透明点会在 GPU 上变深

复现：同一图层包含两个不同要素，坐标都为 `[0, 0]`，`circle-radius: 10`，`circle-color: rgba(255,0,0,0.5)`。

| 场景，中心像素 alpha | Canvas2D | WebGL2 | WebGPU |
| --- | ---: | ---: | ---: |
| 一个点 | 128 | 128 | 128 |
| 两个重叠点 | 128 | 192 | 192 |
| 两个重叠面，对照组 | 192 | 192 | 192 |

原因：Canvas 的 [drawPoints](../src/engine/rendering/canvas-painter.ts) 第 930–969 行附近，每 100 个点合成一个路径再填充，同批重叠区域只填一次；GPU 按点实例混合，两个 0.5 alpha 的实例叠成 0.75。差异来自点实例的透明度合成语义。依赖点密度、透明度或聚集视觉的旧图层会改变外观。

建议先明确统一语义，再修正两种实现和回归。统一语义应以稳定的逐要素合成规则为依据。

#### P2：零半径点在 Canvas 显示，GPU 隐藏

复现：`circle-radius: 0`。Canvas 仍画出默认半径 4 的点，本机测到 208 个 alpha > 100 的物理像素；两个 GPU 后端均为 0。

原因：[canvas-painter.ts](../src/engine/rendering/canvas-painter.ts) 第 918 行使用 `(Number(radius) || 4)`，把 0 当作默认值；[luma/painter.ts](../src/integrations/luma/painter.ts) 第 539 行遇到 0 直接返回。

这是后端契约不一致，其中 Canvas 对显式 0 的处理更像旧行为缺陷。建议明确“0 隐藏”，在共同契约中固定，并在修复时考虑旧样式的迁移影响。

#### P2：空心点描边在 Canvas 依赖前面绘制的线宽

复现：先绘制 `line-width: 12` 的蓝线，再绘制半径 10、红色、`circle-fill: false` 的点；线和点位置分开。取点中心向右 8 和 14 CSS 像素：Canvas 两处都是红色，两个 GPU 后端两处都透明。

原因：Canvas `drawPoints()` 设置描边颜色，但不重设 `lineWidth`，继承此前线图层的宽度；GPU `drawPoints()` 两条几何路径都明确传 `width: 1`。因此同样的空心点样式在 Canvas 还会受图层绘制顺序影响。这属于 Canvas 状态泄漏和跨后端不一致，修复采用明确的空心点描边宽度。

### 当轮功能完整性矩阵（历史）

“通过”对应列出的实测场景；“共享”表示源码实现复用。鼠标操作以正式浏览器回归为依据，WebGL 在本表中指 `webgl2`。

| 功能 | WebGL2 / WebGPU 判断 | 证据与边界 |
| --- | --- | --- |
| 普通点、11 种点标记 | 已测场景可用 | 本次逐一绘制 circle、square、triangle、triangle-down、diamond、pentagon、star、cross、x、hexagon、octagon；边缘效果按各后端的抗锯齿采样呈现 |
| 点透明度、零半径、空心描边 | 有上述差异 | 点样式修复和统一语义见后续记录 |
| 线、粗线、虚线、箭头、路径样式 | 已有实现及回归覆盖 | 共用样式入口；截图基准覆盖既有测试中的线型参数组合 |
| 面、孔洞、自交显示 | 已测场景可用 | 本轮以前的正式浏览器回归，以及已修复的 even-odd 自交显示；病态几何按实际数据追加测试 |
| 图层顺序、显隐、过滤、样式更新、源更新 | 已有正式回归覆盖 | 以正式服务回归为验证依据 |
| 点击查询、选择、平移、导航 | 已有正式回归覆盖 | 查询和选择共用服务；像素绘制仍由各后端负责 |
| 平移、旋转、缩放、实时平移取消 | 本次三后端通过 | 正式 API、画布像素；旋转 90 度、缩放 0.5，非全部数值与多源组合 |
| 新增孔洞、删除孔洞、填孔洞 | 本次三后端通过 | 挖空／填回像素正确；填孔洞产生第二个要素；检查相关撤销重做 |
| 分割、合并 | 本次三后端通过 | 单矩形被折线切成两块，再合并；要素数、两侧填充和撤销重做均检查 |
| 删除、撤销重做 | 本次及已有回归通过 | 删除后的透明像素及撤销后的填充恢复；未穷尽跨源事务和过滤中编辑 |
| 顶点拖动／撤销 | 已有正式鼠标回归通过 | 包含拖动期间主几何跟随；复杂多部件和共享边界组合仍待验收 |
| 绘制新要素、改形、部件编辑、吸附、测量 | 共享实现，尚未逐项三后端验收 | Handler、命令和 Canvas 编辑覆盖层保留；本次 API 检查不等于鼠标与键盘完整流程检查 |
| 图标、附属 symbol、标注布局／避让 | 已有可用路径及回归 | 标注字体覆盖有明确差距；尺寸、粗斜体和字体选择也不能承诺与系统 Canvas 完全一致 |
| 常规中英文与两行标注 | 本次三后端可见 | 测试字符缺字计数为 0；300 字符标注三者都被共享长度限制排除，不列为 GPU 回归 |
| 栅格、GeoTIFF、混合图层 | 正式小场景已有回归 | 共用 CPU/Worker 读取、着色与重投影，GPU 合成；真实 TIFF 专项仍缺输入数据 |
| 导入导出、拓扑命令、DuckDB、属性表 | 共享业务链路 | Painter 切换复用数据处理服务；文件与 SQL 的验收范围按数据集成用例记录 |
| MapLibre 底图 | 独立 DOM 容器组合 | 本次未做真实底图三后端视觉与交互验收 |
| 设备丢失、销毁、恢复 | 已有正式浏览器回归 | 覆盖已测试 Chromium；Safari、Firefox、移动端和受限设备另需验证 |
| 自定义 Canvas 扩展、截图 | 需要适配 | 主画布不再提供 2D context；渐进绘制完成与主／覆盖层合成需要明确处理 |
| 热切换、2.5D、原生数值栅格 GPU 计算 | 分别使用实例重建与专用实验入口 | 重建实例、实验相机和实验栅格路径的边界不变 |

### 本次新增验证记录

- 视觉对照：23 个场景 × 3 后端，共 69 份采样记录。包含 5 个点／面语义场景、11 个标记和 7 个文字场景；这是对照记录数，不能写成“69 个测试全部通过”，因为其中确实发现差异。
- 编辑对照：每个后端 17 个基础编辑／历史状态，再加 6 个分割合并状态，共 **69 个状态检查通过**。检查实际主画布像素、操作成功和相关要素数量，不只检查方法返回值。它们是本地审查脚本，尚未转成正式持续集成用例。
- 编辑脚本第一次在 WebGPU 初始像素读取处失败，原因是取样前未像仓库既有 `mapPixel()` 一样重新提交当前帧。修正测试读取时机后，51 个基础状态全部通过；随后新增的 18 个分割合并状态也通过。该读回失败未列作编辑缺陷。
- 使用同一浏览器、同一数据、相同 CSS 尺寸和 DPR 2；不作跨设备和所有字号的逐像素等价承诺。
- 复用此前正式渲染器 31 项浏览器回归结果；本次没有重跑未修改的全量测试，也没有把前一轮全量测试的超时隐去。
- GitNexus 服务端索引与当前提交不一致且全文查询不可用；本次结构审查以当前源码的接口、调用方和测试为准，未依赖旧索引推断结论。

本地证据：`test-results/luma-migration-audit/functional-parity/` 下的 `functional-parity.mjs/json`、`edit-parity.mjs/json`、`split-parity.mjs/json`，以及字体截图生成脚本。脚本通过 ego-browser TaskSpace 4 的 p1 执行；重放时须在新的审查 TaskSpace 中打开已构建的 luma-benchmark 示例，再将脚本开头的 space ID 改为该空间 ID。该目录被 Git 忽略，报告中的步骤与数字保留审查结论。

### 修复与验收建议

1. 优先处理字体覆盖与缺字反馈；至少用项目实际中英文、少数语言、符号和 emoji 文本验收，明确系统字体和文件字体的支持边界。
2. 统一点透明度、零半径及空心描边的契约，在正式三后端测试中固定期望；修正 Canvas 状态泄漏，不复制它到 GPU。
3. 将本次 API 编辑检查补进现有正式浏览器测试；再补鼠标绘制、改形、吸附、测量、过滤中编辑和多源历史链路。
4. 对用户实际数据和宿主自写扩展做最终验收。尤其是直接操作 Canvas context 的扩展，单靠仓库内审查无法确认兼容。

上述为再次复审时的发现和验证范围；随后修复见下文。未创建外部问题单：当前没有可用 Multica 连接，也没有外部 issue 写入授权。复现步骤和影响已记录在此报告。

## 四项功能差异的修复

用户授权后，修复了上面四项差异，复用现有依赖：

- **缺字回退**：MSDF 排版发现缺字时，整段文字复用已有 `LabelAtlas`，由浏览器排版和栅格化，再交给 GPU 合成。普通字形继续走 MSDF；回退保留浏览器的连字、双向排版和彩色 emoji。测量与绘制使用同一路径，避免碰撞框仍按缺字方框计算。
- **明确诊断**：`missingGlyphs` 保留 MSDF 缺少的轮廓数量，新增 `bitmapFallbackLabels` 记录实际回退的标注数；示例面板同时显示两者。字体 URL 失败和不支持的字体配置仍按原规则报错，不用静默回退掩盖资源错误。
- **点透明度**：Canvas 对半透明点逐点进行 source-over 合成，两个 alpha 0.5 的重叠点现在与 GPU 一样得到 alpha 192。实色 sRGB 点仍保留每 100 点的批量绘制。
- **零半径**：显式半径 0 不绘制；Canvas 与 GPU 均遵守显式零半径设置。
- **空心描边**：Canvas 明确设置 1 CSS 像素线宽，清除继承的虚线与偏移，固定连接和端点状态，使用独立于前一图层的线宽状态。

回退带来的生命周期和混合绘制也作了处理：

- MSDF 与位图标注按原有顺序交替绘制，保持两类标注的原有覆盖关系；同一帧只准备各自的缓冲一次。
- 按有序区间定位绘制批次，避免文字类型交替时逐段扫描所有批次。
- 位图图集回收槽位时不覆盖旧显示帧仍引用的画布。回退图集独立上限为四页，计入图集和 GPU 资源统计，销毁释放。

此修复仍保留明确边界：回退取决于浏览器可用字体；回退文字改变字号、颜色或 DPR 时需要重新栅格化。非内置字体名称依然需要 `fontUrl`，TTF／OTF／WOFF1 的格式要求不变。默认缺字由浏览器位图路径提供字形，MSDF 继续使用已加载字体文件的轮廓。

### 本次修复验证

- 新增真实浏览器用例在修复前出现 3 项失败：Canvas 点透明度，以及两个 GPU 后端的字体回退。修复后 5 项全部通过，覆盖三后端点样式、默认多语言／彩色 emoji、MSDF 与位图交替覆盖顺序、暖帧不重复上传及混合文字资源销毁。
- 相关文字、绘制、GPU 资源和 MSDF 单元测试：11 个文件、177 项全部通过。包含位图图集回收后旧显示帧保持原内容。
- 全量 `pnpm run test:run --maxWorkers=2 --testTimeout=20000`：4385 通过、56 跳过、1 失败。唯一失败为 `test/docs/examples-build.test.ts` 的真实 Vite 路由用例，错误是沙箱禁止监听 `127.0.0.1:5173`。在允许本地监听的环境中复测该文件，17 项全部通过。没有修改断言来避开权限问题，也没有把全量首轮写成零失败。
- 最终固定构建产物后的正式渲染器／文字浏览器套件：44 通过、1 因未提供真实点文件跳过、1 个连续手势回放计数断言失败。该用例要求原生回放，但未固定决定快／慢设备策略的帧耗时输入；高耗时时合法快照导航不会增加回放计数。与现有快设备用例一致地固定两项耗时输入后，两个后端各重复 3 次，6 次全部通过；像素、上传次数和回放断言均保留，生产导航策略未改动。45 个可运行用例均已有通过结果，未宣称单次完整运行零失败。
- 一次较早的扩展浏览器执行与文档检查的示例重建重叠，出现 Worker 初始化失败；停止该次执行并串行完成构建后再验证，上述最终记录中的 Worker、DPR 和 MSDF 缓存用例通过。一次相关单测也在构建清理 `dist` 后遇到 `hb.wasm` 不存在；资源就绪后重新执行得到上述 177 项通过。两次并发干扰均未当作产品缺陷或成功结果。
- 生产构建、开发构建、最终示例构建、源码／类型契约／示例类型检查、架构检查（535 个模块）、修改文件 lint、`docs:verify`、文档链接检查和 `git diff --check` 通过。Bundle smoke 检查了 11 个必要文件和 36 个 export 目标。
- 5173 的开发包已更新，`geopackage-viewer/index.html` 返回 HTTP 200。未提交、推送或发布。

本次修复日志保存在本地 `test-results/luma-migration-audit/parity-fix/`；真实文件、复杂交互与跨设备验收范围仍按上面的矩阵记录。

## 发布条件检查（2026-10-02）

结论：暂不具备正式发布条件。

- `pnpm run audit:prod` 退出码为 1：文档依赖链包含 6 条未被现有豁免覆盖的 high 告警。分别为 `image-size`（1239765、1239766）、`fast-uri`（1239943）、`joi`（1240057）、`brace-expansion`（1240104、1240108）。这些依赖告警不能直接解释为地图运行时已被证实存在可利用漏洞，但按仓库规则会阻断发布。复现命令即 `pnpm run audit:prod`；未扩大豁免名单。
- 发布门禁首次停在路由测试文件的格式检查，已修正。第二次运行的格式、lint、类型及源码门禁、生产构建和 bundle smoke 通过；确认独立依赖审计阻断后，在全量测试刚启动时主动停止后续执行。完整 `release:verify` 未通过，也没有本轮完整测试、DuckDB 和跨浏览器发布验收的成功记录。
- 包版本仍为 `0.13.1`，修复保留在未提交工作区。正式发布还需整理变更日志、确定版本并形成经过验证的发布提交。
- 开发构建已恢复成功，示例 `geopackage-viewer/index.html` 返回 HTTP 200；未提交、推送或发布。

后续需修复受影响依赖并重新完整执行 `pnpm run release:verify`。本轮日志：`/tmp/emap-release-readiness-final.log`、`/tmp/emap-release-audit.log`。尚未获得外部问题写入授权，本轮仅在此记录阻断项，未创建外部 issue。

### 发布阻断修复与复验（2026-10-02）

已消除上面的 6 条新增依赖阻断告警，完整发布资格仍未确认。

#### 修复内容

- 定向更新文档依赖：`image-size` 2.0.4、`joi` 17.13.8、`brace-expansion` 1.1.21 / 2.1.7 / 5.0.12；将使用 3.x 的 `fast-uri` 约束到兼容修复版 3.1.8。未升级依赖主版本，未修改审计豁免名单。
- 大路径分块单测改为检查数组长度和每个浮点值，避免通用深度比较超过默认 5 秒限制；保留 15 万点规模和全部值检查，未提高超时。
- LZW 浏览器用例改用公共 GeoTIFF 客户端和真实 tasklane 协议；通过内存压力清空缓存，检查两次实际解码、全部波段像素和 WASM 单次初始化。
- 实时导航测试固定决定快设备策略的两个耗时输入；自适应读者用例保留三轮扩容／回收和样本一致性断言，将测试配置的空闲观察窗口由 100 ms 改为 1 秒，避免并发时错过短暂的双读者状态。生产策略未改动。
- DPR 用例在 Chrome 使用 CDP，其余浏览器注入 DPR 变化并触发 resize，继续检查真实画布尺寸、像素和字形复用。ESM 用例在任何模块加载前提供 import map，修复 Firefox 的裸依赖解析失败。
- 本轮未更改生产渲染逻辑；Unreleased 变更日志补齐了此前功能修复和依赖更新。

#### 验证结果

- 冻结锁文件安装、测试浏览器安装检查、格式、lint、类型、源码门禁、生产构建、包产物检查、示例与双语文档构建、文档契约、打包预检均通过。
- 全量单元／集成测试：**4386 通过、56 跳过**；实际 DuckDB 集成测试：**464 通过**。首次门禁遭遇系统空闲睡眠导致两个工作进程启动超时；保持系统唤醒后完成上述验证，没有修改测试启动超时。
- 协议、实时描边和自适应读者用例在 Chrome 四工作进程下各重复三次：**15 通过**。
- 三浏览器批次按名称排除 WebGPU 后：**757 通过、190 跳过、21 失败**。其中 16 项是内部仍切换到 WebGPU 的混合用例，受下面的环境限制影响；其余为 DPR（2）、导航耗时条件（1）、import map（1）和 Firefox 页面崩溃（1）。不能把这个批次描述为通过。
- 修复 DPR、导航和 import map 后，相关四类用例在三浏览器、四工作进程下各重复三次：**35 通过、1 失败**。唯一失败是 Firefox 像素上传用例的页面进程崩溃；该用例随后串行重复 **5 次通过**，并发稳定性尚未解决。
- Chrome WebGPU 补充批次：**64 通过、48 条件跳过**。三浏览器独立 Canvas 像素检查：**33 通过**。
- `audit:prod` 通过；仍按原有名单临时豁免 752 条文档依赖路径，不能表述为依赖零告警。

#### 剩余发布阻断与复现

1. 当前测试环境的 Firefox 153.0 存在 `navigator.gpu`，但 `requestAdapter()` 返回空；WebKit 26.5 没有 `navigator.gpu`。两者 WebGL2 可用。必须提供可运行对应 WebGPU 用例的环境，才能完成现行发布门禁；未通过修改门禁或新增 skip 隐藏此限制。
2. Firefox 并发检查偶发 `page.evaluate: Target crashed`，发生在 `test/browser/map-pixel-upload.spec.mjs` 移除栅格后的重绘等待阶段。串行成功不能证明已修复；目前根因未确认，仍需定位浏览器进程／GPU 稳定性。可复验实际失败批次：

   ```bash
   pnpm exec playwright test test/browser/luma-labels.spec.mjs test/browser/map-resource-performance.spec.mjs test/browser/map-renderers.spec.mjs test/browser/map-pixel-upload.spec.mjs --grep 'true MSDF|bounded styles|published ESM|direct RGBA' --grep-invert webgpu --workers=4 --repeat-each=3
   ```

完整 `release:verify` 未通过。包版本仍为 0.13.1，未提交、推送、打标签或发布。外部问题写入未获授权，因此在本报告保留阻断及复现，未创建 Multica 或公开 issue。验证日志保存在本地 `test-results/luma-migration-audit/release-fix/`。


### luma 升级与浏览器阻断定位（2026-10-02）

#### 已完成的升级

- `@luma.gl/core`、`webgl`、`webgpu` 和间接依赖 `shadertools` 对齐到 `10.0.0-alpha.2`。这是同一 10.x 版本线的最新预发布版，npm 稳定标签仍为 9.4.2；没有把预发布版描述为稳定版。[上游发布记录](https://github.com/visgl/luma.gl/releases/tag/v10.0.0-alpha.2)
- 新版未合入现有 WebGL 补丁，继续保留循环导入、恢复后扩展重取和状态 setter 不重复包装三项修复，补丁文件改为对应 alpha.2。
- 修正发布包的两处依赖元数据问题：9.4 peer 范围导致混入旧版 shadertools；shadertools 引用发布者本机 Yarn patch 路径。通过仅作用于 alpha.2 的 overrides 对齐 luma 包，并使用公开的 `@math.gl/core@5.0.0-alpha.9`。核对了上游 math 补丁：它增加根入口 gl-matrix 别名，不影响本项目使用的独立 WGSL 扫描入口。新增安装产物版本一致性测试。
- 更新运行信息和 benchmark 版本。运行时不额外导入 `luma` 单例，避免示例同时加载打包入口与源码时产生重复初始化错误；该尝试产生的失败批次不计入最终通过结果。

#### Firefox WebGPU 的可用启动方式

本机 Firefox 153 与 156 的 `navigator.gpu` 在两种模式均存在；无界面时 `requestAdapter()` 返回空，有界面时返回真实适配器。`playwright.config.mjs` 已在 macOS 为 Firefox 使用有界面模式。没有新增 skip 或改变 GPU 像素断言。

Chrome 与 Firefox 的 WebGPU 批次：**126 通过、98 沿用原条件跳过**。范围由 `--grep webgpu` 选择，不等于整个浏览器套件；其中既有真实文件缺失的跳过，也有原有的浏览器限定用例。

WebKit 26.5 及升级后的 26.6 在有／无界面模式均不暴露 `navigator.gpu`，与 [Playwright 已知问题 #39762](https://github.com/microsoft/playwright/issues/39762) 一致。当前 WebKit 测试包不能证明实际 Safari 的 WebGPU 兼容性，仍需可提供真实适配器的环境。

#### Firefox Worker 崩溃的独立证据

升级测试浏览器前，最终 luma 构建、4 个 worker、三浏览器、5 轮重复验证：**74 通过、1 失败**。失败仍在 `map-pixel-upload.spec.mjs:16`，移除栅格、关闭源 Worker 后等待重绘时发生 `Target crashed`。有界面模式未修复这个问题。

使用 [Playwright 上游最小复现 #42565](https://github.com/microsoft/playwright/issues/42565)，页面只启动一个约 2 MiB 的普通 Worker 并立即重载，不包含 emap、luma、Canvas 或 WebGL。本机 Firefox 153 **3 次全部崩溃**，日志记录内容进程 `signal 11`。这证明浏览器存在独立 Worker 编译／关闭竞态，也与地图用例的时机一致；地图失败没有取得符号化原生堆栈，不能声称已逐帧证明是同一个原生调用点。

不通过延迟 source.dispose、减少并发、吞掉崩溃或新增 skip 掩盖问题。上游问题标记 v1.64，当前稳定 Playwright 仍为 1.63.0。对照同一最小复现，Firefox 156 的 3 次运行均未崩溃。项目已将测试依赖固定到 `1.64.0-alpha-2026-10-02`，安装匹配的 Firefox 156／WebKit 26.6；新增的发布时间例外只覆盖这三个精确版本的 Playwright 包。它仍为预发布测试工具，不等于已经取得完整发布资格。

#### 当轮验证与后续验收

- luma 相关单测 **219 通过**，含安装版本一致性、循环依赖和状态恢复。
- 全量单元／集成测试 **4386 通过、56 跳过、1 失败**；唯一失败是沙箱禁止 Vite 监听端口。允许监听后该文件 **17 项通过**。没有把首轮报告写成零失败。
- 生产与开发构建、示例构建、源码／类型契约／示例类型检查、格式、lint、架构、API surface、bundle smoke、完整 docs:verify、冻结锁文件离线安装、打包预检、依赖审计通过。审计仍沿用 752 条文档依赖临时豁免。
- GitNexus 影响查询返回 UNKNOWN/partial，索引刷新停滞且存在 schema 不兼容。已补查实际调用点；全工作区变更分析报告 HIGH，不能作为精确的无影响证明。未提交。
- 5173 开发服务已恢复，`geopackage-viewer/index.html` HTTP 200。未发布。完整 `release:verify` 仍未通过；WebKit WebGPU 和下游安装冲突仍限制发布验收。Firefox 156 的同批并发验证结果为 **75 项全部通过**，4 worker 与每项 5 次重复保持不变。

本轮日志与最小复现保存在本地 `test-results/luma-migration-audit/luma-alpha2/`。没有外部 issue 写入授权；引用已有上游问题并在此记录，未新建 Multica 或公开问题。

#### 下游 npm 依赖解析与审计结果

在没有工作区 overrides 的临时项目中，仅声明同版 core、webgl、webgpu 三个包，执行 `npm install --package-lock-only --ignore-scripts` 即报 `ERESOLVE`：webgl alpha.2 要求 core `~9.4.0-alpha.1`。这是本轮实测的上游发布元数据冲突；pnpm 工作区 overrides 不会随 emap 发布包传递给使用者。未使用 `--force` 或 `--legacy-peer-deps` 绕过。

随后用实际打出的 emap tgz 在空白 npm 项目中解析安装，安装成功；npm 在顶层安装 core／shadertools 9.4.2、适配器 10.0.0-alpha.2，并在 emap 内嵌套 core 10.0.0-alpha.2。不能把直接依赖组合的失败扩大为“所有下游项目都无法安装”。luma 运行代码在 emap 构建中已打包，这个结果本身也不证明已发生运行时混版故障，但说明工作区验证的依赖树不能代表下游解析结果。

该空白安装的审计另报告 7 条告警，涉及 `adm-zip`、`fflate`、`file-type`、`image-size`；它们来自已有的 GeoPackage 等依赖链，未发现由 luma 引入。现有工作区 overrides 和文档豁免不能作为下游包的安全验证。发布前需独立处理打包后依赖树／类型契约，或由上游发布修正后的依赖组合；本轮未扩大包边界重构，也未将这些告警写成已修复。清单、解析锁文件和审计 JSON 保存在证据目录。

#### 最终浏览器复验

- Playwright 1.64.0-alpha-2026-10-02／Firefox 156 后，原三浏览器并发组 **75 项全部通过**；4 worker、每项 5 次重复，未降低压力或跳过原失败用例。
- 新版 Chrome／Firefox WebGPU 加后端切换批次：**141 通过、98 原条件跳过、1 失败**。唯一失败为 2.5D 测试的分离式状态读取：等待观察到 ready 后，下一次读取时异步重绘已切回 rendering。共享 `ready()` 改为自动重试的 `toHaveAttribute`，不改生产状态、不放宽像素断言；两个浏览器、两个 GPU 后端各重复 5 次，**20 项全部通过**。没有将前一整批写成零失败。
- 最终 Firefox 156 仍是无界面无适配器、有界面有适配器；WebKit 26.6 两种模式均无 WebGPU。
- 最终类型检查、冻结安装、格式、lint 和 `git diff --check` 通过。开发服务保持 5173，示例入口 HTTP 200。

完整发布门禁仍未通过。以上修改未提交或发布；预发布引擎／测试工具、WebKit 能力缺口和下游依赖问题均已明确保留，不宣称所有环境和所有使用方式完全兼容。

### 下游安装修复与发布复验（2026-10-03）

本节记录当轮安装修复；最终验收结果见“完整门禁通过”。前面的 alpha.2 安装结果保留为历史证据。

- 恢复 `core`、`webgl`、`webgpu` 到 `10.0.0-alpha.1`，保留三个 WebGL 修复；新增精确的 `shadertools` 直接依赖。仅回退三个包仍会从宽松 peer 范围解析出 alpha.2，已有版本一致性测试实测失败后验证修复。
- 删除 alpha.2 专用 overrides。实际 tarball 在独立 Node 22/npm 项目安装成功，四个 luma 包均为 alpha.1，core 与 shadertools 正常去重，没有使用 `--force`、`--legacy-peer-deps` 或消费者 overrides。
- mapshaper 和 GeoPackage 已随浏览器产物打包，公开声明不引用它们的包类型；两者移到构建依赖。独立安装的生产依赖审计为 **0 个漏洞**。这不代表整个工作区的文档工具链零告警。
- 补丁修复 mapshaper 内嵌旧解压器的 ZIP64 解析循环；包外层的 fflate override 无法更新这一内嵌副本。回归测试验证异常 ZIP/KMZ 快速报错，普通 ZIP 仍能导入。没有改变数据导入 API。
- 独立消费项目的 ESM 加载、GeoJSON 导入、GeoPackage 插件注册／卸载和浏览器打包通过。严格 TypeScript 检查通过；覆盖 providers 的 MapLibre 接口时安装其已声明的可选 peer，未开启 `skipLibCheck`。
- 全量单元／集成测试 **4389 通过、56 原条件跳过**；DuckDB 实际 Wasm 集成测试 **464 通过**。构建、类型／类型契约／示例类型、格式、lint、布局、架构、API、bundle smoke、示例与双语文档检查通过。

#### 本轮新增的外部阻断

1. 本机真实 Safari 为 **18.5**，SafariDriver 建立会话时报“Allow remote automation”未开启。没有改变浏览器权限设置；实际 Safari 的 WebGPU 渲染仍未验证。[Safari 26 的 WebGPU 发布说明](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)可作为验收环境选择依据。Playwright WebKit 缺少 `navigator.gpu` 的限制仍然存在。
2. `pnpm run audit:prod` 新检出文档依赖的 `http-cache-semantics`（GHSA-ch52-4w7c-c8xp）和 `braces`（GHSA-vfj7-8cjw-p6xm）高危项。2026-10-03 对 npm 官方 registry 查询 `http-cache-semantics@4.2.1`、`braces@3.0.4` 均返回 E404；公告也没有已发布修复版。这两条未加入豁免，不在本轮修复后的 emap 消费者依赖树中。复现命令为 `pnpm run audit:prod`；完整公告见 [缓存问题](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)与 [模式解析问题](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)。

上述外部问题未向 Multica 或其他服务写入：没有连接和外部报告授权。本地保留复现与阻断，未发布。

#### 最终门禁结果

- 完整 `release:verify` 执行到浏览器阶段：**896 通过、338 原条件跳过、71 失败**，失败全部发生在 WebKit。其中 70 项为 WebGPU 或包含 WebGPU 的切换步骤，1 项为双 Worker 测试的启动时序。Chrome、Firefox 没有失败。
- 双 Worker 失败单独重复 5 次得到 2 失败／3 通过：小图像可能在第二个元数据副本启动前就被主 Worker 处理完。并发用例现在等待两个真实 Worker 都领到 render 请求再同时放行，保留两个 Worker、真实输出、峰值与释放断言；其他用例仍不加屏障。修复后三浏览器、整文件、4 worker、每项 5 轮 **45 项全部通过**。未重跑整套门禁，也未将原先的 71 失败报告改成通过。
- 因浏览器阶段失败而未自动执行的三浏览器 Canvas 像素审计已单独完成，**33 项通过**。实际 tarball 已打包、独立安装并完成类型／运行时／审计验证。
- 当前仍不满足发布门禁：WebKit／真实 Safari WebGPU 验收未闭环，且文档工具链新增两项高危告警没有可安装的上游修复版。未增加 skip 或安全豁免，未提交、推送、打标签或发布。
- 开发构建已恢复；实际浏览器打开 5173 的 `geopackage-viewer/index.html`，Worker 成功导入 4 个图层，页面错误为空。

### 0.14.0 发布候选验收过程（2026-10-03）

发布范围已由用户确认：Chrome／Firefox 验收 Canvas2D、WebGL2、WebGPU；Playwright WebKit 验收 Canvas2D、WebGL2，真实 Safari／WebGPU 暂缓。文档工具链两条新增公告保留本地修复与回归测试，并加入精确 advisory ID、仅限文档路径且有到期日的临时豁免。它们不在 emap 消费者生产依赖树中；这不是全工作区零告警声明。

- 候选版本为 `0.14.0`，四个 luma 包保持 `10.0.0-alpha.1`，避免 alpha.2 的已复现依赖元数据问题。
- 新增正式地图编辑浏览器回归，覆盖真实鼠标绘制、顶点／边吸附、取消、裁切、线重塑、属性／选择恢复、撤销重做及主画布像素。原有顶点编辑回归继续保留。
- 实际 tgz 的独立 npm 安装、ESM 加载、GeoJSON 导入、GeoPackage 注册／卸载、严格 TypeScript Bundler 检查、浏览器打包和生产依赖审计通过。声明解析使用 ESNext／Bundler，已同步两种语言的安装说明。
- 首轮完整门禁通过源码、构建、单元／集成（4391 通过、56 条件跳过）、DuckDB（464 通过）、双语文档和示例检查；浏览器结果为 934 通过、288 条件跳过、3 失败。原始失败保留在 `/tmp/emap-release-0140.log`，不改写为成功。
- 该轮发现并修复示例初始化期间控件先启用、监听器后绑定的竞态；同时将共享工具栏的 ResizeObserver 布局写入延迟到下一帧，消除通知循环。新增布局回归先失败后通过。
- Firefox 有界面多窗口会对不活跃窗口做指数帧退避；最小对照中最大帧间隔从 8005ms 降到 66ms。测试配置关闭该退避，并曾尝试 60Hz software vsync（后续已撤销）；GPU 仍真实执行，不用于原生显示 FPS 结论。后续 trace 曾捕获双 RAF 等待超过 50 秒，简单多进程探针未复现该次停顿；保留重复验收记录，不将机制推断写成已复现根因。
- Canvas 路径缓存的异步多帧对照曾出现差异，尚未定位。临时同步原画布读回虽在 Firefox 三个 DPR 各五轮中通过，却使 Chrome 三个 DPR 稳定失败，已撤回。直接读回本身会影响浏览器的绘制方式：[Chromium 实现](https://chromium.googlesource.com/chromium/src/%2B/fe487bfab3b23b7a107987b0a2f7b65222ae7ae0/third_party/blink/renderer/modules/canvas/canvas2d/base_rendering_context_2d.cc#2904)明确会在反复 `getImageData` 后关闭 Canvas 加速。保留原 ImageBitmap／独立读回画布和零差异断言，继续通过有／无缓存的命令流对照定位；未修改生产缓存算法。
- 只安装 emap 的独立 TypeScript 消费项目另复现根入口声明缺少 `maplibre-gl` 的 TS2307。既有公开 API 已直接暴露 MapLibre 原生类型，因此将已有 peer 改为必需依赖，保留完整类型，不新增类型注册层或弱化为 `any`。全新 npm 项目自动安装 MapLibre 6.11.2，严格 Bundler 类型检查和生产审计通过（0 个漏洞）；Arrow／DuckDB／Parquet 的 peer 继续按需安装。

此阶段最终完整门禁与 tarball 消费者复验尚待完成；最终通过记录见文末。原始 TIFF 性能数据缺失导致的条件跳过、Chrome 专属 CDP／恢复用例限制、真实 Safari 缺口继续明确保留。没有在外部创建 Multica issue；当前没有外部写入授权，复现和证据记录于本地报告。

#### Canvas 对照复测

临时命令流探针在 Chrome、Firefox 原生帧时钟和 Firefox 60 Hz 软件帧时钟下，分别对有缓存与无缓存场景重复 5 次，30 项全部通过（`/tmp/emap-release-0.14.0/probe.log`）。未复现原偶发差异，因此不能归因于路径缓存，也不能据此宣称已修复。未获得软件帧时钟必要性的证据，已移除该设置，保留已验证有效的 Firefox 非活动窗口节流禁用配置；完整验收时保持显示器唤醒。原始异步像素读取与零差异断言均保留。

#### 原生帧时钟完整门禁结果

移除软件帧时钟后的完整门禁通过源码、构建、4392 项单元／集成测试、464 项 DuckDB 测试、双语文档与示例检查；浏览器结果为 **925 通过、288 条件跳过、12 失败**，全部失败来自 Firefox，日志 `/tmp/emap-release-0140-acceptance.log`。失败包括双 `requestAnimationFrame` 超时、按钮等待稳定超时、RAF 轮询与绘制完成等待超时；没有像素差异断言失败。Chrome 与 WebKit 无失败。恢复仅限 macOS 的 60 Hz 软件帧时钟后，对原失败用例进行并发重复验证；此配置只用于功能验收，不代表修复了浏览器原生 vsync，也不改变生产引擎。

固定帧时钟对原失败组重复 3 轮仍得到 **32 通过、3 条件跳过、7 失败**（`/tmp/emap-release-0140-firefox-clock-regression.log`），不能把软件帧时钟当成修复。后续独立 RAF／timer 心跳探针捕获页面可见、普通定时器持续更新且 Node `evaluate` 正常返回，但 RAF 停顿最长约 59 秒。说明不只是初始化状态未到，也不只是 Playwright 的单个等待任务。正在检查浏览器原生刷新驱动；未通过修改地图绘制或放宽断言处理。

#### macOS Firefox 验收环境隔离

同一原失败组，恢复原生帧时钟、保留 always-active，仅把并发 Firefox 实例由 4 改为 1，三轮结果 **39 通过、3 原条件跳过、0 失败**（`/tmp/emap-release-0140-firefox-single.log`）。完整配置因此仅对 macOS Firefox 项目使用一个 worker；Chrome、WebKit 及其他平台并发不变，原断言、GPU 适配器和全部用例不变。删除无效的固定帧率设置。该措施用于隔离本机多实例自动化的刷新停顿，不声称已修复 Firefox 原生合成器，也不把本轮验收作为 macOS 多个有界面 Firefox 实例的压力保证。该环境问题继续在本地报告跟踪。

#### 单窗口完整门禁复验

`/tmp/emap-release-0140-final-gate.log`：源码、构建、4392 项单元／集成、464 项 DuckDB、文档和示例通过；浏览器 **934 通过、288 跳过、3 失败**。本轮没有先前的 RAF 超时；三项均为 Firefox/WebGL2 快速像素断言失败：过滤后仍截图得到旧半透明蓝色（map-progressive 的 path/polygon handoff），以及平移后 direct/compiled 截图 hash 不一致（map-render-commands）。尚未确认是生产像素错误还是截图与合成呈现的时序差，正在对照同次绘制的主画布与页面截图。完整门禁仍未通过，不宣称已具备发布条件。

#### 截图呈现时序修正

临时 15 项探针（原三项各五轮）通过，保存 90 次截图／主画布对照。合批用例正常的未平移 hash 恒为 `1421041957`，平移后恒为 `1843024741`；原门禁失败正是用前者作为平移后参考，再与后者比较。主画布的 compiled/direct 同阶段 hash 成对一致。渐进用例过滤后截图前仍可能存在待处理重绘。两文件的截图 helper 现先等待 GPU 完成，再跨过两个原生动画帧，保留像素、未完成任务和资源断言，不调用额外地图重绘，不等待故意暂停的 Worker。生产算法未因这一诊断修改。GitNexus 精确文件影响查询仍返回 UNKNOWN/partial 和 schema 错误，按仓库降级规则核查了文件内全部调用。

两个完整文件在 Chrome、Firefox、WebKit 下各重复三轮，**336 项全部通过**（`/tmp/emap-release-0140-presentation-fixed.log`），无诊断插桩、无新增跳过、原像素断言不变。完整发布门禁随后重跑。

#### 完整门禁通过

最终命令：`pnpm run release:verify`，退出码 **0**。同一轮完成源码检查、构建、类型与公开 API 契约、架构、示例、双语文档、浏览器、打包及生产依赖审计。

| 检查 | 最终结果 |
| --- | --- |
| 单元／集成 | 4392 通过，56 条件跳过 |
| DuckDB 实际 Wasm | 464 通过 |
| Playwright 三浏览器 | 937 通过，288 条件跳过，0 失败 |
| Chrome | 341 通过，108 跳过 |
| Firefox | 334 通过，115 跳过 |
| WebKit | 262 通过，65 跳过 |
| 独立 Canvas 像素审计 | 33 通过 |
| 新项目安装实际 tgz 后的生产依赖审计 | 0 漏洞 |

条件跳过包括缺失的真实数据、浏览器专属能力和上文说明的运行条件；不计为已验收功能。macOS Firefox 采用一个有界面 worker，未验收多个有界面实例的并发压力。此前 Canvas 缓存偶发差异未能在独立命令流探针中复现，最终原始异步读取及零差异断言通过；没有以修改缓存算法或放宽断言掩盖问题。

最终发布包为 `/tmp/emap-release-0.14.0/final/mapseekai-emap-0.14.0.tgz`，SHA-256 为 `55480867c3afb6da45ceeb16474061f920dc683216e9c996ff978c144ac16d62`。985 个发布条目与通过验收的生产构建核对一致；package.json 仅有 pnpm 打包时标准移除的 packageManager／prepublishOnly 字段。之后为恢复开发服务执行了 dev-build，当前 dist 是开发构建，不能用它代替已留存的发布包。

全新消费者未使用 overrides、force 或 legacy-peer-deps，自动安装 MapLibre 6.11.2，四个 luma 包去重为 10.0.0-alpha.1。严格 ESNext／Bundler 类型检查（skipLibCheck:false）、运行时 ESM、GeoJSON 导入、GeoPackage 注册／卸载／释放，以及真实导出 Emap、TopologySource、GeoPackage、GeoTIFF 的浏览器打包全部通过。声明解析采用 ESNext／Bundler。luma 与 Playwright 使用本轮固定验收的预发布版本。

工作区 `audit:prod` 通过时仍有 878 条仅文档依赖路径按 `security/audit-allowlist.json` 暂时豁免，截止 2026-12-31；精确公告 ID 为 1240991、1240992。本地补丁与回归保留，新公告和生产依赖路径不会被该豁免覆盖。消费者 0 漏洞与工作区文档豁免是两个不同结论。

完整日志、浏览器计数、消费者审计与包哈希保存在 `test-results/release-0.14.0/`，主日志为 `emap-release-0140-verified.log`。开发服务 5173 已恢复，实际打开 GeoPackage 的 index.html 并加载内置多图层数据：1 个 dataset、4 个矢量图层、6 条记录、4 条共享 arc，地图点线面及孔洞可见。截图保存在 `/tmp/emap-release-0.14.0/final/geopackage-restored.png`。

#### 文档人工导航首轮记录（后续已补齐）

中文“第一张地图”可打开并切换到英文同路由；英文页的 GeoJSON 示例链接可正常打开，浏览器后退保持英文页面。生成 API 的 EmapOptions 页面及 container／renderer 参数可访问。但快速开始页没有直接 API 参数链接，示例页只有返回示例目录入口，没有发布清单中描述的 Return to docs 链接。因此这两项人工导航要求没有按清单原文完成，不把自动化文档检查通过扩大成文档站全部人工验收通过。此为文档站导航后续项，不影响 emap 包运行；如同时发布文档站，应先对齐页面导航与清单。

临时文档预览服务和验收浏览器空间已关闭；用户的 5173 服务保留。以上环境与文档后续项均在本报告本地跟踪；未获得外部 issue 写入授权，未向 Multica 发送。发布前仍需将已审核工作区提交，并让正式发布流程验证所选提交；本次没有执行发布。

#### 文档导航补齐（2026-10-03）

用户确认修复上述导航后续项。中英文快速开始的 container／expressionPolicy 现在直接链接生成 API 的对应参数锚点。文档共用链接组件向示例链接携带原文档路径；示例共用工具栏提供“返回文档”或“Return to docs”，切换渲染器仍保留原地址。仅接受同源文档路径；无效、外站及 API／示例地址回退到文档首页。

验证：6 项新增返回链接测试先失败，修复后整个工具栏文件 14 项通过；`pnpm run docs:verify` 完整通过，涵盖类型／契约／布局／API、示例构建、双语文档构建与链接校验。浏览器实际点击中文参数锚点、中文文档→示例→原文档、英文文档→示例→切换 Canvas2D→英文原文档均通过。临时预览与浏览器空间已关闭，5173 开发服务保留。

本次仅修改文档和示例导航，未变更 emap 发布包内容；没有重跑上文整套引擎发布门禁，不把先前完整门禁结果描述为本次重新运行。新增专项日志：`/tmp/emap-docs-links-red.log`、`/tmp/emap-docs-links-green.log`、`/tmp/emap-docs-navigation-verify.log`。上述文档导航后续项已关闭；Safari/WebGPU 和文档安全豁免仍按原决定处理。未发布。
