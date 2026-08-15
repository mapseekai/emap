# 球面长度与面积测量设计

**状态：** 用户已批准设计，待审阅本文档后编写实现计划。

## 目标

为 `Emap` 增加临时、可交互的长度和面积测量：

- 支持多顶点折线的累计长度。
- 支持多顶点闭合多边形的面积。
- 测量值基于地球表面，而非当前显示投影的平面距离或面积。
- 测量图形仅作为 Canvas 覆盖层；不得修改 `TopologySource`、图层、arc、属性表、撤销/重做历史或导出结果。

## 范围外

- 不持久化测量标注或结果。
- 不将测量结果转化为要素。
- 不增加平面距离/面积回退。
- 不升级 `mapshaper` 依赖；项目保持现有 `^0.6.113`，仅参考最新 Mapshaper 的实现语义。
- 不增加英制或双单位配置；首版固定显示公制单位。

## 用户交互

`MeasureControl` 分别以长度和面积模式实例化：

```ts
map.addControl(new MeasureControl({ mode: 'length' }), 'top-left');
map.addControl(new MeasureControl({ mode: 'area' }), 'top-left');
```

- 单击开始测量，后续单击追加顶点。
- 鼠标移动显示下一段的虚线预览和实时数值。
- 长度至少两个顶点、面积至少三个顶点时，双击完成。
- 面积模式可点击起点闭合并完成。
- 完成后保留临时图形和结果；下一次单击开始新的测量。
- `Escape` 清空当前测量但保持工具启用；关闭控件或切换到其他编辑模式则清空并禁用。
- 长度和面积模式与 `draw`、`vertex`、`transform` 及其他测量模式互斥。

## 公共 API

新增：

- `MeasureMode = 'length' | 'area'`。
- `MeasureOptions`：首版只含必填 `mode` 和可选绘制颜色。
- `MeasureResult`：当前模式、完成状态、只读顶点、地表长度（米）或球面面积（平方米）；数值不可用时为 `null`。
- `MeasureHandler`，公开为 `map.measure`，实现既有 `Handler<MeasureOptions>` 合约，并提供只读当前结果查询。
- `MeasureControl`，实现既有 `Control` 合约并通过 `map.measure` 开关对应模式。

新增 API 遵循既有 `HandlerManager` 和 `EventDispatcher` 边界；引擎内部不新增原生 DOM 事件通道。

## 状态与渲染

新增编辑模式 `'measure'` 与独立的 `MeasurementOverlayState`。该状态不得复用 `DrawOverlayState`：绘制要素和临时测量具有不同的生命周期、结果和无数据写入不变量。

`EditStateStore` 持有测量状态，并在离开 `'measure'` 时自动清除。`EditOverlayRenderer` 将它路由给 `CanvasPainter`：

- 已确认的边使用实线，移动指针对应的边使用虚线。
- 所有已确认顶点显示圆点。
- 面积模式对有效闭合轮廓显示半透明填充。
- 标签贴近光标或完成终点，显示 `m` / `km` 或 `m²` / `km²`。
- 地理测量可用时，线和面积边界都通过自适应地表路径采样绘制，而非直接在显示投影中连直线。

渲染更新继续经由现有 `map.render()` 调度，不在渲染函数内引入同步副作用。

## 地表计算

1. Handler 在启用时按当前 CRS 解析并缓存地理坐标变换；CRS 更改时使缓存及未完成请求失效。
2. 每个输入顶点从地图坐标反投影到经纬度。只有地球兼容且反投影成功的坐标可以产生数值结果。
3. **长度**：累计每条边的 WGS84 椭球地表最短路径距离。语义与 Mapshaper 最新 ruler 的 `getGeodesicDistanceFunction()` 一致，使用 `geographiclib-geodesic`。
4. **面积**：对闭合经纬度环使用 Mapshaper 最新 `getSphericalPathArea2()` 的 WGS84 半长轴球面环面积公式，返回绝对面积。计算前连续化跨国际日期变更线的经度，避免把小面误判为余面积。
5. 为让地表曲线正确投影回画布，坐标变换需要正、反两个方向。地表弧段用大圆插值并按屏幕误差自适应细分；这沿用 Mapshaper ruler 的可视化原则，不影响上述数值计算语义。
6. 解析期间或在非地球/无效 CRS 下，覆盖层仍可显示编辑几何，但结果为不可用；不退化为投影平面数值。异步结果必须以 CRS 和测量修订号校验，丢弃陈旧结果。

## 参考实现

截至设计日期，Mapshaper 最新 npm 发布版为 `0.7.52`。本设计参考其当前源码：

- Ruler 的 WGS84 椭球距离与地表曲线显示：<https://github.com/mbloch/mapshaper/blob/master/src/gui/gui-ruler-tool.mjs>
- Ruler 的大圆插值和单位展示：<https://github.com/mbloch/mapshaper/blob/master/src/gui/gui-ruler-utils.mjs>
- 球面环面积与路径周长：<https://github.com/mbloch/mapshaper/blob/master/src/geom/mapshaper-polygon-geom.mjs>
- 大圆距离：<https://github.com/mbloch/mapshaper/blob/master/src/geom/mapshaper-basic-geom.mjs>

Emap 已有 `ScaleCalculator` 使用的 CRS 反投影和 `geographiclib-geodesic` 依赖将作为本地实现的基础；不从新增模块直接导入 Mapshaper。

## 错误与边界

- 重复连续顶点不增加长度。
- 未达到最小顶点数时没有完成结果。
- 反经线、接近投影边界和不可逆投影必须有确定的不可用结果，不能向渲染循环抛出异常。
- 地图平移、缩放时临时坐标不变，覆盖层随现有 `AffineTransform` 重绘。
- 非地球 CRS 被明确拒绝，符合已有 `ScaleCalculator` 的保守地球兼容策略。

## 验收与验证

自动化测试必须覆盖：

1. 赤道一度 WGS84 地表长度及投影坐标反投影后的一致性。
2. Mapshaper 公式对应的球面面积、跨日期变更线面积和重复点。
3. 非地球 CRS、无效投影和过期异步转换结果。
4. 点击、双击、首点闭合、Escape、模式互斥和完成后重新开始。
5. 测量不改变 source 图层、要素数、历史状态或导出内容。
6. Canvas 覆盖层的线、填充和标签绘制调用。

最终验证：运行相关 Vitest 测试和类型检查；在浏览器中启用两个控制，分别完成一次长度与面积测量，确认地表结果可见且数据层要素数不变。
