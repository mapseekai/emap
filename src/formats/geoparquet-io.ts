import { tableFromIPC, tableToIPC } from 'apache-arrow';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { fromArrowTable, type FromArrowTableOptions } from './table-to-dataset';
import { toArrowTable, type ToArrowTableOptions } from './dataset-to-table';
import { initParquetWasm, type InitParquetWasmOptions } from './parquet-wasm-loader';

export interface ImportGeoParquetOptions extends FromArrowTableOptions, InitParquetWasmOptions {}

export interface ExportGeoParquetOptions
  extends Omit<ToArrowTableOptions, 'encoding'>,
    InitParquetWasmOptions {
  /** Geometry encoding; GeoParquet defaults to WKB for maximum interop. */
  encoding?: 'wkb' | 'native';
  /** Parquet page compression; default snappy. */
  compression?: 'snappy' | 'gzip' | 'zstd' | 'none';
}

/**
 * Read a GeoParquet file into a mapshaper dataset. The parquet container is
 * decoded by parquet-wasm into Arrow (file-level `geo` key/value metadata
 * surfaces as Arrow schema metadata), then converted directly — no GeoJSON.
 */
export async function importGeoParquet(
  data: Uint8Array | ArrayBuffer,
  opts: ImportGeoParquetOptions = {},
): Promise<MapshaperDataset> {
  const wasm = await initParquetWasm(opts);
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  const wasmTable = wasm.readParquet(bytes);
  const table = tableFromIPC(wasmTable.intoIPCStream());
  return fromArrowTable(table, opts);
}

/**
 * Serialize one dataset layer to GeoParquet bytes (spec 1.1, `geo` file
 * metadata included; WKB geometry encoding by default).
 */
export async function exportGeoParquet(
  dataset: MapshaperDataset,
  opts: ExportGeoParquetOptions = {},
): Promise<Uint8Array> {
  const wasm = await initParquetWasm(opts);
  const table = toArrowTable(dataset, { ...opts, encoding: opts.encoding ?? 'wkb' });
  const wasmTable = wasm.Table.fromIPCStream(tableToIPC(table, 'stream'));

  const compressionName = (opts.compression ?? 'snappy').toUpperCase();
  const compression =
    compressionName === 'NONE'
      ? wasm.Compression.UNCOMPRESSED
      : wasm.Compression[compressionName as keyof typeof wasm.Compression];
  if (compression === undefined) {
    throw new Error(`Unsupported parquet compression: ${opts.compression}`);
  }
  const properties = new wasm.WriterPropertiesBuilder().setCompression(compression).build();
  return wasm.writeParquet(wasmTable, properties);
}
