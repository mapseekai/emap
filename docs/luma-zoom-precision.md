# luma 深度缩放下的编辑位置对齐

本阶段为 `luma集成` 分支的独立 GPU benchmark / 顶点编辑示例提供高低位分离投影，改善深度缩放时的编辑位置对齐。

## 故障复现

使用完整 `lucc.geojson`，选择第 0 行的原始顶点，放大后对照 CPU `AffineTransform.project`
和实际 GPU 白色手柄像素位置。Apple M4 / Chrome 153，DPR 1.25，同一视图在 WebGL2 和
WebGPU 中均测到约 60.313 CSS px 的手柄中心偏差。直接几何绘制和背景快照复用得到相同
偏差，定位到投影计算精度，超过正常半设备像素吸附范围。

独立 GPU 诊断也复现了点、线、路径相对 CPU 投影的位置漂移。原始坐标以高/低两个 f32
存储，但旧着色器在一个缩放表达式中组合高低位差值；在本机编译路径中未稳定保留低位。
high/low 存储还需配合保留精度的后续浮点运算。

## 修改

- GLSL / WGSL 共用相同的投影结构：高位差和低位差分别缩放，再在视口相对坐标中相加。
  `scale` 和 `lowScale` 是两个独立 uniform 操作数，由 CPU 在每帧写入相同缩放值。
  不可将它们合并为单个乘法表达式而取消低位隔离。
- Uniform block 从 192 更新为 208 bytes；数据写入、两种着色器布局和最小绑定尺寸同步。
  屏幕过滤路径使用两套单位缩放，不会污染后续原始坐标编辑绘制的 uniform。
- 点、面、普通线段、连续路径、MSAA 路径和编辑覆盖层使用同一相对投影。
  线段方向直接由原始端点高/低位差计算；端点直接锚定到自己的投影位置，避免用远离视口的
  起点加方向乘长度重建终点，进一步放大取消误差。
- 保留原始 mapshaper dataset、CPU 选择/命中、编辑/撤销/重做、屏幕过滤与背景缓存。
  不调整 CRS、不改原始坐标、不降低 DPR、不限制缩放来掩盖偏差。

该修复覆盖渲染坐标计算所需的运算。非本机 GPU/驱动仍需
运行相同像素测试，不据此宣称所有硬件和任意尺度都精确一致。

## 已验证的数值结果

同一故障视图，两个后端的手柄中心偏差都从 60.313 CSS px 降至 0.0524 CSS px。
这里用白色手柄实际像素的中心对照 CPU 位置，包含栅格化采样的微小量化误差，投影数学误差上界需独立分析。

新增 GPU 精度用例：完整载入 LUCC 后选取其中原始环/顶点，覆盖点、编辑手柄、线、MSAA
路径、解析路径、面，DPR 1 / 1.25 / 2，以及每源单位 1e3、1e6、1e7、1e8、1e9 CSS px 的
缩放。CPU 投影参考使用同一图元布局；面保持原三角索引，避免把重新三角化差异混作投影误差。
两个后端共 360 组像素检查通过；点/手柄中心最大偏差约 0.0461 CSS px，其他图元通过
1 个 CSS 像素量级覆盖邻域内的双向像素匹配。这些局部原始几何只用于精度，性能需独立采样。

实际编辑页另测两个后端 × DPR 1.25 / 2，三种深度缩放、过滤开/关、直接绘制/背景复用，
共 48 个对齐状态，以及真实鼠标拖动和撤销。DPR 1.25 的状态最大中心误差 0.0899 CSS px，
DPR 2 最大 0.0123 CSS px。拖动使用 CPU 预测的命中位置，不使用 GPU 观测位置绕过错位。

## 复现命令

```bash
pnpm examples:build
EMAP_BENCHMARK_DATA_DIR="/Users/zhang/Desktop/测试数据" \
  pnpm exec playwright test --config playwright.luma.config.mjs luma-zoom-precision
```

实际页面：`/mapseekai/emap/examples/luma-vertex-editing/?gpu=webgl`，WebGPU 改为 `gpu=webgpu`。
刷新并重新加载本地文件即可，两个已有屏幕过滤开关可以保持开启。

## 来源与测量边界

本地源码：`src/integrations/luma/{shaders,portable-shaders,path-shaders,gpu-renderer}.ts`。
数值记录及复现前后截图：`test-results/zoom-precision/`；该目录不进入版本库。
新增回归：`test/browser/luma-zoom-precision.spec.mjs` 及对应 fixtures。
本轮验证坐标精度；FPS 和渲染吞吐需独立测量。复杂面重建仍可能产生上轮记录的等待。
外部机制参考：luma.gl 的 GPU Floating-Point Precision Techniques / fp64 文档说明了
high/low 存储与运算精度的区别以及 WGSL/Metal 重排风险；具体缺陷和修复结果以上述本机
源码和像素实验共同提供依据。

## 最终检查

99 项相关单元/回归通过；新增深度缩放浏览器用例 6 项通过（360 个局部 GPU 像素场景、
48 个实际编辑页面状态）；另 12 项既有浏览器回归通过，覆盖 LUCC 编辑反馈/加载完整帧、
五份真实文件的原始编辑，以及 WebGL2/WebGPU 点线样式和合成。
类型、示例类型、公共类型契约、架构、测试布局、生产构建、中英文文档/示例验证均通过。
本机 Chrome 153.0.8010.50 / Apple M4；其他硬件未在本轮验证。
4187 服务保持原 PID，已检查两个示例入口为 HTTP 200，服务返回的 shader bundle 与新构建
哈希一致。本轮未提交、未推送。
