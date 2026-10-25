import { tableFromIPC, tableToIPC, type Data, type Table } from 'apache-arrow';
import { resolveDatasetCRSMetadata } from '../../domain/geo/crs-resolver';
import type { MapshaperDataset, MapshaperLayer } from '../../shared/types/mapshaper-types';
import type { ToArrowTableOptions } from './dataset-to-table';
import { detectGeometryColumn } from './geometry-column';
import {
  ARROW_EXTENSION_NAME,
  ARROW_EXTENSION_METADATA,
  extensionNameFromEncoding,
  parseGeoMetadata,
} from './geoparquet-metadata';

interface Entry {
  layer: MapshaperLayer;
  stamp: unknown[];
  key?: string;
  table: Table;
  bytes: number;
  geometryColumn?: string;
}

// Weak dataset ownership; at most two recent representations and 64 MiB per dataset.
// Large tables still convert correctly, without retaining another full representation.
const tables = new WeakMap<MapshaperDataset, Entry[]>();
const MAX_BYTES = 64 * 1024 * 1024;

function stamp(dataset: MapshaperDataset, layer: MapshaperLayer): unknown[] {
  return [
    dataset.editVersion,
    dataset.attributeVersion,
    dataset.arcs,
    layer.shapes,
    layer.shapes?.length,
    layer.data,
    layer.data?.getRecords?.(),
    layer.geometry_type,
    resolveDatasetCRSMetadata(dataset),
  ];
}

function freshEntries(dataset: MapshaperDataset): Entry[] {
  const entries = (tables.get(dataset) ?? []).filter(
    (entry) =>
      dataset.layers.includes(entry.layer) &&
      stamp(dataset, entry.layer).every((value, index) => value === entry.stamp[index]),
  );
  tables.set(dataset, entries);
  return entries;
}

function touch(entries: Entry[], entry: Entry): Table {
  entries.splice(entries.indexOf(entry), 1);
  entries.push(entry);
  return entry.table;
}

export function getCachedArrowTable(
  dataset: MapshaperDataset,
  layer: MapshaperLayer,
  key: string,
): Table | undefined {
  const entries = freshEntries(dataset);
  const entry = entries.find((entry) => entry.layer === layer && entry.key === key);
  return entry && touch(entries, entry);
}

function retainedBytes(table: Table): number {
  const buffers = new Set<ArrayBufferLike>();
  const visit = (data: Data): void => {
    for (const buffer of Object.values(data.buffers)) {
      if (ArrayBuffer.isView(buffer)) buffers.add(buffer.buffer);
    }
    for (const child of data.children) visit(child);
    for (const dictionaryData of data.dictionary?.data ?? []) visit(dictionaryData as Data);
  };
  for (const batch of table.batches) visit(batch.data);
  return [...buffers].reduce((total, buffer) => total + buffer.byteLength, 0);
}

export function cacheArrowTable(
  dataset: MapshaperDataset,
  layer: MapshaperLayer,
  key: string | undefined,
  table: Table,
  geometryColumn?: string,
): void {
  const bytes = retainedBytes(table);
  if (bytes > MAX_BYTES) return;
  const entries = freshEntries(dataset).filter(
    (entry) => entry.layer !== layer || entry.key !== key,
  );
  entries.push({ layer, stamp: stamp(dataset, layer), key, table, bytes, geometryColumn });
  while (entries.length > 2 || entries.reduce((sum, entry) => sum + entry.bytes, 0) > MAX_BYTES)
    entries.shift();
  tables.set(dataset, entries);
}

/** Called only after a lossless, single-layer import. */
export function seedArrowTable(
  dataset: MapshaperDataset,
  table: Table,
  geometryColumn?: string,
): void {
  if (dataset.layers.length !== 1 || dataset.layers[0].shapes?.length !== table.numRows) return;
  if (retainedBytes(table) > MAX_BYTES) return;
  // Public Arrow tables and IPC input bytes are mutable; retain independent buffers.
  const owned = tableFromIPC(tableToIPC(table, 'stream'));
  cacheArrowTable(dataset, dataset.layers[0], undefined, owned, geometryColumn);
}

/** CRS inheritance changes metadata only; never refresh seeds after geometry/attribute edits. */
export function refreshSeededArrowCrs(dataset: MapshaperDataset): void {
  for (const entry of tables.get(dataset) ?? []) {
    const current = stamp(dataset, entry.layer);
    if (
      entry.key === undefined &&
      current.slice(0, -1).every((value, index) => value === entry.stamp[index])
    ) {
      entry.stamp = current;
    }
  }
}

export function getSeededArrowTable(
  dataset: MapshaperDataset,
  layer: MapshaperLayer,
  opts: ToArrowTableOptions,
  crs?: unknown,
  purpose: 'input' | 'geoarrow' | 'geoparquet' = 'geoarrow',
): Table | undefined {
  const entries = freshEntries(dataset);
  const entry = entries.find((entry) => entry.layer === layer && entry.key === undefined);
  if (!entry || opts.reprojectToWgs84) return;
  const table = entry.table;
  const geom = detectGeometryColumn(table, entry.geometryColumn);
  const name = opts.geometryColumn || 'geometry';
  if (!geom || geom.name !== name || (geom.encoding === 'WKB') !== (opts.encoding === 'wkb'))
    return;
  const geo = parseGeoMetadata(table.schema.metadata);
  const column = geo?.columns[name];
  const bbox = column?.covering?.bbox;
  // A covering column is not an attribute: omitting or renaming it requires conversion.
  if (
    opts.bboxColumn
      ? !bbox ||
        (['xmin', 'ymin', 'xmax', 'ymax'] as const).some((axis) => {
          const path = bbox[axis];
          return (
            !Array.isArray(path) ||
            path.length !== 2 ||
            path[0] !== opts.bboxColumn ||
            path[1] !== axis
          );
        })
      : bbox
  )
    return;
  if (purpose !== 'input') {
    if (
      !column ||
      geo?.primary_column !== name ||
      JSON.stringify(column.crs) !== JSON.stringify(crs)
    )
      return;
    if (purpose === 'geoarrow') {
      const metadata = table.schema.fields[geom.fieldIndex].metadata;
      if (
        metadata.get(ARROW_EXTENSION_NAME) !== extensionNameFromEncoding(geom.encoding) ||
        metadata.get(ARROW_EXTENSION_METADATA) !==
          (crs === undefined ? undefined : JSON.stringify({ crs }))
      )
        return;
    }
  }
  return touch(entries, entry);
}
