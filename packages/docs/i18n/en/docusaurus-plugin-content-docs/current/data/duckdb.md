---
id: duckdb
slug: /data/duckdb
title: DuckDB Processing Toolbox
examples: ["duckdb-buffer","duckdb-geoparquet-query","duckdb-overlay","duckdb-spatial-aggregate-join","duckdb-query"]
stability: stable
verifiedVersion: 0.8.1
---

# DuckDB Processing Toolbox

`@mapseekai/emap/duckdb` provides a browser-side DuckDB-Wasm GIS processing toolbox. Processing code is organized by GIS category rather than by registry/executor layers. Every tool owns both its execution function and a `DuckDbToolDefinition` that UI, workflow and Agent callers can consume.

## Setup

```ts
import { createDuckDbRuntimeFromJsDelivr, setDuckDbRuntime } from '@mapseekai/emap/duckdb';
const runtime = await createDuckDbRuntimeFromJsDelivr();
setDuckDbRuntime(runtime);
```

## Short canonical API

```ts
import { buffer, clip, dissolve, spatialJoin, reproject } from '@mapseekai/emap/duckdb';
const buffered = await buffer(dataset, { distance: 20 });
const clipped = await clip(buffered, mask);
const dissolved = await dissolve(clipped, { groupBy: ['type'] });
const joined = await spatialJoin(dissolved, poi, { predicate: 'intersects' });
const wgs84 = await reproject(joined, { targetCrs: 'EPSG:4326' });
```

Public processing functions now use GIS tool names directly instead of `xxxDatasetWithDuckDb` names.

## Categories

| Category | Tools |
| --- | --- |
| Overlay | `clip` / `intersect` / `difference` / `union` / `symmetricDifference` |
| Proximity | `buffer` / `near` / `nearest` |
| Aggregate | `dissolve` / `collect` |
| Join | `attributeJoin` / `spatialJoin` / `spatialSummaryJoin` |
| Geometry | `centroid` / `envelope` / `convexHull` / `boundary` / `simplify` / `simplifyPreserveTopology` / `densify` / `multipartToSinglepart` / `extractVertices` |
| Transform | `pointToLine` / `lineToPolygon` / `polygonToLine` |
| Selection | `attributeFilter` / `spatialFilter` / `spatialRelation` |
| Data Management | `merge` / `append` / `reproject` / `repairGeometry` |
| Attributes | `area` / `length` / `perimeter` / `geometryType` / `isValid` / `isEmpty` / `isSimple` / `x` / `y` / `centroidX` / `centroidY` |

### Agent / workflow discovery

Each tool definition contains input slots, geometry constraints, parameter schema, CRS/unit requirements, output semantics, cost guidance and Agent-oriented metadata (`summary`, `whenToUse`, `avoidWhen`, `keywords`, `examples`).

```ts
import { duckDbToolbox, searchDuckDbTools } from '@mapseekai/emap/duckdb';

const candidates = searchDuckDbTools('count points in polygon');
// candidates[0].id === 'spatialSummaryJoin'

const result = await duckDbToolbox.execute('buffer', {
  inputs: { input: dataset },
  params: { distance: 50 },
  runtime,
});
```

Aliases are resolved too, for example `intersection` → `intersect` and `makeValid` → `repairGeometry`.

## Notes

- `spatialJoin` is a normal one-to-many spatial join; `spatialSummaryJoin` performs count/sum/avg/min/max aggregation.
- Distance tools default to projected CRS requirements.
- `densify` uses the emap/Mapshaper ArcCollection implementation because the current DuckDB-Wasm Spatial runtime does not expose a usable `ST_Segmentize`.
- `union` and `symmetricDifference` currently use coverage geometry semantics, not full QGIS-style dual-attribute overlay semantics.
- Processing functions return new datasets and do not mutate caller-owned inputs.
- GeoParquet query access remains outside the Processing Toolbox.

## Internal layout

```text
src/duckdb/
├── core/
├── overlay/
├── proximity/
├── aggregate/
├── join/
├── geometry/
├── transform/
├── selection/
├── data-management/
├── attributes/
├── geoparquet/
├── toolbox.ts
└── index.ts
```

Category `index.ts` files are re-export-only. Validation, SQL, execution functions and ToolDefinitions live with the corresponding tool files. Shared pipeline/runners and Agent definition contracts live under `core/`.

The legacy root `*-registry.ts`, `*-executor.ts` and `processing-toolbox.ts` compatibility forwarders were removed; the category files under `src/duckdb/` are the only implementation.

## Breaking changes

The old long processing names were removed from the public DuckDB entry point. Examples:

- `bufferDatasetWithDuckDb` → `buffer`
- `intersectionDatasetWithDuckDb` / `intersectDatasetWithDuckDb` → `intersect`
- `queryDatasetWithDuckDb` / `attributeFilterDatasetWithDuckDb` → `attributeFilter`
- `spatialAggregateJoinDatasetWithDuckDb` / `spatialSummaryJoinDatasetWithDuckDb` → `spatialSummaryJoin`
- `makeValidDatasetWithDuckDb` / `repairGeometryDatasetWithDuckDb` → `repairGeometry`
- other `xxxDatasetWithDuckDb` helpers follow the same `xxx` simplification

See the root `CHANGELOG.md` for the full migration note.
