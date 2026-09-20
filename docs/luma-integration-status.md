# luma.gl v10 集成状态

分支：`luma集成`。默认 viewer/editor 仍使用 Canvas2D；以下能力只接入两个独立实验示例。

## 当前实现

luma core/engine/webgl/webgpu 精确锁定 `10.0.0-alpha.1`。使用显式 RenderPass、缓存管线和顶点绑定，
在 WebGL2 / WebGPU 下绘制点、路径、面和固定解码纹理。源数据始终是原生 mapshaper dataset。
Worker 流式导入 GeoJSON，保留属性、坐标系和共享拓扑；视图变化复用完整几何缓存。

**点背景现已按用户要求复用已有 PointLod，默认目标网格为 3 CSS 像素。线、面不恢复 LOD 化简。**
每个网格选择原始代表点，不新增中心点或数量气泡；原生 dataset、选择、编辑和导出仍保持完整精度。
可关闭点聚合进行全量对照。小图层和稀疏视图沿用已有策略，近景可恢复原始可见分块。
普通 viewer/editor 的默认设置没有改变。详见 [点 LOD 接线](luma-point-lod.md)。
历史测量不可当作本轮数据；聚合 FPS 与全精度 FPS 必须分开标识。

点渲染参考 GeoArrow/deck.gl ScatterplotLayer，普通实心圆使用四顶点实例化和解析抗锯齿。
自动优化仅对连续同色不透明圆点分离完全覆盖与分数覆盖；跨空间块先画所有 core，再画 fringe。
不同颜色、非点图元、空心符号与半透明绘制构成顺序边界。没有改变坐标、点数、半径或分辨率。
标准圆点模式使用相同着色器，关闭上述覆盖优化，用于正确性和性能对照。

## 使用

```bash
pnpm examples:luma
```

入口：`/mapseekai/emap/examples/luma-benchmark/?gpu=webgl` 或 `?gpu=webgpu`。
选择 GPU API、点聚合开关/网格大小、圆点策略、半径和透明度后加载真实本地文件。默认圆点半径为 3 CSS px、透明度为 1。
切换 GPU API 会重新加载页面；无 WebGPU 时明确提示，不静默伪装为 WebGPU。

原始顶点选择/移动示例：`/mapseekai/emap/examples/luma-vertex-editing/`，同样接受 `?gpu=webgpu`。
背景与编辑覆盖层共用 GPU；编辑补丁按版本同步 Worker，仅重建受影响分块。

本地文件沿用 emap 的导入限制；没有额外的 benchmark 64 MiB 文件或 256 MiB 几何拒绝门禁。
流式 GeoJSON 单个 Feature 的文本窗口保护与文件总大小是不同限制。

## 验证与边界

全精度五文件基线见 [全精度实测](luma-full-precision-performance.md)。本轮点优化、像素对照与
同数据 GeoArrow 参考见 [点优化](luma-point-optimization.md)。测试只使用授权真实文件做性能依据。

默认渲染器迁移、所有属性样式、所有编辑工具、跨浏览器恢复和 GeoTIFF 端到端性能仍须分别验收。
实验栅格场景只比较固定已解码瓦片的合成，不表示文件读取或解码加速。
未提交、未推送、未发布。
