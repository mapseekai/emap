# luma 选择与顶点编辑示例

分支：`luma集成`。入口：`/mapseekai/emap/examples/luma-vertex-editing/`。

## 使用

在已有示例 preview 服务中打开上述页面；没有服务时，从仓库根目录运行：

```bash
pnpm examples:luma
```

默认监听本机 4187。已有 4187 服务时不要重复启动；构建后刷新浏览器即可。
页面初始化为空，不读取未授权路径，也不生成性能测试数据。
选择本地 GeoJSON 后点击“加载文件”，可以一次选择多个文件，再通过下拉框逐个加载。

单击选择一个原始要素，右侧查看原始属性。小图斑可按“定位选中”放大。
也可按数据图层和 **0 起始要素行号** 选择；行号不是属性表中的 `id` 或 `fid`。
选择“顶点编辑”，拖动白色顶点。橙色边界保留原始几何，红色短线是移动预览。
点和 MultiPoint 可移动单个原始点组件。线、面使用原生 mapshaper vertex ID。

松开鼠标提交一次编辑；Esc 取消尚未提交的拖动。Ctrl/Cmd+Z 撤销，
Ctrl/Cmd+Shift+Z 或 Ctrl+Y 重做。拖动空白处平移，滚轮缩放。
共享节点所有顶点副本及闭合环首尾一起移动；共享边邻接要素因此联动。
清除选择不撤销已提交编辑。重新加载文件会丢弃内存编辑和历史，不覆盖磁盘文件。

“导出选中 GeoJSON”只导出当前选中要素的原始精度几何及属性。
为保留源坐标值，使用含 CRS 的 **GeoJSON 2008**，不会暗中重投影到 WGS84。
这与只允许 WGS84 的 RFC 7946 输出不是同一口径。

## 运行链路

读取文件沿用 benchmark 的流式 GeoJSON Worker。主线程持有原生 mapshaper dataset，
LOD Worker 保留派生显示副本。选择与历史复用 emap 的 `FeatureQuery`、`LayerRegistry`、
`Selection`、`EditHistory` 和 `VertexMoveCommand`，而不是操作三角网顶点。

查询源明确禁用 DisplayArcs；当前选中要素的轮廓和顶点同样从原始坐标读取。
点 LOD 只影响点背景（默认目标网格 3 CSS px，可关闭）；线面保持全精度。拖动期间不修改源坐标、不重做面三角化；只绘制相邻原始线段的预览。
松开后命令修改原始坐标、增加 editVersion，清除选择查询索引，并传递坐标补丁。
Worker 串行处理有序 revision，只更新受影响 arc 的阈值和 chunk 的包围盒。
渲染器淘汰这些 chunk 的旧显示缓存，生成当前视口需要的版本，其他缓存继续复用。
撤销与重做通过相同补丁路径同步，不会只恢复高亮层却留下旧背景。

## 边界

本版是单要素选择与顶点移动示例，不提供框选、多选、插入/删除顶点或节点拆分。
不自动修复拖动造成的自交或退化几何。背景和高亮都会使用 luma；没有 Canvas 回退。
Canvas 对照对象仍由共享 benchmark 基础设施持有，但本页不绘制 Canvas 图层。

这是独立编辑验证，不是默认 viewer/editor preset 的全量后端迁移。
首次大文件导入、选择索引及显示缓存准备仍有等待成本。
编辑后的 Worker 缓存更新期间暂不接受下一次编辑；原始数据不会写回磁盘。

## 验证

浏览器验收只使用用户授权的 `points.geojson`、`building.geojson`、`lucc.geojson`、
`pppp.geojson`、`big.geojson` 全文件。契约单测的小型几何仅用于验证闭合环、共享节点、
洞和多点组件语义，不作为性能数据。

```bash
pnpm build
pnpm examples:build
EMAP_BENCHMARK_DATA_DIR="/Users/zhang/Desktop/测试数据" \
  pnpm exec playwright test --config playwright.luma.config.mjs test/browser/luma-editor.spec.mjs
```

检查真实指针拖动/取消、撤销/重做、Worker 编辑坐标、GPU 像素及错误、释放后的资源，
并比较测试前后原始文件 SHA-256，确认不修改磁盘数据。

### 本轮真实文件验收

五份文件均完整导入；逐个检查原始要素行号 0 的选择、实际指针拖动、Esc 取消、
撤销、重做、选中导出精确回放，以及 Worker 返回几何包含修改后的坐标。

| 文件 | 完整导入要素数 | 本次移动的原生顶点/点组件 | 更新显示分块 |
| --- | ---: | ---: | ---: |
| points.geojson | 250,988 | 1 个点组件 | 1 |
| building.geojson | 251,014 | 2 个原生顶点 | 2 |
| lucc.geojson | 9,384 | 3 个原生顶点 | 2 |
| pppp.geojson | 1,660,384 | 1 个点组件 | 1 |
| big.geojson | 483,268 | 2 个原生顶点 | 1 |

“多个原生顶点”指闭合环首尾或共享节点的坐标副本一起移动，不是随意移动多个节点。
五个测试均验证实际 WebGL 像素、GL error 为 0、页面异常为空、释放后的 Worker 数与
GPU 几何字节计数归零，原文件 SHA-256 不变。这是功能验收，不是编辑 FPS 基准，
也不代表穷举了文件内每个要素或每种不合法几何。
