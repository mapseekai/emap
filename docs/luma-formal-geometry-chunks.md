# 正式 GPU 地图：稳定分块与有界几何 Worker

日期：2026-09-23。接续 `luma-formal-performance-optimization.md` 的导航/准备缓存优化。
本报告记录当时的通用分块阶段，未包含 Brandenburg；后续已完成该文件的专项测试，见
[Brandenburg 验收](brandenburg-stress-test.md)。

> 本文分批阈值记录初始阶段。当前为 262,144 源顶点/8,192 成员的计算批次，GPU 小缓冲限制不变；
> 新的平坦处理、紧包围盒和稳定描边档位见 [二进制批次优化](luma-binary-batch-optimization.md)。

## 接入范围

正式 `Emap.create({ renderer: 'webgl2' | 'webgpu' })` 默认按规模选择路径。
小图层与临时编辑高亮继续同步绘制；大点集合和大弧段源使用稳定分块、协作式准备与独立 Worker。
分块能力由正式 engine 提供，复用现有图层树、数据源、属性表与编辑历史。

```ts
const map = await Emap.create({
  container: 'map',
  renderer: 'webgl2',
  // 打包工具改写输出结构时配置；默认位于主包同目录。
  geometryWorkerUrl: '/assets/emap-geometry-worker.js',
  // 默认 true；仅大数据的不透明实线描边使用半设备像素屏幕过滤。
  screenPathFiltering: true,
});
```

新增 Worker 是独立发布文件，无需 mapshaper vendor、SQLite 或字体资源。
`geometryWorkerUrl` 不等同于数据操作的 `workerUrl` 或文字排版的 `msdfWorkerUrl`。
`useWorker` 控制数据集替换操作；几何准备由 GPU 后端按数据规模调度。Canvas2D 使用自身准备路径。

## 数据和执行流程

1. 根据源几何而非当前视口建立稳定空间分块。通常以 65,536 源顶点、最多 4,096 成员分批。
   点保留原始 feature/component ID；线保留共享弧身份与方向；面以完整要素及全部环为单位。
2. 根据当前过滤、候选 ID 和分块包围盒确定需要的块。放大时拒绝完全离屏的块，保留包围
   整个视口的面；屏幕边缘使用保守包围盒，以允许少量多绘换取完整覆盖。
3. 主线程以时间片扫描/复制选中块的 XY 到精确大小的 Float64 包。原生 typed arcs 可以在长环内
   让出执行，不持有 mapshaper 的共享 iterator 跨越 await。计数与写入分开，避免额外 JS 坐标元组图。
4. 一个懒启动 Worker 串行处理有界包：面三角化、GPU 高低位坐标布局、路径实例及屏幕描边。
   原始 arcs/属性记录不整体复制到 Worker，也不会被 transfer 分离。只有自有包和结果被转移。
5. 在主线程创建小 GPU buffer，按父图层与表达式样式桶顺序绘制。索引面按完整三角形拆包；
   长线跨 buffer 边界保留邻居坐标、累计距离和端点标志，使虚线距离和连接连续。

同一源版本和细节级别下，重叠视图复用未改变的块。边界块内的有序成员集合改变时只重建相关块，
并上传更新结果。切换 DisplayArcs 级别、坐标编辑、重投影或原始数据替换会失效重建。
多彩图标使用原始 ID 连续页与有序区间，保留原始重叠顺序。

空间索引和包复制在主线程分时执行；几何计算由独立 Worker 执行。
读取 GeoPackage/GeoJSON、首次数据标准化和业务索引的成本不属于此 Worker，本轮没有改动这些导入链路。

## 屏幕描边

复用既有 `buildScreenPaths` 算法。默认仅处理不透明实线，将投影后连续重复的半设备像素命令合并。
原始坐标、拓扑、面环和业务属性不变；这是可关闭的显示近似，不声称与未经屏幕过滤的边缘逐像素相同。
虚线、半透明描边和箭头使用原始距离/方向路径。超出安全屏幕整数范围时整块回退原始路径，不截断坐标。
颜色及常规宽度调整复用几何；从不透明实线改成半透明/虚线时，需要切换到原始路径缓存。

## 帧的完整性与取消（阶段记录）

> 本节及下方旧回归数字记录分块首次接入阶段；当前已改为有序渐进呈现和原生 GPU 导航，
> 见 [渐进渲染](luma-progressive-rendering.md)。下文保留旧“手势暂停/完整后提交”阶段记录。

Painter 先记录有序绘制指令，再提交完整 GPU 帧。新视图尚未准备完时，保留内容与尺寸仍然有效的
上一完整画面并变换显示；不会按 Worker 完成顺序交错不同图层，或混合新填充与旧边界。
显隐、过滤、源移除或样式内容改变使旧场景失效，不继续显示不应可见的数据。首次加载没有旧帧时等待完整准备。
因此大数据 `map.render()` 提交准备请求后可能尚未完成真实绘制；地图实例就绪不等于全部数据已完成绘制。

手势期间暂停新的块构建/提交，结束后处理最终视图。新请求有独立取消标识，迟到的旧版本结果被丢弃。
正在 Worker 计算的过期任务通过终止该 Worker 取消，下次需要时重建；地图销毁时关闭 Worker、定时器、
请求及 GPU 资源。不可用的 Worker、超时和分配失败通过地图 error 报告，不无声改为巨型主线程计算。

## 资源预算与统计口径

- GPU 几何与缓存选择副本的软预算为 256 MiB；保留当前所需块，先淘汰非可见 LRU。
  当前工作集及小几何缓冲合计最多允许到 512 MiB，超出在继续分配前明确报错，避免无限淘汰重建。
- 单独空间成员索引有 128 MiB 上限；分块 bounds、请求选择副本另有统计。浏览器总堆还包括源数据与其他资源。
- 单个几何输入包最多 2,000,000 个 XY 顶点（坐标最多 32,000,000 字节）。单个超复杂要素超限时报错，
  不截取前 N 个要素、不删除洞、不悄悄化简源数据。后续超大文件仍需单独验证。
- GPU buffer 按 65,536 实例/顶点量级拆分，避免整图一次分配。原始源数据、三角化暂存、字体、
  栅格纹理、交换缓冲及驱动开销不包含在几何缓存预算中。

内部诊断 `map.ctx.render._painter.stats.geometryChunks` 提供 pending、builds、cacheHits、workers、
workerMs、packMs、bytes、partitionBytes、selectionBytes、peakInputBytes、maxMeshBytes、
screenChunks/screenSegments、evictions、workingSetOverBudgetBytes。该路径用于调试，不新增稳定公开接口。

## 验证

单元覆盖分块身份、原地修改选择、取消/超时、预算与回收、长线邻居、面孔洞、屏幕溢出回退以及
原生 typed arc 的保留阈值语义。浏览器用真实 WebGL2/WebGPU 对比同步与异步路径的图形输出、
多彩图标重叠、过滤与编辑/撤销。保留帧检查读取浏览器合成截图，不通过强制重绘掩盖错误。

真实数据复测使用既有 building.geojson、lucc.geojson 等授权夹具；记录放在 git 忽略的
`test-results/formal-geometry-chunks/`。首次导入、冷视图稳定时间、CPU 提交及 Worker 时间分开，
FPS 使用独立帧率采样。分块增加 draw call 和调度成本，小数据与暖视图需分别测量收益。


## 本机回归记录

两套 GPU 后端分别完整测试 points、building、LUCC，共六组，无地图 error/pageerror。
地图区域 960 × 640 CSS px、DPR=1，全部稳定验证帧没有增加几何上传；销毁后 GPU buffer 字节与 Worker 数均为零。

| 数据 | 完整范围所需分块 | 16× 视图所需分块 | 实测最大单 mesh | 实测最大输入包 |
| --- | ---: | ---: | ---: | ---: |
| building.geojson | 266 | 13 | 0.41 MiB | 0.21 MiB |
| lucc.geojson | 409 | 11 | 1.12 MiB | 2.11 MiB |

表中计数单位是分块，原始源要素保留。点文件默认 LOD 的实际绘制集合较小，继续同步路径，没有额外启动几何 Worker。
真实鼠标拖动 20 次，确认相机移动 76 CSS px：六组均为手势中零几何重绘/上传，结束一次完整刷新。
LUCC 该次结束刷新需要 14 块，其中复用 9 块、补建 5 块；building 的边界成员变化使该次 13 块均需更新。
稳定分块缓存复用成员保持相同的块；成员改变的块按需构建。

本轮验证有界分配、冷构建响应性和重叠区域复用。
分块增加了 draw call；当前管线与原单 mesh 管线分别测量暖帧。原始审计的 settleMs
包含验证帧及像素读回，不作为独立冷构建时间引用。版本化脚本已经将这些阶段拆开：

```sh
# 先启动当前构建的本机示例预览，再运行；不读取其他目录或 Brandenburg。
pnpm benchmark:formal:geometry --data-dir '/你的授权测试目录' --backends webgl2,webgpu
```

脚本只接受既有三个具名夹具，并限制预览 URL 为 loopback；原始文件不改写或上传。
