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

## 第二批：交互分配和可取消上传

MSDF 与 bitmap 文字保留足够容量的实例 Buffer 和 VAO，并共用一个有界的 CPU staging 数组。
相机改变仍执行成员、顺序、碰撞与 atlas generation 检查；必要的位置数据仍上传，
不声称纯导航已经是 uniform-only，也不跳过标签裁剪。容量只在增长时扩大，未使用批次及时释放。
新增 bufferAllocations、reusedBatches、stagingBytes，分开记录分配、写入和 CPU 工作缓冲。

一个 GeometryResult 内按 mesh 检查 4 ms / 2 MiB 上传切片；先预留全部载荷预算，
部分缓冲归属 building entry，完成前只显示旧 fallback。取消/失败回滚已上传 mesh 与预算。
单次原生 buffer.write 不能被抢占，因此 4 ms 是让步检查预算而非绝对时长保证。
新增 peakResultBytes、pendingUploadBytes、uploadCpuMs、maxMeshUploadMs、maxUploadSliceMs、uploadYields。

第二批验证：342 条相关单元测试通过；浏览器 67 条通过、1 条环境条件跳过。
Apple M4 / Chrome 153.0.8010.53，两后端同一 120 标签、370 字形、20 步平移：
新增 GPU Buffer/VAO 从审查时各 20 个降至 0；实例写入仍 20 次，atlas 上传仍 1 次。
CPU staging 为 32,560 字节，正常销毁后为 0。没有将此结果换算为整体 FPS 倍率。
构建、示例构建、类型、布局和架构检查通过。上传取消/失败、旧 fallback 与完整 entry 提交有回归覆盖。
