---
id: undo-redo
slug: /recipes/undo-redo
title: Undo and redo
api: ["Emap", "HistoryControl", "HistoryControlOptions"]
examples: ["attribute-editing", "transaction", "undo-redo"]
stability: stable
verifiedVersion: 0.12.0
---

# Undo and redo

`Emap` tracks edit commands, data operations, and transactions.

```ts
await map.addControl(new HistoryControl(), 'top-right'); // add undo and redo buttons
map.bindHistoryShortcuts(); // bind Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y on the canvas
```

## Core parameters

`HistoryControl` constructor parameters:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `options` | `HistoryControlOptions` | `{}` | Undo/redo button titles and container class |

`HistoryControlOptions` parameters:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `undoTitle` | `string` | `'Undo (Ctrl+Z)'` | Undo button `title` tooltip |
| `redoTitle` | `string` | `'Redo (Ctrl+Shift+Z)'` | Redo button `title` tooltip |
| `className` | `string` | `undefined` | CSS class appended to the control container |

`bindHistoryShortcuts(target?: HTMLElement): () => void` parameters and return value:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `target` | `HTMLElement` | Map canvas container | `keydown` target; an app-owned focusable container scopes shortcuts |
| Return value | `() => void` | — | Removes the listener; a new binding replaces the old one |

## Core methods

Custom buttons can read current state after every `historychange`, including full snapshots and refresh-only events:

```ts
function syncHistoryButtons() {
  undoButton.disabled = !map.canUndo();
  redoButton.disabled = !map.canRedo();
}

map.on('historychange', syncHistoryButtons);
syncHistoryButtons();
```

`Emap` history methods:

| API | Parameters | Return type | Behavior and use case |
| --- | --- | --- | --- |
| `canUndo()` | None | `boolean` | Whether undo is available |
| `canRedo()` | None | `boolean` | Whether redo is available |
| `undo()` | None | `boolean` | Moves the latest entry to redo; `true` if moved |
| `redo()` | None | `boolean` | Moves the latest redo entry to undo; `true` if moved |
| `clearHistory()` | None | `void` | Clears both stacks |

### `historychange` event

Edits, undo, redo, and transaction state changes dispatch `historychange`. The payload is `Partial<HistoryStateSnapshot>`; use `canUndo()` and `canRedo()` for current availability.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `canUndo` | `boolean \| undefined` | `undefined` | Undo availability in a full snapshot |
| `canRedo` | `boolean \| undefined` | `undefined` | Redo availability in a full snapshot |
| `label` | `string \| undefined` | `undefined` | Current undo-stack top label |
| `staleCount` | `number \| undefined` | `undefined` | Undo-stack history-boundary count; marks dataset replacement |
| `topIsStale` | `boolean \| undefined` | `undefined` | Whether the next undo crosses a history boundary |
| `skippedStale` | `boolean \| undefined` | `undefined` | `true` only in the snapshot after crossing a history boundary |

## More transactions

A transaction groups applied edits into one undo entry. `canUndo()` and `canRedo()` are unavailable while it is open; `historychange` re-syncs UI after commit or rollback.

| API | Parameters | Return type | Behavior and use case |
| --- | --- | --- | --- |
| `beginTransaction()` | None | `Transaction` | Starts capturing subsequent edit commands |
| `transaction.isOpen` | None | `boolean` | `true` until `commit()` or `rollback()` |
| `transaction.commit(label)` | Required `label: string` | `Promise<OpResult>` | Waits for tracked operations, combines commands into a labeled entry, and closes |
| `transaction.rollback()` | None | `void` | Reverses commands, restores data and selection, and closes |

Only one transaction can be open; use `isOpen` to safely finish cleanup.
## API

- `Emap`
- `HistoryControl`
- `HistoryControlOptions`

## Runnable examples

- [Undo and redo](/mapseekai/emap/examples/undo-redo/)
- [Transactions](/mapseekai/emap/examples/transaction/)
- [Attribute editing](/mapseekai/emap/examples/attribute-editing/)
