---
id: undo-redo
slug: /recipes/undo-redo
title: Undo and redo
api: ["Emap"]
examples: ["attribute-editing","undo-redo"]
stability: stable
verifiedVersion: 0.5.0
---

# Undo and redo

History records command commits, transactions, and editing sessions. Use `HistoryControl` or keyboard shortcuts to expose undo/redo to users.

## Behavior notes

Dataset-replace operations should run through `Emap.ops` so history snapshots and selection preservation are updated together.

## API

- [src.HistoryControl](/emap/api/classes/index.HistoryControl.html)
- [src.EditHistory](/emap/api/classes/index.EditHistory.html)

## Runnable examples

- [undo-redo](/emap/examples/undo-redo/)
- [transaction](/emap/examples/transaction/)
- [attribute-editing](/emap/examples/attribute-editing/)

## Minimal snippet

```ts
map.addControl(new HistoryControl(), "top-right")
map.undo()
```
