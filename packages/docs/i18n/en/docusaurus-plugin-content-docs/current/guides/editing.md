---
slug: /guides/editing
title: Editing
---

# Editing

Edits are command-backed so undo/redo, topology caches, and render invalidation stay synchronized.

## Behavior notes

Use edit sessions for pointer-driven translate/rotate/scale work, controls for mode switching, and transactions when several commands should commit as one user action.

## API

- [src.EditHistory](https://zwishing.github.io/emap/api/classes/index.EditHistory.html)
- [src.EditToolbar](https://zwishing.github.io/emap/api/classes/index.EditToolbar.html)
- [src.Transaction](https://zwishing.github.io/emap/api/classes/index.Transaction.html)

## Runnable examples

- [china-editing](https://zwishing.github.io/emap/examples/china-editing/)
- [vertex-editing](https://zwishing.github.io/emap/examples/vertex-editing/)
- [feature-translate](https://zwishing.github.io/emap/examples/feature-translate/)
- [transaction](https://zwishing.github.io/emap/examples/transaction/)

## Minimal snippet

```ts
const tx = map.beginTransaction("bulk edit")
tx.commit()
map.history.undo()
```
