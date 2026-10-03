# luma 近景退远：缓存依赖修复

## 屏幕路径独立提交与缓存修复

基于用户完整真实数据复现：近景淘汰屏幕外原始缓存后，退远先恢复原始 GPU 分块，
再生成真正使用的屏幕过滤路径，快照一直等到两类数据全部就绪才替换。
LUCC 的缓存按最近使用时间淘汰了昂贵的完整面三角网；big 又重复构建原始路径作为屏幕描边的依赖。

`BenchmarkRenderers` 现在允许屏幕路径独立提交，原始路径仅在原始 A/B、关闭过滤或过滤明确回退时需要。
精简的原始统计信息独立保留，不再为了统计重建坐标。
缓存优先淘汰非活跃原始线、再淘汰面，字节预算仍为 256 MiB；不增加几何化简或修改过滤规则。
快照更新记录每个最新交互视图，结束后不再误启动上一个近景的准备。

原始 mapshaper dataset、拓扑、填充/洞、选择与编辑、绘制顺序保留。该阶段的正式地图使用 Canvas。
范围限 `luma-benchmark` 与 `luma-vertex-editing`。首次导入和大于缓存预算的面数据仍可能耗时。
屏幕坐标仍需随视图重新计算，不把固定视图暖重绘帧率解释为零等待。

## 验证方式

真实数据完整导入，PointLod 关闭，Canvas 微小 arc / 半设备像素过滤开启。
从 16× 近景分别执行 7 次和 15 次真实滚轮事件（每次缩放倍率 exp(-0.4)），
目标约为初始范围的 0.973× 和 0.0397×，即近似完整范围与远景。
计时从最后一次 wheel 调用完成及 16 ms 采样间隔后算起，直到当前完整画面替换快照；不在计时中调用 setView/settle 预热。
包括停止防抖、屏幕路径准备、绘制和完成同步，记录操作结束至画面就绪的墙钟时间。
测试前使用 setView(16) 到达近景并触发缓存淘汰；反映已导入数据的缓存恢复；首次加载另行计时。

```bash
pnpm examples:build
pnpm benchmark:luma:zoom-out --data-dir /Users/zhang/Desktop/测试数据 --assert-refill
```

独立 4195 loopback 服务在脚本结束关闭，不停止/重启用户 4187 服务。
原始测量位于 `test-results/luma-zoomout-before/` 和 `test-results/luma-zoomout-verified/`。


### 像素检查的时间点

Chrome WebGPU 本轮在页面呈现后再次读取 canvas 得到透明，但浏览器截图与渲染完成时保存的图像正常。
验证因此读取完成时保存的同尺寸图像，并检查其视图与最新视图一致，再与重新完整绘制的同视图结果比较。
不以空白像素或上一次近景图像作为通过结果。初次无效读回记录单独保存在测试目录，未用作性能结论。

## 本机实测

Apple M4、16 GiB、Headless Chrome 153；1238×450 CSS px、DPR 1。非独占机器，单轮样本；目标环境可按本节命令复测。

| 文件 | API | 目标 | 改动前等待 ms | 改动后等待 ms | 原始线重建 | 面重建 | 原始缓存 MiB |
|---|---|---|---:|---:|---:|---:|---:|
| big.geojson | webgl | fit | 1598 | 318 | 0 | 0 | 250.53 |
| big.geojson | webgl | far | 1281 | 265 | 0 | 0 | 250.53 |
| lucc.geojson | webgl | fit | 11400 | 298 | 0 | 0 | 255.18 |
| lucc.geojson | webgl | far | 10164 | 250 | 0 | 0 | 255.18 |
| building.geojson | webgl | fit | 未测 | 183 | 0 | 0 | 152.81 |
| building.geojson | webgl | far | 未测 | 181 | 0 | 0 | 152.81 |
| points.geojson | webgl | fit | 未测 | 298 | 0 | 0 | 7.66 |
| points.geojson | webgl | far | 未测 | 332 | 0 | 0 | 7.66 |
| pppp.geojson | webgl | fit | 未测 | 316 | 0 | 0 | 50.68 |
| pppp.geojson | webgl | far | 未测 | 480 | 0 | 0 | 50.68 |
| big.geojson | webgpu | fit | 未测 | 281 | 0 | 0 | 250.53 |
| big.geojson | webgpu | far | 未测 | 281 | 0 | 0 | 250.53 |
| lucc.geojson | webgpu | fit | 未测 | 347 | 0 | 0 | 255.18 |
| lucc.geojson | webgpu | far | 未测 | 232 | 0 | 0 | 255.18 |
| building.geojson | webgpu | fit | 未测 | 235 | 0 | 0 | 152.81 |
| building.geojson | webgpu | far | 未测 | 181 | 0 | 0 | 152.81 |
| points.geojson | webgpu | fit | 未测 | 284 | 0 | 0 | 7.66 |
| points.geojson | webgpu | far | 未测 | 365 | 0 | 0 | 7.66 |
| pppp.geojson | webgpu | fit | 未测 | 315 | 0 | 0 | 50.68 |
| pppp.geojson | webgpu | far | 未测 | 517 | 0 | 0 | 50.68 |

改动前 WebGL2 LUCC 退远每次重新构建 121 个完整面分块；big 重建 185 个原始线分块后才准备屏幕路径。
改动后本轮 10 个文件/API 组合、20 次转换中原始线与面的重复构建均为 0；仍重新生成当前视图屏幕路径，未改变过滤结果。
两后端原文件哈希均不变，释放后数据 Worker 和跟踪的 GPU 几何字节归零。
表中缓存不含原始 dataset、属性、屏幕过滤缓存、纹理或浏览器/驱动内存，总峰值内存需另行测量。
WebGPU 没有测改动前的同路线基线，不把 WebGL2 旧值当作 WebGPU 加速比。

初始导入仍约需数秒到数十秒。本修复针对导入完成之后的退远恢复；超过预算的面三角网仍会被淘汰。
关闭屏幕过滤或者过滤必须回退原始几何时，原始线 Buffer 仍需按需重建。

## 代码与复现

主要改动：`packages/examples/src/luma-benchmark/renderers.ts`。
回归：`test/examples/luma-zoom-out.test.ts`、`test/browser/luma-zoom-out.spec.mjs`。
原始统计和帧截图：`test-results/luma-zoomout-verified/`；之前的失败诊断单独保留。
本轮未提交、未推送、未发布。


## 验证结论

204 项相关单元/回归通过；19 项针对性浏览器用例通过，另 6 项 WebGPU 原始编辑用例通过。
包括完成帧像素与原始缓存补齐后重绘结果一致、真实滚轮方向中途改变、原始 A/B、点聚合开关、
五份文件选择/移动/取消/撤销重做、空过滤块不触发原始恢复，以及源文件和资源释放检查。
类型、公共类型契约、示例类型、架构、测试布局、生产构建、中英文文档及示例验证均通过。
