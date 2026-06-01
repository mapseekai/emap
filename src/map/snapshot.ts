import { getDefaultMapshaperAdapter } from '../adapter/mapshaper-adapter';
import type { TopologySource } from '../source/source';
import type { MapshaperDataset } from '../types/mapshaper-types';
import type { ExportSnapshotOptions, LoadSnapshotOptions } from './types';

export interface UnpackedSnapshot {
  datasets: MapshaperDataset[];
  resolvedIds: string[];
}

export async function exportSnapshotFromSources(
  sources: ReadonlyMap<string, TopologySource>,
  opts: ExportSnapshotOptions = {},
): Promise<Blob> {
  const compact = opts.compact !== false;
  const ids: string[] = [];
  const datasets: MapshaperDataset[] = [];
  for (const [id, source] of sources) {
    if (source.type !== 'topology') continue;
    const ds = source.getDataset?.();
    if (!ds) continue;
    ids.push(id);
    datasets.push(ds);
  }

  const adapter = getDefaultMapshaperAdapter();
  const obj = await adapter.exportDatasetsToPack(datasets, { compact });
  obj.emap = {
    version: 1,
    sources: ids.map((id) => ({ id })),
  };
  const bytes = adapter.pack(obj);
  return new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
}

export async function unpackSnapshot(
  input: Blob | Uint8Array | ArrayBuffer,
  opts: LoadSnapshotOptions = {},
): Promise<UnpackedSnapshot> {
  const bytes = await toSnapshotBytes(input);
  if (!looksLikeMsxBytes(bytes)) {
    throw new Error(
      'loadSnapshot: input does not look like a mapshaper .msx snapshot ' +
        '(expected msgpack map marker as the first byte)',
    );
  }

  const obj = await getDefaultMapshaperAdapter().unpackSessionData(bytes);
  const datasets = (obj.datasets ?? []) as MapshaperDataset[];
  const meta = obj.emap as { sources?: Array<{ id?: string }> } | undefined;
  const storedIds =
    meta?.sources?.map((s) => s?.id).filter((s): s is string => typeof s === 'string') ?? [];
  const prefix = opts.idPrefix ?? '';
  const defaults = opts.defaultIds ?? [];
  const resolvedIds = datasets.map((_, i) => {
    const stored = storedIds[i];
    const fallback = defaults[i] ?? `snapshot-${i}`;
    return prefix + (stored ?? fallback);
  });

  return { datasets, resolvedIds };
}

async function toSnapshotBytes(input: Blob | Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return new Uint8Array(await input.arrayBuffer());
  }
  throw new Error('loadSnapshot: input must be Blob, Uint8Array, or ArrayBuffer');
}

/**
 * Cheap pre-validator for `.msx` (mapshaper-pack) bytes. Looks for any
 * msgpack map marker as the first byte; that's the only structural rule
 * `unpackSessionData` requires (the rest of the format is a content map).
 */
function looksLikeMsxBytes(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length === 0) return false;
  const b = bytes[0];
  return (
    (b >= 0x80 && b <= 0x8f) || // fixmap
    b === 0xde || // map16
    b === 0xdf // map32
  );
}
