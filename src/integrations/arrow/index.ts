/** @module arrow */
/**
 * `@mapseekai/emap/arrow` — optional GeoParquet / GeoArrow support.
 *
 * Mount `arrowFormatsPlugin` or call `registerArrowFormats(formats)`
 * explicitly, after which:
 *   - `TopologySource.setData` accepts `.parquet` / `.geoparquet` /
 *     `.arrow` / `.arrows` / `.feather` files, and
 *   - `TopologySource.export` accepts `format: 'geoparquet' | 'geoarrow'`.
 *
 * All converters are also exported directly for file-less workflows —
 * `fromArrowTable` / `toArrowTable` are the duckdb-wasm bridge (query
 * results and `insertArrowTable` inputs are in-memory Arrow tables).
 *
 * Kept as a separate bundle so apps that don't need these formats don't
 * pay for apache-arrow; parquet-wasm (~1.2 MB wasm) loads lazily on first
 * GeoParquet use.
 */
import type { Table } from 'apache-arrow';
import {
  asMutableTopologySource,
  type ReplaceableTopologySource,
  type TopologySource,
} from '../../domain/source/source';
import { fromArrowTable, type FromArrowTableOptions } from './table-to-dataset';
import { toArrowTable, type ToArrowTableOptions } from './dataset-to-table';
import { exportGeoArrow, importGeoArrow } from './geoarrow-io';
import { exportGeoParquet, importGeoParquet } from './geoparquet-io';

export { fromArrowTable, toArrowTable, importGeoArrow, exportGeoArrow };
export type { FromArrowTableOptions, ToArrowTableOptions };
export type { ImportGeoArrowOptions, ExportGeoArrowOptions } from './geoarrow-io';
export { importGeoParquet, exportGeoParquet };
export type { ImportGeoParquetOptions, ExportGeoParquetOptions } from './geoparquet-io';
export { setParquetWasm, initParquetWasm } from './parquet-wasm-loader';
export type {
  ParquetWasmModule,
  ParquetWasmTable,
  InitParquetWasmOptions,
} from './parquet-wasm-loader';
export { decodeWkb, WkbWriter } from './wkb';
export type { WkbGeometry } from './wkb';
export {
  parseGeoMetadata,
  buildGeoMetadata,
  projjsonToCrsString,
  crsStringToProjjson,
} from './geoparquet-metadata';
export type { GeoMetadata, GeoColumnMetadata, GeoEncoding } from './geoparquet-metadata';
export { detectGeometryColumn } from './geometry-column';
export type { GeometryColumnInfo } from './geometry-column';

interface DetachedMutableSource extends TopologySource {
  setDataset(dataset: ReturnType<typeof fromArrowTable>): void;
}

function isReplaceableTopologySource(source: TopologySource): source is ReplaceableTopologySource {
  const candidate = source as unknown as Partial<ReplaceableTopologySource>;
  return typeof candidate.replaceDataset === 'function';
}

function isDetachedMutableSource(source: TopologySource): source is DetachedMutableSource {
  const candidate = source as unknown as Partial<DetachedMutableSource>;
  return typeof candidate.setDataset === 'function';
}

/**
 * Replace `source`'s dataset with the contents of an in-memory Arrow table
 * (e.g. a duckdb-wasm query result). Fires the source's `data` event so an
 * attached map re-renders. Resolves after map-owned CRS normalization and
 * final commit validation complete.
 */
export async function setArrowTable(
  source: TopologySource,
  table: Table,
  opts?: FromArrowTableOptions,
): Promise<void> {
  const dataset = fromArrowTable(table, opts);
  if (isReplaceableTopologySource(source)) {
    await source.replaceDataset(dataset);
    return;
  }
  if (isDetachedMutableSource(source)) {
    source.setDataset(dataset);
    return;
  }
  throw new TypeError('setArrowTable requires a mutable TopologySource');
}

/** Convert `source`'s current dataset to an in-memory Arrow table. */
export function toArrowTableFromSource(source: TopologySource, opts?: ToArrowTableOptions): Table {
  const dataset = asMutableTopologySource(source).getDataset();
  if (!dataset) throw new Error('TopologySource has no dataset');
  return toArrowTable(dataset, opts);
}

export { registerArrowFormats } from './formats';
export { arrowFormatsPlugin } from './plugin';
