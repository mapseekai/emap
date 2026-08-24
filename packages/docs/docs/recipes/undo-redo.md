---
id: undo-redo
slug: /recipes/undo-redo
title: 撤销与重做
api: ["Emap"]
examples: ["attribute-editing","undo-redo"]
stability: stable
verifiedVersion: 0.5.0
---

# 撤销与重做

历史记录命令提交、transaction 和编辑会话。通过 `HistoryControl` 或键盘快捷键把撤销/重做暴露给用户。

## 行为说明

数据集替换操作应走 `Emap.ops`，这样历史快照和选择保留会一起更新。

## API

- [src.HistoryControl](/mapseekai/emap/api/classes/emap.HistoryControl.html)
- [src.EditHistory](/mapseekai/emap/api/classes/emap.EditHistory.html)

## 可运行示例

- [undo-redo](/mapseekai/emap/examples/undo-redo/)
- [transaction](/mapseekai/emap/examples/transaction/)
- [attribute-editing](/mapseekai/emap/examples/attribute-editing/)

## 最小片段

```ts
map.addControl(new HistoryControl(), "top-right")
map.undo()
```
