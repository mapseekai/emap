---
id: duckdb
slug: /data/duckdb
title: DuckDB
api: ["areaDatasetWithDuckDb","boundaryDatasetWithDuckDb","bufferDatasetWithDuckDb","centroidDatasetWithDuckDb","centroidXDatasetWithDuckDb","centroidYDatasetWithDuckDb","closeDuckDbRuntime","containsAttributeDatasetWithDuckDb","containsDatasetWithDuckDb","convexHullDatasetWithDuckDb","createDuckDbGeoParquetQuerySource","createDuckDbRuntimeFromJsDelivr","CreateDuckDbRuntimeOptions","differenceDatasetWithDuckDb","disjointAttributeDatasetWithDuckDb","disjointDatasetWithDuckDb","distanceDatasetWithDuckDb","distanceWithinAttributeDatasetWithDuckDb","distanceWithinDatasetWithDuckDb","DUCKDB_ATTRIBUTE_OPERATION_SPECS","DUCKDB_UNARY_GEOMETRY_OPERATION_SPECS","duckDbAttributeLayer","DuckDbAttributeLayerOptions","DuckDbAttributeLayerResult","DuckDbAttributeOperationId","DuckDbAttributeOperationOptions","DuckDbAttributeOperationSpec","DuckDbAttributeOptions","duckDbBufferLayer","DuckDbBufferLayerOptions","DuckDbBufferLayerResult","DuckDbBufferOptions","DuckDbConnection","duckDbGeometryLayer","DuckDbGeometryLayerOptions","DuckDbGeometryLayerResult","DuckDbGeometryOperationSpec","duckDbGeoParquetQueryLayer","DuckDbGeoParquetQueryLayerOptions","DuckDbGeoParquetQueryLayerResult","DuckDbGeoParquetQueryOptions","DuckDbGeoParquetQuerySource","DuckDbMapOpContext","DuckDbMapOpSource","DuckDbNamedRelationOperationSpec","DuckDbOperationError","DuckDbOperationErrorKind","DuckDbOverlayHelperOptions","duckDbOverlayLayer","DuckDbOverlayLayerOptions","DuckDbOverlayLayerResult","DuckDbOverlayOperationId","DuckDbOverlayOperationSpec","DuckDbOverlayOptions","duckDbQueryLayer","DuckDbQueryLayerOptions","DuckDbQueryLayerResult","DuckDbQueryOptions","DuckDbRelationAttributeDistanceOperationSpec","DuckDbRelationAttributeDistanceWithinOperationSpec","DuckDbRelationAttributePredicateOperationSpec","DuckDbRelationFilterDistanceWithinOperationSpec","DuckDbRelationFilterPredicateOperationSpec","DuckDbRelationHelperOptions","duckDbRelationLayer","DuckDbRelationLayerOptions","DuckDbRelationLayerResult","DuckDbRelationMode","DuckDbRelationOperationId","DuckDbRelationOperationSpec","DuckDbRelationOptions","DuckDbRelationOutputKind","DuckDbRuntime","DuckDbSimplifyOptions","DuckDbUnaryGeometryOperationId","DuckDbUnaryGeometryOptions","DuckDbWasmModule","Emap","envelopeDatasetWithDuckDb","geometryTypeDatasetWithDuckDb","getDuckDbAttributeOperationSpec","getDuckDbOverlayOperationSpec","getDuckDbRelationOperationSpec","getDuckDbRuntime","getDuckDbUnaryGeometryOperationSpec","intersectionDatasetWithDuckDb","intersectsAttributeDatasetWithDuckDb","intersectsDatasetWithDuckDb","isEmptyDatasetWithDuckDb","isSimpleDatasetWithDuckDb","isValidDatasetWithDuckDb","lengthDatasetWithDuckDb","makeValidDatasetWithDuckDb","normalizeDuckDbBufferOptions","perimeterDatasetWithDuckDb","processAttributeWithDuckDb","processGeometryWithDuckDb","processOverlayWithDuckDb","processRelationWithDuckDb","queryDatasetWithDuckDb","queryGeoParquetWithDuckDb","resolveAttributeOutputColumn","resolveRelationOutputColumn","runRelationOperation","setDuckDbRuntime","simplifyDatasetWithDuckDb","simplifyPreserveTopologyDatasetWithDuckDb","touchesAttributeDatasetWithDuckDb","touchesDatasetWithDuckDb","ValidatedDuckDbSelectSql","ValidatedDuckDbSelectSqlWithoutRowId","ValidatedDuckDbSelectSqlWithRowId","validateDuckDbSelectSql","ValidateDuckDbSelectSqlOptions","withinAttributeDatasetWithDuckDb","withinDatasetWithDuckDb","xDatasetWithDuckDb","yDatasetWithDuckDb"]
examples: ["duckdb-buffer","duckdb-geoparquet-query","duckdb-overlay","duckdb-query","duckdb-spatial-ops"]
stability: stable
verifiedVersion: 0.5.0
---

# DuckDB

The optional DuckDB entry runs SQL and spatial operations in DuckDB-Wasm. Load it lazily so core maps do not pay the optional dependency cost.

## Behavior notes

Helpers validate restricted SELECT SQL, normalize operation options, preserve CRS metadata when possible, and return operation-layer results for map display.

## API

- [src_duckdb.queryDatasetWithDuckDb](/emap/api/functions/src_duckdb.queryDatasetWithDuckDb.html)
- [src_duckdb.bufferDatasetWithDuckDb](/emap/api/functions/src_duckdb.bufferDatasetWithDuckDb.html)
- [src_duckdb.DuckDbOperationError](/emap/api/classes/src_duckdb.DuckDbOperationError.html)

## Runnable examples

- [duckdb-query](/emap/examples/duckdb-query/)
- [duckdb-buffer](/emap/examples/duckdb-buffer/)
- [duckdb-spatial-ops](/emap/examples/duckdb-spatial-ops/)

## Minimal snippet

```ts
const duckdb = await import("@zwishing/emap/duckdb")
const result = await duckdb.queryDatasetWithDuckDb({ runtime, source, sql })
```
