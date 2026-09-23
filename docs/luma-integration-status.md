# luma 集成现状

## 正式地图入口

Emap.create 支持 renderer: canvas2d / webgl2 / webgpu，默认 webgl2。
通过原生 Cordis painterFactory 接入正式图层与编辑服务，不再只能在独立 benchmark 中选择 GPU。
细节与验收范围见 [正式三后端](renderer-backends.md)。这里描述当前代码，不沿用旧报告的未提交状态。

## 已接入正式主链路

点、线、面直接 GPU 绘制；GPU 缓冲复用、原有 PointLod、源图层顺序、过滤和属性样式保持。
附属文字采用 [MSDF 与 HarfBuzz](luma-labels.md)，[点图片符号](luma-icons.md) 复用点坐标。
[Symbol 样式映射](luma-symbol-style.md) 仍为 symbol.layout / paint / labeling / images，不增加图层树节点。
既有 GeoTIFF 的读取、重投影、着色与渐进瓦片通过所选 Painter 合成；选择与编辑仍由正式地图服务管理。
编辑覆盖层继续使用独立 Canvas2D；不是把整幅矢量地图先栅格化再上传 GPU。

## 保留的实验链路

- [2.5D 相机](luma-25d.md) 与 [2.5D 性能](luma-25d-performance.md)：pitch/bearing 尚未进入正式 View API。
- [动态整数栅格](luma-raster-dynamic.md)、[源块与 halo 复用](luma-raster-block-reuse.md)：
  Native integer GPU 纹理仍在 luma-raster/luma-25d 专用链路，不等同于正式瓦片合成路径。
- [完整精度基线](luma-full-precision-performance.md)、[点优化](luma-point-optimization.md)、
  [点 LOD](luma-point-lod.md)、[线优化](luma-line-optimization.md)、[屏幕过滤](luma-canvas-screen-filter.md)、
  [快照导航](luma-fast-navigation.md)、[退远缓存](luma-zoom-out.md)：均为相应实验版本的证据，不能当作正式 Painter 的性能承诺。
- [顶点编辑实验](luma-vertex-editing.md)、[局部刷新](luma-editor-refresh.md)、[深缩放精度](luma-zoom-precision.md)：
  保留专用 Worker/patch 和三角网缓存验收，正式编辑使用原有命令与历史服务。

## 使用

`pnpm examples:luma` 启动示例。正式入口：mixed-data-viewer / geotiff-viewer；实验入口：
luma-benchmark / luma-vertex-editing / luma-raster / luma-25d。
GPU 创建失败不会静默降级；宿主需要兼容路径时应显式创建 Canvas2D 地图。

## 后续整合重点

按正式 API 验收大型矢量首次构建的响应性，再复用实验分块 Worker；之后分别接入原生整数栅格
和正式相机/交互。不能因为三后端选择已接入，就把全部实验性能与 2.5D 编辑能力视为已验收。
