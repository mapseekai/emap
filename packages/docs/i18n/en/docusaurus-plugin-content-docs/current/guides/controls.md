---
id: controls
slug: /guides/controls
title: Controls
api: ["BasemapControl","BasemapOptions","BasemapStyle","BoxSelectControl","BoxSelectControlOptions","Control","ControlPosition","DrawFeatureControl","DrawFeatureControlOptions","EditToolbar","EditToolbarOptions","Emap","HistoryControl","HistoryControlOptions","LassoSelectControl","LassoSelectControlOptions","NavigationControl","NavigationOptions","SimplifyControl","SimplifyControlOptions","StatusControl","StatusOptions","VertexEditControl","VertexEditControlOptions"]
examples: ["box-select","china-editing","draw-snap-edge","interaction-handlers","lasso-select","simplify-control","vertex-editing"]
stability: stable
verifiedVersion: 0.5.0
---

# Controls

Controls are optional DOM surfaces mounted in the map corners. They call public
map APIs or switch handlers and do not own a second copy of map state. Use all
built-in controls, a subset, or only the engine under custom application UI.

## Add and remove

```ts
const navigation = new NavigationControl();

map.addControl(navigation, 'top-left');
map.removeControl(navigation);
```

Positions are `top-left`, `top-right`, `bottom-left`, and `bottom-right`.
The default is `top-left`. Removal requires the same control instance.

## Control styles

Built-in controls require:

```ts
import '@mapseekai/emap/style.css';
```

Controls mount inside the map container, so page-level CSS may affect buttons,
inputs, and fonts. Scope application overrides through an outer application
class.

## Built-in controls

| Control | Purpose |
|---|---|
| `NavigationControl` | Zoom and view navigation |
| `HistoryControl` | Undo and redo |
| `StatusControl` | Pointer coordinates and EPSG display |
| `BasemapControl` | Application-provided basemap styles |
| `BoxSelectControl` | Box selection |
| `LassoSelectControl` | Lasso selection |
| `VertexEditControl` | Vertex-edit mode |
| `DrawFeatureControl` | Point, line, or polygon drawing |
| `EditToolbar` | Common editing modes |
| `SimplifyControl` | Preview and commit simplification |

## Navigation, history, and status

```ts
map.addControl(new NavigationControl(), 'top-left');
map.addControl(new HistoryControl(), 'top-right');
map.addControl(
  new StatusControl({
    showMousePos: true,
    showEPSG: true,
    alignment: 'right',
  }),
  'bottom-right',
);
```

`StatusControl` defers updates through `requestAnimationFrame` instead of
rewriting the DOM on every pointermove.

## Mode controls

Selection and editing controls enable map handlers:

```ts
const boxControl = new BoxSelectControl();
const vertexControl = new VertexEditControl();

map.addControl(boxControl, 'top-left');
map.addControl(vertexControl, 'top-left');
```

Keep only the gesture mode needed by the current tool enabled. Do not duplicate
pointerdown/pointermove logic outside the control; that bypasses HandlerManager
gesture arbitration and cursor ownership.

## Custom controls

A custom control implements `Control`:

```ts
import type { Control, Emap } from '@mapseekai/emap';

class ResetViewControl implements Control {
  private button: HTMLButtonElement | null = null;
  private map: Emap | null = null;

  onAdd(map: Emap): HTMLElement {
    this.map = map;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.textContent = 'Reset';
    this.button.addEventListener('click', this.handleClick);
    return this.button;
  }

  onRemove(): void {
    this.button?.removeEventListener('click', this.handleClick);
    this.button?.remove();
    this.button = null;
    this.map = null;
  }

  private handleClick = (): void => {
    this.map?.reset();
  };
}

map.addControl(new ResetViewControl(), 'top-left');
```

The map inserts the element returned by `onAdd`. `onRemove` must release DOM
listeners and other external resources.

## Application toolbars

Business UI can call the same public APIs:

```ts
undoButton.addEventListener('click', () => map.undo());

boxButton.addEventListener('click', () => {
  map.lassoSelect.disable();
  map.boxSelect.enable();
});
```

Use `historychange`, `selectionchange`, and `editmodechange` to update button
state instead of assuming every click changed the map.

## Troubleshooting

- If a visible control cannot be clicked, check application `pointer-events`
  and overlays. `addControl` sets `pointer-events: auto`.
- A custom control must unregister its DOM and map listeners in `onRemove`.
- Derive active editing buttons from handler `isEnabled()` or
  `editmodechange`, and disable the old mode before enabling a new one.

## API

- [Control](/mapseekai/emap/api/interfaces/index.Control.html)
- [ControlPosition](/mapseekai/emap/api/types/index.ControlPosition.html)
- [NavigationControl](/mapseekai/emap/api/classes/index.NavigationControl.html)
- [HistoryControl](/mapseekai/emap/api/classes/index.HistoryControl.html)
- [StatusControl](/mapseekai/emap/api/classes/index.StatusControl.html)

## Runnable examples

- [Simplify control](/mapseekai/emap/examples/simplify-control/)
- [Undo and redo](/mapseekai/emap/examples/undo-redo/)
- [Interaction handlers](/mapseekai/emap/examples/interaction-handlers/)
- [Vertex editing](/mapseekai/emap/examples/vertex-editing/)
