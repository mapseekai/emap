# 真实 TIFF 栅格渲染基线

日期：2026-09-21。测试前检查点：`384634af`，分支 `luma集成`。
当前矢量优化已提交，测试前工作区干净；没有创建空提交或发布 npm 版本。
本轮未迁移动态栅格后端，仅修复测试发现的 WebGPU 图像裁剪错误并建立真实文件回归。

## 输入与环境

只使用用户授权的两个完整文件，不裁切输入，不以生成数据替代性能样本。

| 文件 | 大小 | 原图 | 像素 | 原始分块 | 金字塔 | 压缩 / NoData |
| --- | --- | --- | --- | --- | --- | --- |
| SVN3-01_…-FUS.tiff | 24,846,177,341 bytes | 54,798 × 56,561 | 3 × UInt16 | 54,798 × 1 行条带 | 8 个内部 overview，128 × 128 块 | 全层未压缩 / 0 |
| GJ_COG_zip.tif | 425,174,083 bytes | 15,580 × 9,518 | 3 × UInt16 | 512 × 512 | 5 个内部 overview | 全层 DEFLATE / 65535 |

FUS 为 BigTIFF、EPSG:32651，像元 0.5 m；GJ 为 EPSG:4326，像元 0.000005 度，GDAL 报告 LAYOUT=COG。
目录通过本机 GDAL 3.12.2 和 geotiff 3.0.5 只读核对，没有运行统计写回或 gdaladdo。
两文件均有内部金字塔，本次未关联外部 .ovr。

环境：Apple M4、16 GiB RAM、Chrome 153 headless、DPR 1、两数据 Worker。
正式 Canvas 动态视图绘图区 1280 × 852 CSS px，目标 CRS 为 EPSG:4326。
固定图像 A/B 绘图区 1238 × 450 CSS px，FUS/GJ 保留各自源 CRS，不与动态加载耗时直接比较。
测试服务使用独立端口；没有关闭或重启用户的 4187 服务。

## 动态加载：正式 Canvas 栅格流程

每文件两个独立页面/数据源轮次，各执行 10 个动作，共 40 段。下表为两轮范围，不是大样本统计。
source-cold 指应用层新数据源，不代表清空操作系统文件缓存。动作通过真实地图 API 执行，
不是鼠标手势 FPS 基准。稳定判定要求连续 5 个 rAF 无加载/交互/排队/待呈现任务，耗时含此确认窗口。

| 操作 | FUS 稳定时间 | GJ 稳定时间 |
| --- | ---: | ---: |
| 新数据源完整范围 | 567–663 ms | 365–374 ms |
| 4× 放大 | 700–816 ms | 383 ms |
| 16× 放大 | 683–733 ms | 367–384 ms |
| 128× 放大 | 766–782 ms | 333–349 ms |
| 128× 下平移 200/-100 CSS px | 484–833 ms | 300–301 ms |
| 返回完整范围 | 400–599 ms | 233 ms |
| 再到 4× | 516–783 ms | 233–234 ms |
| minmax 样式更新 | 317–450 ms | 216–250 ms |
| 改为双线性 | 366–516 ms | 217–316 ms |
| 双线性返回完整范围 | 383–416 ms | 317–333 ms |

新数据源首块呈现：FUS 346–351 ms；GJ 298–308 ms。不是逐像素确认的首个有效像素时间。
FUS 的层级为完整范围 5、4× 为 3、16× 为 1、128× 为 0；GJ 分别为 4、2、0、0。
128× 下 FUS 每次平移记录约 205.69 MiB 的文件范围读取，而 GJ 本次命中块缓存、读取为零。
这是应用层逻辑读取字节，不是物理磁盘流量。FUS 单条带 328,788 bytes，原始精度的整行读取放大明显。
GJ 返回已缓存完整范围时无重读/重新着色，稳定仍约 233 ms。现有服务有 150 ms settleDelay、
60 ms 呈现成组窗口；不能把全部等待算成解码时间。Worker 的各阶段耗时是并发累计，不能直接相加。
两输入都是 UInt16，本次 RGB8 直接路径未命中；GJ 命中 native Deflate，没有触发回退。

## 固定纹理绘制：修复后有效结果

现有 luma 示例先把 FUS/GJ 生成 64/40 张 256px RGBA 瓦片，再关闭数据源；后续缩放不读 TIFF、不换 overview。
这仍不是完整动态 luma 栅格后端。本组测的是相同已解码图片的 Canvas/WebGL2/WebGPU 合成。
同场景 ABBA、每轮预热 12 帧并采样 60 帧，每后端/视图 120 个样本；完整范围及 16× 共 8 个视图，
总计 1,920 个采样帧。不使用 fast-nav 快照。下面是完整范围的主线程绘制/提交时间，非 GPU 执行时间。

| 数据 | Canvas 均值（两组） | WebGL2 均值 | WebGPU 均值 | 三后端 rAF 帧率 |
| --- | ---: | ---: | ---: | ---: |
| FUS | 0.315 / 0.424 ms | 2.026 ms | 1.227 ms | 均约 60 FPS |
| GJ | 0.328 / 0.269 ms | 2.156 ms | 0.938 ms | 均约 60 FPS |

暖导航新增几何上传及纹理上传均为 0。当前单纯 GPU 贴图并未证明比 Canvas 更快。
16× 只放大预生成瓦片，不能把它当作原始 TIFF 高清补图性能；首次固定瓦片准备时间也不能和正式动态首屏直接比较。

## 本轮发现并修复的实际错误

第一次基线的 WebGPU FUS 为整幅空白，GJ 完整范围只显示中间一行瓦片。即使 rAF 为 60，
这些结果也无效，原始失败结果保留在 test-results/raster-baseline，未当成成功性能数据。
原因是 GpuRenderer.drawImage 将 scissorRect 的 Y 统一按 WebGL 的左下原点翻转；
luma WebGPU RenderPass 原样转交 setScissorRect，需要左上原点。现按后端分别换算，不改变顶点投影、
数据读取或颜色算法。MDN setScissorRect/scissor 及本地 luma 10.0.0-alpha.1 源码核对了该约定。

修复后，两份文件 × 两后端 × 完整范围/偏移2×/偏移16× 共 12 个实际像素覆盖场景通过。
以 Canvas alpha>16 为参考、允许一个设备像素邻域，本轮缺失和额外覆盖像素计数均为 0。
这是覆盖范围回归，不宣称所有颜色通道逐像素相同；两个图形 API 的滤波/抗锯齿仍应单独评估。

## 下一步优化顺序（尚未实现）

1. FUS 未压缩、Predictor=1 的整行条带：评估按实际窗口列区间直接读取，避免每次取完整 54,798 像素行。
   保留压缩 TIFF 的完整块解码路径、读取边界和取消保护；不修改原文件、不会自动创建/改写 COG。
2. GJ 原生 COG 块：评估 UInt16 数据纹理和原生块身份缓存，把重采样/拉伸/NoData 从反复生成 RGBA 中分离。
   需保留完整数值、样式语义和类型/滤波能力检查；不能直接丢弃高位或套用 RGB8 快路。
3. 基于可见工作集改进缓存和任务亲和、减少样式变化导致的源块重读，并测量保守 settle/呈现窗口的占比。
4. 把 luma 栅格示例从固定图片推进到按视口读源、补充精细 overview 的动态链路，再做端到端后端对比。

以上是根据文件结构和阶段测量提出的方向，不是本轮已实现的速度收益。

## 验证及复现

渲染器/背景缓存单元回归 28 项通过。新增 WebGPU origin 用例修复前 3 项失败、修复后全部通过。
浏览器 6 项通过：4 项真实 TIFF 覆盖、2 项原有 LUCC 编辑/加载回归；后者覆盖原始顶点、撤销重做和背景复用。
两真实 TIFF 的文件大小和 mtime 在测试前后相同；本轮没有计算 24.85GB 文件的完整内容哈希。
数据 Worker 及跟踪的 GPU buffer/texture 字节在释放后归零；未测硬件显存或进程峰值内存。
未用外网 COG、未将 TIFF 复制到仓库或上传、未测 Safari/Firefox/Windows，也未跑 deck.gl-raster 本身的对照。

```bash
cd /Users/zhang/code/emap
pnpm examples:build
pnpm benchmark:luma:raster --data-dir "/Users/zhang/Desktop/测试数据" --out test-results/raster-next
EMAP_BENCHMARK_DATA_DIR="/Users/zhang/Desktop/测试数据" pnpm exec playwright test --config playwright.luma.config.mjs luma-raster.spec.mjs
```

runner 默认两轮动态加载、每轮60帧ABBA，使用并清理自身4195预览服务；可设置 --trials、--frames、--port、--out。
原始基线/失败像素在 test-results/raster-baseline；修复后正确性和纯绘制复测在 test-results/raster-after。
运行时的默认 Canvas 栅格服务未改动，package 版本保持 0.13.1；只创建本地 Git 提交，不推送或发布。
