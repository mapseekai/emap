# luma 审查修复记录

基线：`d43b18f9`（保存审查时尚未提交的实现）。三批修复分别提交，不推送或发布。

## 第一批：资源生命周期

普通样式、dash 纹理按帧使用期回收；原生 bundle 重放先标记其 uniform，
未使用的命令计划退出后，在 pass 提交后才释放旧 uniform。图片的自动淘汰、尺寸变化、
显式 forget 和 clear 共享解绑入口；WebGL 不再比较不存在的 imageSampler 字段。
销毁不再尝试呈现待提交帧，单个资源清理失败不跳过其他独立资源和设备。

`painter.stats.memory` 分列 geometry、styles、dash、shared、text、image 与 attachment。
`nominalKnownGpuBytes` 不包括交换链、驱动开销和 CPU 缓存；depth24plus 按每采样四字节估算。
既有 `liveBufferBytes` 保持几何口径，避免破坏现有调用方。

移除旧 drawMeshBatch，测试迁往 drawMeshSequence；移除未消费的 shader uniformTypes
和 @luma.gl/engine 直接依赖；Painter 不再构造未比较的内容指纹；单 tile 复用批量路径的
uploadRasterTile / commitLoadedTile。保留真正参与失效判断的 owner.content。

第一批验证：类型检查、324 条相关单元测试、41 条既有正式地图浏览器回归通过；
新增双后端 300 次样式切换/删除源后的内存回归通过。构建、示例构建、布局/契约/架构检查通过。
