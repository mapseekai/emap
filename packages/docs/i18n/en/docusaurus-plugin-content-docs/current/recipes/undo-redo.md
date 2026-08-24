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

- [src.HistoryControl](/mapseekai/emap/api/classes/emap.HistoryControl.html)
- [src.EditHistory](/mapseekai/emap/api/classes/emap.EditHistory.html)

## Runnable examples

- [undo-redo](/mapseekai/emap/examples/undo-redo/)
- [transaction](/mapseekai/emap/examples/transaction/)
- [attribute-editing](/mapseekai/emap/examples/attribute-editing/)

## Minimal snippet

```ts
map.addControl(new HistoryControl(), "top-right")
map.undo()
```
