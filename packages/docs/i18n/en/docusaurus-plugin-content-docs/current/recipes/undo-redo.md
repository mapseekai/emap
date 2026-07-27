---
slug: /recipes/undo-redo
title: Undo and redo
---

# Undo and redo

History records command commits, transactions, and editing sessions. Use `HistoryControl` or keyboard shortcuts to expose undo/redo to users.

## Behavior notes

Dataset-replace operations should run through `Emap.ops` so history snapshots and selection preservation are updated together.

## API

- [src.HistoryControl](https://zwishing.github.io/emap/api/classes/index.HistoryControl.html)
- [src.EditHistory](https://zwishing.github.io/emap/api/classes/index.EditHistory.html)

## Runnable examples

- [undo-redo](https://zwishing.github.io/emap/examples/undo-redo/)
- [transaction](https://zwishing.github.io/emap/examples/transaction/)
- [attribute-editing](https://zwishing.github.io/emap/examples/attribute-editing/)

## Minimal snippet

```ts
map.addControl(new HistoryControl(), "top-right")
map.history.undo()
```
