---
id: runtime
slug: /concepts/runtime
title: Runtime composition
api: ["Emap", "Context", "TopologySource"]
examples: ["plugin-install", "web-worker"]
stability: stable
verifiedVersion: 0.14.0
---

# Runtime composition

Each object on the map has a matching place in the source tree. Read the docs by map task. Use this table when you need to change the engine.

| What you see on the map | Where the code lives |
| --- | --- |
| Features, topology, coordinates, and undoable edits | `src/domain` |
| Map, camera, layer drawing, hit testing, and edit gestures | `src/engine` |
| Plugin assembly, presets, services, and capabilities | `src/runtime` |
| DuckDB, GeoTIFF, GeoPackage, MapLibre, and format decoding | `src/integrations` |
| Zoom, layer controls, and the edit toolbar | `src/ui` |

`Emap.create()` assembles those parts from a preset:

| Preset | Use it for |
| --- | --- |
| `editor` | Viewing, selection, and editing |
| `viewer` | Viewing, query, and selection |
| `headless` | Data work without a canvas |
| `empty` | Choosing plugins yourself |

`map.ctx` is the Cordis `Context`. Runnable pages for installing a plugin and calling a capability are [Install a plugin](/mapseekai/emap/examples/plugin-install/) and [Call a capability](/mapseekai/emap/examples/plugin-capability/). Repository layout, tests, and release checks stay in [Source layout](./architecture.md).

## Runnable examples

- [Install a plugin](/mapseekai/emap/examples/plugin-install/)
- [Web Worker](/mapseekai/emap/examples/web-worker/)
