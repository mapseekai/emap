import { Table, tableFromIPC, tableToIPC } from 'apache-arrow';
import type { MapshaperDataset } from '../../shared/types/mapshaper-types';
import { fromArrowTable, type FromArrowTableOptions } from './table-to-dataset';
import { toCachedArrowTable, type ToArrowTableOptions } from './dataset-to-table';

export type ImportGeoArrowOptions = FromArrowTableOptions;

export interface ExportGeoArrowOptions extends Omit<ToArrowTableOptions, 'encoding'> {
  /** Geometry encoding; GeoArrow IPC defaults to native nested arrays. */
  encoding?: 'native' | 'wkb';
}

/**
 * Read a GeoArrow IPC payload (Arrow file or stream framing — `tableFromIPC`
 * accepts both) into a mapshaper dataset.
 */
export function importGeoArrow(
  data: Uint8Array | ArrayBuffer,
  opts: ImportGeoArrowOptions = {},
): MapshaperDataset {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  const table = tableFromIPC(bytes);
  return fromArrowTable(table, opts);
}

/** Serialize one dataset layer to a GeoArrow IPC file (Feather V2) buffer. */
export function exportGeoArrow(
  dataset: MapshaperDataset,
  opts: ExportGeoArrowOptions = {},
): Uint8Array {
  const table: Table = toCachedArrowTable(dataset, {
    ...opts,
    encoding: opts.encoding ?? 'native',
  });
  return tableToIPC(table, 'file');
}
