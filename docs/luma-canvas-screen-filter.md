# luma：复用 Canvas 的微小 arc 与半设备像素过滤

本轮只作用于 `luma-benchmark` 和 `luma-vertex-editing` 实验示例。默认地图渲染器不变；
原生 mapshaper dataset、属性、CRS、共享拓扑、撤销重做及原始文件不修改。

## 对齐的 Canvas 规则

基准来自 `src/domain/geo/viewport.ts` 的 `getArcFilter`、mapshaper `arcIsSmaller`，
以及 `src/engine/rendering/canvas-painter.ts` 的 `_traceSnapped` / `drawPathSnapping`。
本轮没有修改默认 Canvas 的这些高影响路径；新算法通过调用实际 Canvas 方法的命令序列测试校验一致性。

微小 arc 的源坐标阈值为 `0.35 / abs(mx)`；当 `abs(mx) / initialScale < 1` 时，
再乘该初始视图比例。宽、高都严格小于阈值时省略整个 arc；其余 arc 保留路径顶点。

半像素指物理设备像素：先按视图与 DPR 投影，再采用 Canvas 的 `((coordinate * 2) | 0) / 2`。
坐标朝零截断，只跳过连续重复命令；A→B→A 保留。
全路径塌缩到同一位置时，保留 Canvas 的 0.1 **设备像素**短线。
两个开关独立，默认开启。关闭两者恢复原始 GPU 几何。

## 显示影响与安全边界

过滤按当前屏幕尺度生成显示近似：
微小 arc 可能不描边，显示位置落到半设备像素格，路径提交顶点数会减少。
需要原始显示几何时关闭两项过滤；开启时按上述显示近似评估边缘差异。

当前应用于背景普通路径与面的描边；面填充和洞、选中轮廓与编辑控制点使用各自的原始几何路径。
点聚合仍是独立设置；本轮性能测试关闭 PointLod。
保留带描边扩张的视口剔除。超出 Canvas Int32 安全范围的路径块回退到原始 GPU 几何，
避免 `|0` 溢出把远处顶点卷回屏幕。筛选缓存超过 128 MiB 时相应块也回退原始几何，
不丢弃源要素、不增加文件拒绝门禁；页面记录原始回退块数量。

## Worker 与快照导航

Worker 直接从原始 `xx / yy / nn / ii / bb` 构建显示路径，不经 GeoJSON 或 Arrow 转换。
GPU Buffer 存 CSS 屏幕坐标；Canvas 对照重放相同设备像素命令，避免再次吸附造成舍入差异。
这些坐标从未写回原始 dataset。

缓存键包含精确的平移、缩放、DPR、视口、初始尺度、过滤配置、源版本和分块集合。
只保留一个就绪视图，Worker 请求单路串行并合并到最新视图；过期结果不上传，不覆盖新编辑。
拖动/滚轮暂停新筛选并复用快照，停止后统一准备当前视图并原子替换。
资源释放、取消、配置改变和源切换使在途结果失效。

## 测试入口与口径

`/mapseekai/emap/examples/luma-benchmark/?gpu=webgl&pointLod=off`，WebGPU 改为 `gpu=webgpu`。
`screenFilter=off` 同时关闭两项；`smallArcs=off` / `halfPixel=off` 可单独关闭。
顶点编辑入口接受相同参数。

页面 `A/B 原始几何导航` 保持原始 Buffer 的逐帧导航口径，显式排除屏幕过滤与快照，
结果对应原始几何导航。过滤专项分别记录：原始几何重绘、已准备的过滤几何
重绘、相同过滤命令的 Canvas 重绘以及首次屏幕准备耗时。帧率记录 rAF 回调节奏；GPU 耗时需单独计时。

```bash
EMAP_BENCHMARK_DATA_DIR="/Users/zhang/Desktop/测试数据" pnpm exec playwright test \
  --config playwright.luma.config.mjs test/browser/luma-screen-filters.spec.mjs
```

性能只使用完整 `big.geojson`、`lucc.geojson`、`building.geojson`、`points.geojson`、`pppp.geojson`。
静态暖重绘每项预热 4 帧、采样 12 帧；固定视图完整范围/远景/16×近景、DPR 1。
功能单元中的小构造几何只验证边界规则，不用于吞吐量结论。

过滤暖重绘也可在页面点击“过滤后暖重绘压测”，报告标记 `screen-filtered-fixed-view`；原始导航报告标记 `original-geometry-navigation`。

新增过滤状态行后，编辑地图可能部分超出窗口；pointerdown 获取焦点使用 `preventScroll`，避免焦点滚动使鼠标坐标错位。已有真实文件拖动用例新增舞台位置不变断言。

## 近景退远时的显示依赖

屏幕路径现在可脱离原始 GPU 分块独立绘制。原始 Buffer 被淘汰时，只要当前视图屏幕路径就绪，
可直接显示。空过滤结果同样标记该块已完成。
完整面填充仍使用原始三角网；缓存淘汰优先选择不再需要的原始线，保持原预算。
视图和编辑版本检查、绘制顺序、屏幕过滤阈值及回退条件不变。
近→远的实际滚轮等待与固定视图 FPS 分开测量，见 [退远修复](luma-zoom-out.md)。
