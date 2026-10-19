import { Field, RecordBatch, Schema, Table, tableFromIPC, tableToIPC } from 'apache-arrow';
import type { MapshaperDataset } from '../../shared/types/mapshaper-types';
import { resolveDatasetCRSMetadata } from '../../domain/geo/crs-resolver';
import { fromArrowTable, type FromArrowTableOptions } from './table-to-dataset';
import { toArrowTable, type ToArrowTableOptions } from './dataset-to-table';
import { initParquetWasm, type InitParquetWasmOptions } from './parquet-wasm-loader';
import { findAuthorityProjjsonAsync, type EpsgProjjsonFetchOptions } from './epsg-projjson';
import {
  ARROW_EXTENSION_METADATA,
  ARROW_EXTENSION_NAME,
  crsStringToProjjsonAsync,
} from './geoparquet-metadata';

export interface ImportGeoParquetOptions extends FromArrowTableOptions, InitParquetWasmOptions {}

export interface ExportGeoParquetOptions
  extends Omit<ToArrowTableOptions, 'encoding'>,
    InitParquetWasmOptions,
    EpsgProjjsonFetchOptions {
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
 * Drop GeoArrow `ARROW:extension:*` field metadata before writing the
 * parquet container. GDAL ≥ 3.11 (libarrow ≥ 21) registers `geoarrow.wkb`
 * as an Arrow extension type and then requires the parquet column to carry
 * the native GEOMETRY/GEOGRAPHY logical type — which parquet-wasm cannot
 * write — so the column loses its geometry/CRS association entirely. The
 * GeoParquet `geo` file metadata alone identifies the geometry column;
 * Arrow IPC exports (geoarrow-io) keep the extension metadata.
 */
function stripFieldExtensionMetadata(table: Table): Table {
  if (!table.schema.fields.some((f) => f.metadata.has(ARROW_EXTENSION_NAME))) return table;
  const fields = table.schema.fields.map((f) => {
    if (!f.metadata.has(ARROW_EXTENSION_NAME)) return f;
    const metadata = new Map(
      [...f.metadata].filter(([k]) => k !== ARROW_EXTENSION_NAME && k !== ARROW_EXTENSION_METADATA),
    );
    return new Field(f.name, f.type, f.nullable, metadata);
  });
  const schema = new Schema(fields, table.schema.metadata);
  return new Table(
    schema,
    table.batches.map((batch) => new RecordBatch(schema, batch.data)),
  );
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
  const sourceCrsString = resolveDatasetCRSMetadata(dataset);
  const reprojectToWgs84 = opts.reprojectToWgs84 ?? false;
  const projjsonCrs =
    reprojectToWgs84 && isWebMercatorCrs(sourceCrsString)
      ? undefined
      : await crsStringToProjjsonAsync(
          sourceCrsString,
          async (authority, code) => {
            const explicit = opts.crsProjjsonLookup?.(authority, code);
            if (explicit !== undefined) return explicit;
            return findAuthorityProjjsonAsync(authority, code, {
              baseUrl: opts.baseUrl,
              fetch: opts.fetch,
            });
          },
          { strict: true },
        );
  const table = stripFieldExtensionMetadata(
    toArrowTable(dataset, {
      ...opts,
      encoding: opts.encoding ?? 'wkb',
      bboxColumn: opts.bboxColumn === undefined ? 'bbox' : opts.bboxColumn,
      reprojectToWgs84,
      projjsonCrs,
    }),
  );
  const wasmTable = wasm.Table.fromIPCStream(tableToIPC(table, 'stream'));

  const compressionName = (opts.compression ?? 'snappy').toUpperCase();
  const compression =
    compressionName === 'NONE'
      ? wasm.Compression.UNCOMPRESSED
      : wasm.Compression[compressionName as keyof typeof wasm.Compression];
  if (compression === undefined) {
    throw new Error(`Unsupported parquet compression: ${opts.compression}`);
  }
  let propertiesBuilder = new wasm.WriterPropertiesBuilder();
  const geoMetadata = table.schema.metadata.get('geo');
  if (geoMetadata) {
    propertiesBuilder = propertiesBuilder.setKeyValueMetadata(
      new Map<string, string>([['geo', geoMetadata]]),
    );
  }

  const properties = propertiesBuilder.setCompression(compression).build();
  return wasm.writeParquet(wasmTable, properties);
}

function isWebMercatorCrs(crsString: string | undefined): boolean {
  return /^EPSG:3857$/i.test(crsString ?? '');
}
