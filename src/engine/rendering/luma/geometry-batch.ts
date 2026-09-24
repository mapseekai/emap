import { normalizePointShape } from '../../../domain/source/layer-utils';
import { absArcId, type PathShape } from '../../../shared/types/mapshaper-types';
import type { GeometryInput, GeometryJob, GeometryPacket } from './geometry-jobs';
import type { GeometryResult } from './geometry-packet';

export const GEOMETRY_BATCH_JOBS = 8;
export const GEOMETRY_BATCH_BYTES = 2 * 1024 ** 2;
export type GeometryBatchItem =
  | { result: GeometryResult; error?: never }
  | { error: string; result?: never };

/** Count transferred allocations, not only views into potentially larger buffers. */
export function geometryBatchBytes(packets: readonly GeometryPacket[]): number {
  const buffers = new Set<ArrayBufferLike>();
  for (const p of packets)
    for (const a of [p.coordinates, p.offsets, p.features, p.featureIds])
      if (a) buffers.add(a.buffer);
  let bytes = 0;
  for (const buffer of buffers) bytes += buffer.byteLength;
  return bytes;
}
export function validateGeometryBatch(packets: readonly GeometryPacket[]): void {
  if (!Array.isArray(packets) || !packets.length || packets.length > GEOMETRY_BATCH_JOBS)
    throw new RangeError('Invalid geometry batch length');
  if (packets.length > 1 && geometryBatchBytes(packets) > GEOMETRY_BATCH_BYTES)
    throw new RangeError('Geometry batch exceeds its transferable byte limit');
}

/** Cheap conservative admission before allocating a second packet. Unfiltered
 * arc lengths bound retained/deduplicated output. Unknown custom iterators stay
 * single-job; no coordinates or topology are copied to estimate their cost. */
export function geometryJobByteBound(
  input: GeometryInput,
  job: GeometryJob,
  limit: number,
): number {
  let bytes =
    (job.members.length + 1) * 4 + 4 + (input.kind === 'fill' ? job.members.length * 4 : 0);
  if (bytes > limit) return Infinity;
  const data = input.arcs?.getVertexData?.();
  if (input.kind !== 'point' && !data) return Infinity;
  for (let k = 0; k < job.members.length; k++) {
    const id = job.members[k];
    if (input.kind === 'point') {
      const shape = input.shapes![id];
      const count = shape ? normalizePointShape(shape).length : 0;
      const component = job.components?.[k];
      bytes +=
        4 + 16 * (component === undefined || component === 0xffffffff ? count : Math.min(count, 1));
    } else if (input.kind === 'path') bytes += 4 + 16 * data!.nn[absArcId(id)];
    else
      for (const part of (input.shapes![id] ?? []) as PathShape) {
        bytes += 4;
        for (const arc of part) {
          bytes += 16 * data!.nn[absArcId(arc)];
          if (bytes > limit) return Infinity;
        }
      }
    if (!Number.isFinite(bytes) || bytes > limit) return Infinity;
  }
  return bytes;
}
