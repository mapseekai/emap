# 栅格内存压力与掉帧审查

日期：2026-09-22。设备：zhangdeMac-mini.local，Apple M4 / 16 GiB，Chrome 153。
分支 luma集成，HEAD 8384334e；动态栅格、后续放大优化与本轮内存修改仍在工作区，未提交/推送。
仅测试用户授权的完整 FUS TIFF 与 GJ_COG_zip.tif；没有改写 TIFF、生成替代性能数据或上传原文件。

## 结论

页面中的 32 MiB 是单类缓存软预算，不是浏览器总内存。FUS 原来还有独立、自适应的 Worker
解码缓存；高 DPR 下 Canvas、交换缓冲与浏览器 GPU 进程的占用远大于数据纹理本身。
本轮已限制此实验页的源解码缓存、复用打包空间并降低诊断面板更新频率。
没有发现所测操作中持续积累的活跃纹理或 Worker；不能据此证明长期绝无泄漏。
控制测试没有复现持续的严重掉帧。少数长帧与系统换页需要继续区分，不能直接认定为 GC。

## 测量口径

- 标准矩阵：1280×900 浏览器，地图1280×678 CSS px；2文件×3后端×DPR1/2，
  修改前后各12个独立Chrome上下文，每例4轮往返缩放/平移、连续滚轮/拖动、2次重新加载、卸载。
- 大视口矩阵：1920×1080 浏览器，地图1920×858 CSS px、DPR2；2文件×2GPU，
  前后各4个上下文，每例3轮，并单独启用 Chrome trace。
- V8 heap 与 backingStorageSize 每约250ms采样；Worker按isolateId去重。backing storage
  包含ArrayBuffer/外部字符串等，不等于仅栅格样本。瞬态峰值可能在采样之间遗漏。
- macOS footprint 在检查点读取；下表进程值是检查点最大值，不是连续捕捉的硬件峰值。
  renderer列是隔离测试浏览器的renderer进程组之和，包含空白/备用renderer基线；GPU列是
  同一隔离浏览器的GPU进程，包含驱动、合成和交换缓冲，不等于独占显存或数据纹理。
- 强制GC和footprint探针的阶段排除出帧率统计；生产代码不调用GC。rAF间隔不是实际显示器
  presentation时序，不将Headless Chrome的结果当成用户前台窗口逐帧复现。
- 各层内存计数存在包含/共享关系，且各自峰值不同时发生，不能把堆、ArrayBuffer、纹理、
  进程footprint直接相加成“总内存”。操作系统文件缓存未清空，其他应用未被关闭。

## 修改前的大视口内存

单位MiB；均为1920×858 CSS、DPR2的采样/检查点最大值。

| 文件 | 后端 | 页面JS堆 | 页面backing | Worker backing | 数据纹理 | renderer进程组 | GPU进程 |
|---|---|---:|---:|---:|---:|---:|---:|
| fus | webgl | 16.0 | 52.9 | 152.0 | 56.4 | 390.8 | 787.6 |
| fus | webgpu | 12.7 | 68.1 | 153.9 | 64.5 | 382.6 | 650.8 |
| gj | webgl | 12.8 | 32.8 | 165.4 | 30.6 | 343.7 | 705.2 |
| gj | webgpu | 10.6 | 57.6 | 193.1 | 36.3 | 303.0 | 605.8 |

这些GPU进程在空白页时已经约257–324 MiB，renderer进程组约144–151 MiB；不能全部归因于TIFF。
同样是FUS，在1280×678 CSS视口下WebGL的GPU进程检查点最大值从DPR1约308 MiB变为DPR2约549 MiB。
这是同机观察，不是普适倍数。同尺寸RGBA8画布从DPR1到DPR2的像素存储量数学上为4倍；
本示例同时保留地图画布与GPU覆盖画布，多缓冲和驱动还会增加其它开销。

## 已落实的改动

1. openGeoTIFF 增加可选 blockCacheBytes（8–256 MiB），约束一个数据源全部Worker的解码缓存，
   未指定时仍用原来的布局自适应策略。luma-raster示例显式设为32 MiB，Canvas/GPU对照相同。
   这不是总内存上限；并发解码的临时数据和GPU纹理单独管理。共享正式viewer的默认值未改。
2. 修复原始数值读取的缓存计数：readWindow响应也更新各Worker的缓存驻留量，不再因为没有
   执行CPU renderTile而把后台缓存显示为0；仍不把原始read误计为已呈现瓦片。
3. UInt16打包复用一个有界工作区，不再每张纹理都重新分配RGBA16数组。源样本不别名写入，
   每次覆盖全部通道，上传后复用，dispose释放。此两文件通常只需约2.02 MiB打包暂存。
4. 诊断JSON不再每个渲染帧重建和写DOM，最多约每250ms或状态切换时更新；新增内存分项说明。
5. 修正渐进像素测试的采样竞争：等待已放行批次的上传队列耗尽，再同时核对截图与区域清单，
   其余真实读结果仍保持阻塞。仍要求已完成区域与最终图像零不匹配，不放宽像素断言。

没有降低DPR、选择更粗overview、量化UInt16或修改NoData/双线性与透明度语义。

## 修改后的大视口内存

| 文件 | 后端 | 页面JS堆 | 页面backing | Worker backing | 数据纹理 | renderer进程组 | GPU进程 |
|---|---|---:|---:|---:|---:|---:|---:|
| fus | webgl | 12.7 | 27.7 | 91.0 | 36.3 | 288.8 | 771.1 |
| fus | webgpu | 12.1 | 51.9 | 88.9 | 34.4 | 285.8 | 625.0 |
| gj | webgl | 12.5 | 24.7 | 177.4 | 30.6 | 293.9 | 747.2 |
| gj | webgpu | 10.8 | 29.4 | 171.0 | 36.3 | 362.8 | 600.1 |

FUS在GC检查点仍存活的Worker backing从约123.5 MiB降至30.5–34.9 MiB（包括缓存和目录等），
这是比JS小对象堆更明显的变化。标准视口中也由约114.5–127.9 MiB降至30.5–34.9 MiB。
GJ的解码缓存原本就接近30 MiB，限制预算后变化小；其短期Worker backing仍约171–189 MiB，
GC后约31 MiB。不能声称这轮解决了GJ所有解压临时内存，也不能把GC前后差额全视为泄漏。
减小缓存的代价是重复访问已淘汰视图可能需要重新读块；没有宣称所有加载动作更快。

## 掉帧、GC和系统压力

大视口trace排除探针/人工GC阶段后，修改前主线程单次GC最大约1.8–4.6ms；修改后约1.8–3.5ms。
这些值不足以证明GC导致用户所感受到的掉帧。修改后4例滚轮/拖动的rAF最大间隔约16.8ms，
整个非探针工作段中GJ WebGL出现一帧约33.4ms；标准矩阵中仍有少量约50ms事件。
因此本轮结论是降低了可控内存开销，未建立“修复前持续掉帧、修复后完全消失”的对照证据。

标准基线开始前系统swap已用约12.84 GiB；标准复测结束时约8.94 GiB，本轮续测前约8.07 GiB。
期间有系统级换入/换出和其他应用负载。Swap已用量不等于当前页面分配量，更不能全归因于emap。
这些背景负载也使OS进程footprint的前后变化不能完全归因于代码。判断机器是否紧张应结合
Activity Monitor的Memory Pressure和实时swap速率，不只看剩余内存或单个缓存数字。

## 生命周期及剩余边界

重复加载后的页面GC存活堆基本稳定（保留了诊断和测试计数对象）；卸载后Worker为0、跟踪的
纹理、打包暂存和活动队列为0。浏览器/驱动保留的分配器缓存可能不会立即退还OS，本轮未把这种
未回落的footprint直接判成泄漏，也未做长时间运行的完整驱动泄漏审计。
没有测Windows/Safari/Firefox、未同时加载两份影像、未采集用户现有Chrome标签页内容。
未来关注GJ解码中间缓冲复用、无用画布背板和更细上传预算，但这些不在本轮已完成收益中。
上述扩展记在本地报告；本轮未向外部问题系统写入数据。

## 复现

```bash
cd /Users/zhang/code/emap
pnpm examples:luma
# 页面：/mapseekai/emap/examples/luma-raster/?gpu=webgl 或 ?gpu=webgpu
# 以下命令在另外一个终端运行，只清理其自己的Chrome和测试服务：
pnpm profile:luma:raster:memory --data-dir "/Users/zhang/Desktop/测试数据" --out test-results/raster-memory-next
pnpm profile:luma:raster:memory --data-dir "/Users/zhang/Desktop/测试数据" --width 1920 --height 1080 --dprs 2 --backends webgl,webgpu --cycles 3 --trace --out test-results/raster-memory-stress-next
```

脚本使用4197预览和9231调试端口，启动前验证空闲；不操作4187已有服务。仅适用于本轮macOS/Chrome环境。
原始检查点、逐帧与进程记录：test-results/raster-memory-audit/{baseline,after,stress-trace,after-stress}/memory.json。
GC trace另存gzip；summary.json是导出摘要。两源文件size/mtime不变，未对24.85GB文件做全量哈希。

## 参考口径

- Chrome官方内存工具说明：https://developer.chrome.com/docs/devtools/memory-problems
- Chrome DevTools Protocol Runtime.getHeapUsage：运行时的usedSize/backingStorageSize按不同isolate记录。
- Apple Activity Monitor内存说明：https://support.apple.com/guide/activity-monitor/view-memory-usage-actmntr1004/mac
- MDN强制布局时长定义：https://developer.mozilla.org/en-US/docs/Web/API/PerformanceScriptTiming/forcedStyleAndLayoutDuration

上述页面仅用于解释指标。所有FUS/GJ数值来自本地真实文件测试，不是官方性能数据。


## 最终验证结果

相关单元/集成回归262项（25个文件）通过；最终浏览器回归26项通过，包含12项真实TIFF数值、
8项渐进补图、4项固定栅格覆盖和2项LUCC编辑/加载检查。先前DPR2渐进测试截图与区域清单
不同步的问题已修正，再次通过严格零不匹配断言。不是放宽精度容差来通过检查。

docs:verify通过（类型、公开类型合约、示例类型、API面、示例/中英文文档构建及校验），
architecture:check通过。大视口复测后六个实现文件SHA-256与最终代码一致。
原始验证日志：test-results/raster-memory-audit/unit-final.log及completion/browser-final.log、
completion/docs-verify.log、completion/architecture.log。未创建新提交或推送。
