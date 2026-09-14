---
id: status-control
slug: /recipes/status-control
title: Status control
api: ["Emap", "StatusControl", "StatusOptions"]
examples: ["duckdb-geoparquet-query", "duckdb-query", "web-worker"]
stability: stable
verifiedVersion: unreleased
---

# Status control

`StatusControl` displays the pointer coordinate and map CRS on the map. It listens to `mousemove` and `crschange`, and updates the pointer readout once per animation frame.

## Add the status control

```ts
await map.addControl(
  new StatusControl({
    showMousePos: true,
    showEPSG: true,
    alignment: "right",
  }),
  "bottom-left",
)
```

`showMousePos` controls the coordinate readout, `showEPSG` controls the CRS readout, and `alignment` controls content alignment. Put application loading, progress, and error messages in application UI; `StatusControl` is dedicated to coordinates and CRS.

## API

- `Emap`
- `StatusControl`
- `StatusOptions`

## Runnable examples

- [DuckDB GeoParquet query](/mapseekai/emap/examples/duckdb-geoparquet-query/)
- [DuckDB query](/mapseekai/emap/examples/duckdb-query/)
- [Web Worker](/mapseekai/emap/examples/web-worker/)