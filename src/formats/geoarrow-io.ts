import { Table, tableFromIPC, tableToIPC } from 'apache-arrow';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { detectGeometryColumn } from './geometry-column';
import { fromArrowTable, type FromArrowTableOptions } from './table-to-dataset';
import { toArrowTable, type ToArrowTableOptions } from './dataset-to-table';

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
  return importGeoArrowTable(data, opts).dataset;
}

/** Like {@link importGeoArrow}, but also returns the parsed Arrow table
 * and its geometry encoding so callers can retain it (cache seeding). */
export function importGeoArrowTable(
  data: Uint8Array | ArrayBuffer,
  opts: ImportGeoArrowOptions = {},
): { table: Table; dataset: MapshaperDataset; encoding: 'native' | 'wkb' } {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  const table = tableFromIPC(bytes);
  const geom = detectGeometryColumn(table, opts.geometryColumn);
  const dataset = fromArrowTable(table, opts);
  return { table, dataset, encoding: geom?.encoding === 'WKB' ? 'wkb' : 'native' };
}

/** Serialize one dataset layer to a GeoArrow IPC file (Feather V2) buffer. */
export function exportGeoArrow(
  dataset: MapshaperDataset,
  opts: ExportGeoArrowOptions = {},
): Uint8Array {
  const table: Table = toArrowTable(dataset, { ...opts, encoding: opts.encoding ?? 'native' });
  return tableToIPC(table, 'file');
}
