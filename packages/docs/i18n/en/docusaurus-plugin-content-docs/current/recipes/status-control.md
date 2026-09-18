---
id: status-control
slug: /recipes/status-control
title: Status control
api: ["Emap", "StatusControl", "StatusOptions"]
examples: ["duckdb-geoparquet-query", "duckdb-query", "web-worker"]
stability: stable
verifiedVersion: 0.13.0
---

# Status control

`StatusControl` displays the pointer coordinate and map CRS.
```ts
await map.addControl(
  // mount the control
  new StatusControl({
    showMousePos: true, // show the pointer coordinate
    showEPSG: true, // show the map CRS
    alignment: 'right', // align the readout
  }),
  'bottom-left', // choose the control corner
);
```

## Core parameters


### Control options

`new StatusControl(options?)` accepts optional `StatusOptions`; omitting it shows both readouts left-aligned.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `showMousePos` | `boolean` | `true` | Shows the current pointer's `mapCoord` to four decimal places; `false` gives a compact CRS-only bar |
| `showEPSG` | `boolean` | `true` | Shows the map CRS, read on mount and refreshed on `crschange`; common aliases normalize to `EPSG:4326`, `EPSG:3857`, and similar identifiers |
| `alignment` | `'left' \| 'right' \| 'center'` | `'left'` | Horizontal alignment within the control |
| `className` | `string` | Unset | CSS class names appended to the control root |

## More mounting options

Mount and remove the control through `Emap`; `removeControl()` releases subscriptions and removes its DOM.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `control` | `Control` | Required | Control instance to mount; one instance can occupy one placement at a time |
| `position` | `'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'` | `'top-left'` | Control area; status bars usually use `'bottom-left'` or `'bottom-right'` |

`map.addControl(control, position)` and `map.removeControl(control)` return `Promise<void>`; the latter accepts the same instance.

## API

- `Emap`
- `StatusControl`
- `StatusOptions`

## Runnable examples

- [DuckDB GeoParquet query](/mapseekai/emap/examples/duckdb-geoparquet-query/)
- [DuckDB query](/mapseekai/emap/examples/duckdb-query/)
- [Web Worker](/mapseekai/emap/examples/web-worker/)
