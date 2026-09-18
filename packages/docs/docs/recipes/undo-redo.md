---
id: undo-redo
slug: /recipes/undo-redo
title: 撤销与重做
api: ["Emap", "HistoryControl", "HistoryControlOptions"]
examples: ["attribute-editing", "transaction", "undo-redo"]
stability: stable
verifiedVersion: 0.13.0
---

# 撤销与重做

`Emap` 跟踪编辑命令、数据操作和事务。

```ts
await map.addControl(new HistoryControl(), 'top-right'); // 添加撤销和重做按钮
map.bindHistoryShortcuts(); // 在 canvas 上绑定 Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z 或 Ctrl/Cmd+Y
```

## 核心参数

`HistoryControl` 的构造参数：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `options` | `HistoryControlOptions` | `{}` | 撤销/重做按钮标题和容器类名 |

`HistoryControlOptions` 的参数：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `undoTitle` | `string` | `'Undo (Ctrl+Z)'` | 撤销按钮的 `title` 提示文本 |
| `redoTitle` | `string` | `'Redo (Ctrl+Shift+Z)'` | 重做按钮的 `title` 提示文本 |
| `className` | `string` | `undefined` | 追加到控件容器的 CSS 类 |

`bindHistoryShortcuts(target?: HTMLElement): () => void` 的参数和返回值：

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `target` | `HTMLElement` | 地图 canvas 容器 | 接收 `keydown` 的元素；可传入应用的可聚焦容器限定作用域 |
| 返回值 | `() => void` | — | 解绑监听器；新绑定替换旧绑定 |

## 核心方法

自定义按钮可在每次 `historychange` 后读取当前状态，兼容完整快照和仅刷新事件：

```ts
function syncHistoryButtons() {
  undoButton.disabled = !map.canUndo();
  redoButton.disabled = !map.canRedo();
}

map.on('historychange', syncHistoryButtons);
syncHistoryButtons();
```

`Emap` 的历史方法：

| API | 参数 | 返回类型 | 行为与使用场景 |
| --- | --- | --- | --- |
| `canUndo()` | 无 | `boolean` | 撤销是否可执行 |
| `canRedo()` | 无 | `boolean` | 重做是否可执行 |
| `undo()` | 无 | `boolean` | 将最近条目移入重做栈；移动成功时为 `true` |
| `redo()` | 无 | `boolean` | 将最近重做条目移回撤销栈；移动成功时为 `true` |
| `clearHistory()` | 无 | `void` | 清空撤销和重做栈 |

### `historychange` 事件

编辑、撤销、重做及事务状态变化都会触发 `historychange`。载荷为 `Partial<HistoryStateSnapshot>`；回调中用 `canUndo()` 和 `canRedo()` 读取当前可用状态。

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `canUndo` | `boolean \| undefined` | `undefined` | 完整快照中的撤销可用状态 |
| `canRedo` | `boolean \| undefined` | `undefined` | 完整快照中的重做可用状态 |
| `label` | `string \| undefined` | `undefined` | 当前撤销栈顶条目的标签 |
| `staleCount` | `number \| undefined` | `undefined` | 撤销栈中的历史边界数量，标记数据替换分界 |
| `topIsStale` | `boolean \| undefined` | `undefined` | 下一次撤销是否跨越历史边界 |
| `skippedStale` | `boolean \| undefined` | `undefined` | 仅在跨越历史边界后的快照中为 `true` |

## 更多事务

事务将多个已执行编辑合为一个撤销条目。打开时 `canUndo()` 和 `canRedo()` 均不可用；提交或回滚后，`historychange` 同步界面。

| API | 参数 | 返回类型 | 行为与使用场景 |
| --- | --- | --- | --- |
| `beginTransaction()` | 无 | `Transaction` | 开始捕获后续编辑命令 |
| `transaction.isOpen` | 无 | `boolean` | `commit()` 或 `rollback()` 前为 `true` |
| `transaction.commit(label)` | `label: string`（必填） | `Promise<OpResult>` | 等待已跟踪操作，将命令合为带标签条目并关闭事务 |
| `transaction.rollback()` | 无 | `void` | 逆序还原命令、恢复数据和选择状态并关闭事务 |

事务一次只能打开一个；用 `isOpen` 安全结束清理路径。
## API

- `Emap`
- `HistoryControl`
- `HistoryControlOptions`

## 可运行示例

- [撤销与重做](/mapseekai/emap/examples/undo-redo/)
- [事务](/mapseekai/emap/examples/transaction/)
- [属性编辑](/mapseekai/emap/examples/attribute-editing/)
