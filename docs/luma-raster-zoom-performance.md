# 动态栅格放大延迟：复测、批量读取和渐进补图

## 版本、输入与口径

2026-09-21 Mac mini 本地工作区（测试持续到本地午夜附近）。基于 `8384334e` 之后的动态 UInt16 示例，
不是和早期固定 RGBA 图片 benchmark 比较。上一轮及本轮改动均尚未提交；不发布、不推送。
仅使用授权的完整 FUS TIFF 与 GJ_COG_zip.tif；没有生成性能样例或改写原文件。
Apple M4、16 GiB、Chrome 153 headless，1280×678 CSS px、DPR 1、两个数据 Worker。
Canvas/GPU 显示缓存软预算仍为32 MiB，源坐标系、显示样式、纹理尺寸、overview选择规则不变。
每版本每文件/后端两轮，12个独立上下文、132个动作。source-cold不清空操作系统缓存。
`stableMs` 包含8个相机/队列安静的rAF确认，暖场景有约133–150ms下限，不能当成GPU耗时。
`prepareMs` 是当前原始纹理缓存准备就绪时间，不含其后的确认窗口，也不是GPU硬件执行时间。
Worker阶段并发累计，不能相加当墙钟；文件读取量为逻辑范围读取，不是物理磁盘流量。

## 定位

1. FUS原图没有解压缩工作。上一轮按列读减少了字节，却仍把相邻虚拟纹理作为多个独立窗口，
   多次构造/读取分散的条带范围；当前源池还保留整行条带在主Worker的亲和策略。
2. GJ的512×512纹理加一圈相邻像素后，内部514×514窗口可以触及3×3个压缩块。
   窗口间halo、缓存淘汰和Worker缓存副本会放大读取/解码。本轮未更换DEFLATE解码器。
3. 原来的数据准备计数可能已经更新，但画面仍等待全部目标纹理就绪才整体替换；
   单块慢任务拖延其他已完成区域的高清反馈。
4. 原始平面UInt16仍需在主线程打包为RGBA16；原先每像素内还有动态波段循环。
5. 指针与相机共用单个暂停布尔值，camera moveend可过早解除pointer的暂停；
   原来已经完成的上传任务即使交互中仍可进入打包/上传循环。

## 本轮实现

- 新增`native-batches.ts`：优先合并完整小矩形，COG倾向2×2，条带限定同一行；
  根据少读的物理块范围择优，相同收益时避免从中间切出两条剩余边缘。
  每批最多4纹理、8 MiB源输出、有限候选搜索；不跨缺失/已缓存块、不混overview，仍走现有源内存验证。
- 不复制裁剪后的多份平面数组；多张纹理共用一次源读结果，各自从对应子窗口打包。
  rgba16uint整数、波段顺序、NoData和halo保持不变，简化打包内循环；并非零复制，也未将打包迁至Worker。
- 复用正式Canvas的coverage工具：已完成块先发布，每个矩形含NoData都拥有独占显示范围，
  旧数据只填补未完成区域。用scissor区分覆盖，不在同一个WebGPU uniform上反复写不同块裁剪参数。
- 区分pointer/camera暂停来源；交互中暂停新读取和待上传打包，保留已有纹理正常绘制。
  取消只保留新视图仍需的批次；迟到结果不覆盖新视图；错误后停止调度直至重新加载。
- 新增批次数、合并纹理数、解码块数、原始等待队列字节、阶段累计、渐进覆盖等诊断。
  没有增大显示缓存、启用更粗overview、改原始数据或修改默认编辑器。

## 同机前后比较

下面为操作到稳定的毫秒范围（两轮），不是大样本统计：

| 文件 / 动作 | 后端 | 修改前 | 修改后 |
|---|---|---:|---:|
| fus / zoom-4x | webgl | 266–282 | 249–250 |
| fus / zoom-16x | webgl | 267–303 | 250 |
| fus / zoom-128x | webgl | 448–500 | 250–266 |
| fus / pan-native | webgl | 235–300 | 249–250 |
| fus / zoom-4x | webgpu | 267–268 | 249–250 |
| fus / zoom-16x | webgpu | 265–267 | 250 |
| fus / zoom-128x | webgpu | 483–602 | 266–317 |
| fus / pan-native | webgpu | 217–250 | 248–250 |
| gj / zoom-4x | webgl | 317 | 248–250 |
| gj / zoom-16x | webgl | 250 | 248–251 |
| gj / zoom-128x | webgl | 150 | 151–152 |
| gj / pan-native | webgl | 150–151 | 149–150 |
| gj / zoom-4x | webgpu | 317 | 248–250 |
| gj / zoom-16x | webgpu | 249–250 | 249–252 |
| gj / zoom-128x | webgpu | 150–153 | 150–151 |
| gj / pan-native | webgpu | 148–151 | 148–149 |

### 准备与读取细项

| 文件/视图/后端 | 纹理准备 ms 前→后 | 读任务 前→后 | Blob读取调用 前→后 | 逻辑MiB 前→后 | DEFLATE累计ms 前→后 | 主线程打包ms 前→后 |
|---|---:|---:|---:|---:|---:|---:|
| fus/zoom-16x/webgl | 122.1–154.0 → 104.0–104.7 | 15 → 5 | 557–559 → 510–511 | 34.81–34.94 → 31.88–31.94 | 0.0 → 0.0 | 21.0–21.6 → 12.0–13.2 |
| fus/zoom-128x/webgl | 301.8–351.0 → 102.7–119.4 | 12 → 3 | 25 → 7 | 5.00 → 4.98 | 0.0 → 0.0 | 3.6–3.9 → 2.7–2.9 |
| gj/zoom-4x/webgl | 169.1 → 106.8–106.9 | 8 → 2 | 46 → 33 | 28.75 → 19.95 | 134.7–139.7 → 107.7–111.5 | 10.7–10.9 → 6.4–6.9 |
| gj/zoom-16x/webgl | 103.7 → 104.1–104.3 | 8 → 2 | 37–38 → 32 | 21.04–21.62 → 18.16 | 113.3–120.9 → 107.0–109.4 | 11.7–11.9 → 6.6–6.7 |

## 边界与未完成扩展

FUS 128×明显改善；GJ 4×也改善，但GJ 16×整体稳定时间基本不变，FUS纯平移没有稳定、可重复的全面加速。
批次合并有吞吐/首结果延迟权衡：较大的首批可能比旧单窗口晚准备，但现在会立即发布已完成区域；
旧firstTileMs只说明第一张纹理已缓存，不表示旧版已把它呈现。不要直接将两版该计数解释为首个高清像素对比。
GJ某些冷视图逻辑读取仍多于正式Canvas，halo与跨Worker重复并未完全消除。
本轮只改动态示例的调度/专用纹理渲染/打包；共享GeoTIFF Reader、压缩算法和默认Canvas服务不再改动。

后续可再测：源块/halo边缘的更细复用、解码后直接组织上传数据、条带小范围的局部缓存、
实际GPU时间/进程峰值内存。不得未经实测把增加Worker、更换解码器、升级luma或WebGPU视为必然加速。
这些扩展留在本地报告，未获得外部issue写入授权，未创建外部问题记录。

## 复现

```bash
cd /Users/zhang/code/emap
pnpm examples:build
pnpm benchmark:luma:raster:dynamic --data-dir "/Users/zhang/Desktop/测试数据" --trials 2 --out test-results/raster-zoom-next
EMAP_BENCHMARK_DATA_DIR="/Users/zhang/Desktop/测试数据" pnpm exec playwright test --config playwright.luma.config.mjs luma-raster-dynamic.spec.mjs luma-raster-progress.spec.mjs
```

入口 `/mapseekai/emap/examples/luma-raster/?gpu=webgl` 或 `?gpu=webgpu`；4187用户服务不重启。
原始前后结果：`test-results/raster-zoom-opt/before/dynamic.json`、`verified/dynamic.json`；
计算摘要和实现SHA-256：`test-results/raster-zoom-opt/comparison.json`。
测试前后两份TIFF的size/mtime未变；未做24.85GB全文件SHA-256，也未测物理磁盘流量、硬件显存或其他平台。


## 最终验证

249项相关单元/集成回归（24个文件）通过，26项浏览器回归通过：12项真实TIFF动态数值、
8项渐进发布、4项旧栅格覆盖、2项LUCC编辑/刷新。渐进发布用真实文件且人为延后部分读结果，
用于确定性正确性检查，不计入性能数据。检查2,115,278个部分更新区域采样点，
与最终画面像素不匹配数为0；0.5透明度的最大alpha为128，没有重复透明混合。
原始NoData/采样/边界的数值验证沿用原有严格误差口径，并非声称所有最终Canvas/GPU颜色逐像素相同。

类型、类型合约、架构、测试布局、示例生产构建和docs:verify全部通过。关闭后Worker和跟踪纹理
资源归零，两源文件size/mtime未变。最终性能文件对应的5个实现文件SHA-256与最后测试代码相同。
详见`test-results/raster-zoom-opt/browser-final.log`、`unit-all.log`、`checks.log`、`docs-verify.log`。
