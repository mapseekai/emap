# luma 2.5D 地面透视

本功能属于 `luma-integration` 分支的显式实验路径。入口为
`examples/luma-25d/`，地图几何由 luma GPU 透视渲染。
手势期间可以复用完成帧并作地面投影变换；这只是短期导航缓存，不替代最终 GPU 重绘。
默认 `Emap.create()`、二维 Camera、Canvas 绘制和正式编辑器仍保持原行为。

## 地面透视能力

- 倾角 `pitch` 为 0–60°；`bearing` 为顺时针相机方位角，规范化为 [-180°, 180°)。
  相机中心保持在地面，固定焦距为视口 CSS 高度的 1.5 倍。
- GLSL/WebGL2 与 WGSL/WebGPU 使用相同的地面透视。面和 RGBA 影像使用齐次投影；
  影像的 UV 进行透视校正。点符号、线宽保持屏幕尺寸，源数据和拓扑不变。
- 原生 UInt8/UInt16 TIFF 在片元中反算地面坐标，从整数纹理采样。
  保留 NoData、alpha、最近邻/双线性、源块缓存、core/halo 复用和异步取消。
- 矢量分块、路径范围、原生栅格及 halo 规划使用视口四角的地面包围盒。
  栅格层级参考逆相机 Jacobian 的局部采样密度，再服从原有瓦片数量与内存预算。
- 原始几何缓冲与已有栅格纹理继续复用；描边的屏幕缓存随视图异步更新。
  需要新区域时，按可见块准备显示数据，不改写原始源坐标。
- 地图采用源 CRS 下的平面地面模型；`pitch=0, bearing=0` 恢复二维投影。

倾角和方位通过本页控件及内部 `PerspectiveTransform` 配置；正式 View API 使用二维相机。
接入透视时需使用配套 GPU renderer；CanvasPainter 的 `mx/my/bx/by` 路径适用于二维仿射变换。
本页单击地面支持源坐标探针；正式选择、绘制和顶点编辑工具使用二维相机。

## 启动

在仓库根目录运行：

```sh
pnpm examples:luma
```

打开 `http://127.0.0.1:4187/mapseekai/emap/examples/luma-25d/`。
右侧地图支持左键拖动平移、滚轮按鼠标地面锚点缩放、右键或 Shift+拖动旋转/倾斜。
方向键平移，`+`/`-` 缩放。工具栏可以返回二维或重新适配完整范围。
GPU 选择框会重新载入页面；切换后需要重新选择本地文件。

默认网格、点和带 NoData 的棋盘格用于演示投影与采样。真实 TIFF 性能需加载本地文件测量。
可以选取 GeoJSON、TIFF+OVR 或整个文件夹；
文件按相对路径匹配外部 OVR，数据仅在本机读取，不上传、不改写。

当前页面同时持有一个矢量数据源（可以包含多个图层）和一个栅格数据源。
默认加载新文件会替换原有内容；勾选“叠加”时只替换同类数据源，且 CRS 必须相同。
CRS 字符串比较仅忽略大小写和首尾空格；不同 WKT/别名需先统一表示。
无显式 CRS 的 GeoJSON 按 EPSG:4326 处理；投影坐标 JSON 需提供正确 CRS 后再叠加。
原生 TIFF 使用 UInt8/UInt16 数值样本；加载器校验样本类型和颜色配置，并报告校验错误。

## 分支内部接口

`src/domain/geo/perspective-transform.ts` 中的相机不依赖 DOM。
它扩展 AffineTransform 并保留原类默认语义。以下示意用于分支内部接入，依赖内部模块路径：

```ts
import { PerspectiveTransform } from '../domain/geo/perspective-transform';

const camera = new PerspectiveTransform(flatView, cssWidth, cssHeight, {
  pitch: 50,
  bearing: -25,
});

// 调用方需保证相机和 renderer 的 CSS 视口尺寸相同。
gpu.resize(cssWidth, cssHeight, devicePixelRatio);
gpu.begin(camera);
gpu.drawMesh(mesh, paint);
gpu.end();

camera.setOrientation({ pitch: 35, bearing: 60 });
camera.scale(1.2, mouseX, mouseY); // 保持鼠标下的地面点不动
camera.pan(dx, dy, currentMouseX, currentMouseY);
const sourceCoordinate = camera.unproject(mouseX, mouseY);
const screenCoordinate = camera.project(sourceX, sourceY);
camera.resize(newCssWidth, newCssHeight); // 保持地面中心
```

原生读取继续使用 NativeRasterLayer 的 `update(camera, width, height, dpr)` 和
`draw(camera, width, height, dpr, style)`。相机参数属于请求签名的一部分；即使 affine
系数不变，改变倾角/方位也会重新规划可见区域。

## 绘制正确性与资源约束

GPU 的高/低位源坐标减法保留，二维 identity 分支继续使用原来的精度路径。
面在齐次空间裁剪，线段在透视除法前处理相机平面交点，点在相机背面时不可见。
原生 TIFF 的每个不相交覆盖区域有独立 uniform buffer，避免 WebGPU 延后提交时
多个 draw 都读到最后一次写入的值。覆盖减少、切回二维或瓦片销毁时释放多余 buffer。

默认启用与 `luma-benchmark` 共用的三项优化：

- 点聚合保留已有世界锚定网格与原始代表点，依据倾斜视口的近侧采样尺度选择网格。
- 描边在 Worker 中按真实透视投影后的屏幕坐标过滤；缓存键包含倾角与方位角。
  相机平面交叉或数值溢出会保守回退到原始几何，面填充与源拓扑保持不变。
- 手势期间只重投影一张完成帧，停止后刷新当前视图；跨越相机平面的快照不复用。
  这会让快照中的符号和线宽暂随变换变化，最终重绘恢复屏幕尺寸。

这三项可在侧栏独立关闭。GeoJSON 仍完整导入；2.5D 页面的 GPU 显示准备改为
当前视口优先，不先构造不需要的全量原始描边和点缓冲。benchmark 的默认全量
A/B 准备流程不变。替换矢量时先释放上一份矢量，取消加载也会终止其准备 Worker。

详细对照见 [矢量性能回归记录](luma-25d-performance.md)。倾斜会改变实际可见范围，
提交数量和 FPS 分别测量；源解析和复杂面的三角化仍可能主导加载。

## 回归

```sh
pnpm exec vitest run src/domain/geo/perspective-transform.test.ts \
  src/integrations/luma src/engine/rendering/luma \
  src/engine/rendering/raster/native-tiles.test.ts \
  src/engine/rendering/raster/native-halo.test.ts
pnpm examples:build
pnpm exec playwright test --config playwright.luma.config.mjs luma-25d.spec.mjs
```

上述浏览器用例包含两套后端的相机角度、像素/UV 校准、NoData、透明度、地面锚点、
控制点位置、纹理复用和释放检查。真实文件测试需要显式提供已授权的数据目录，
否则会标记跳过，不用生成数据冒充：

```sh
EMAP_BENCHMARK_DATA_DIR='/Users/zhang/Desktop/测试数据' \
  pnpm exec playwright test --config playwright.luma.config.mjs luma-25d.spec.mjs
```

真实文件用例读取目录内 `GJ_COG_zip.tif`，改变倾角、旋转、放大后等待新的原生瓦片稳定。
既有 luma 二维页面仍用于检查平面基线和精度，不应删除或改成透视模式来掩盖回归。
