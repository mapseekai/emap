---
id: undo-redo
slug: /recipes/undo-redo
title: 撤销与重做
api: ["Emap", "HistoryControl", "HistoryControlOptions"]
examples: ["attribute-editing", "transaction", "undo-redo"]
stability: stable
verifiedVersion: unreleased
---

# 撤销与重做

`Emap` 为编辑命令、数据操作和事务维护历史记录。添加 `HistoryControl` 提供按钮，并在地图容器上绑定键盘快捷键。

## 添加按钮和快捷键

```ts
await map.addControl(new HistoryControl(), "top-right")
map.bindHistoryShortcuts()
```

`HistoryControl` 根据 `historychange` 更新撤销和重做按钮。`bindHistoryShortcuts()` 绑定 Ctrl/Cmd+Z 撤销，以及 Ctrl/Cmd+Shift+Z 或 Ctrl/Cmd+Y 重做。应用也可以使用 `map.canUndo()`、`map.canRedo()`、`map.undo()` 和 `map.redo()` 构建自定义界面。

事务将其中的编辑组合为一个历史条目：提交后一次撤销会还原整个事务，回滚会恢复事务开始前的数据。

## API

- `Emap`
- `HistoryControl`
- `HistoryControlOptions`

## 可运行示例

- [撤销与重做](/mapseekai/emap/examples/undo-redo/)
- [事务](/mapseekai/emap/examples/transaction/)
- [属性编辑](/mapseekai/emap/examples/attribute-editing/)