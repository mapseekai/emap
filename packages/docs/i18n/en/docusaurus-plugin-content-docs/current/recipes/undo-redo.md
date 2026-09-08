---
id: undo-redo
slug: /recipes/undo-redo
title: Undo and redo
api: ["Emap", "HistoryControl", "HistoryControlOptions"]
examples: ["attribute-editing", "transaction", "undo-redo"]
stability: stable
verifiedVersion: 0.9.0
---

# Undo and redo

`Emap` maintains history for edit commands, data operations, and transactions. Add `HistoryControl` for buttons, then bind keyboard shortcuts on the map container.

## Add buttons and shortcuts

```ts
map.addControl(new HistoryControl(), "top-right")
map.bindHistoryShortcuts()
```

`HistoryControl` updates its undo and redo buttons from `historychange`. `bindHistoryShortcuts()` binds Ctrl/Cmd+Z for undo and Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y for redo. Custom UI can use `map.canUndo()`, `map.canRedo()`, `map.undo()`, and `map.redo()`.

A transaction combines its edits into one history entry: undo after commit restores the whole transaction, while rollback restores data from before the transaction began.

## API

- `Emap`
- `HistoryControl`
- `HistoryControlOptions`

## Runnable examples

- [Undo and redo](/mapseekai/emap/examples/undo-redo/)
- [Transactions](/mapseekai/emap/examples/transaction/)
- [Attribute editing](/mapseekai/emap/examples/attribute-editing/)