import { slicePathMembers } from './path-members';
import { spatialStrokeGeometry } from './stroke-ranges';
import {
  compactStrokeParts,
  COMPACT_STROKE_STRIDE,
  COMPACT_STROKE_XY_STRIDE,
} from './compact-stroke';
import { compactFillStorage } from './fill-storage';
import { buildFillRanges, spatialFillGeometry } from './fill-ranges';
import type { FeatureGeometryCache } from './feature-geometry-cache';
import { lineGeometry, type Point } from './geometry';
import { flatPolygonGeometry, flatSingleRingIndices } from './flat-polygon';
import { flatPathGeometry, flatPointGeometry, flatScreenPathGeometry } from './flat-path';
import { PATH_STRIDE } from './path-geometry';
import { buildScreenPaths, type ScreenPathStats } from './screen-paths';
import { MAX_GEOMETRY_JOB_VERTICES, type GeometryPacket } from './geometry-jobs';
import type { ArcVertexData } from '../../../shared/types/mapshaper-types';
import type { GeometryBuffer } from '../../../integrations/luma/types';

export interface GeometryResult {
  uploadCulledBytes?: number;
  pathInputInstances?: number;
  pathOutputInstances?: number;
  directFeatures?: number;
  geometries: GeometryBuffer[];
  screenSpace: boolean;
  screenStats?: ScreenPathStats;
}
const MAX_VERTICES = 65536;
/** Split allocations, not shapes or topology. Adjacent path chunks retain all
 * three neighbor records, and indexed fills remap complete triangles without clipping.
 */
export function splitGeometry(geometry: GeometryBuffer): GeometryBuffer[] {
  return [...geometryMeshes(geometry)];
}
/** Yield split fills so upload-storage clipping can discard each temporary mesh
 * immediately. Non-indexed results share one exact derived backing allocation;
 * this is never a source coordinate array or a feature-cache-owned buffer. */
function* geometryMeshes(geometry: GeometryBuffer): Generator<GeometryBuffer> {
  if (!geometry.count) return;
  if (geometry.kind !== 'fill') {
    const stride = geometry.compactStroke
      ? geometry.compactStrokeXY
        ? COMPACT_STROKE_XY_STRIDE
        : COMPACT_STROKE_STRIDE
      : geometry.kind === 'path'
        ? PATH_STRIDE
        : geometry.kind === 'point'
          ? 4
          : 10;
    const limit = geometry.compactStroke ? 28672 : MAX_VERTICES;
    const length =
      (geometry.count + (geometry.kind === 'path' && !geometry.compactStroke ? 3 : 0)) * stride;
    const input = geometry.vertices;
    // A view must not keep an oversized staging/source allocation alive across
    // transfer. Copy once only when the complete derived backing is not exact.
    const vertices =
      input.byteOffset === 0 && input.buffer.byteLength === length * 4
        ? input
        : input.slice(0, length);
    for (let first = 0; first < geometry.count; first += limit) {
      const count = Math.min(limit, geometry.count - first);
      yield {
        kind: geometry.kind,
        ...(geometry.compactStroke
          ? { compactStroke: true, compactStrokeXY: geometry.compactStrokeXY }
          : {}),
        count,
        ...(geometry.memberRanges
          ? { memberRanges: slicePathMembers(geometry.memberRanges, first, count) }
          : {}),
        vertices: vertices.subarray(
          first * stride,
          (first + count + (geometry.kind === 'path' && !geometry.compactStroke ? 3 : 0)) * stride,
        ),
        ...(geometry.pathRanges && first % geometry.pathRanges.blockSize === 0
          ? {
              pathRanges: {
                blockSize: geometry.pathRanges.blockSize,
                bounds: geometry.pathRanges.bounds.slice(
                  (first / geometry.pathRanges.blockSize) * 4,
                  Math.ceil((first + count) / geometry.pathRanges.blockSize) * 4,
                ),
                ...(geometry.pathRanges.envelopeHalfWidths
                  ? {
                      envelopeHalfWidths: geometry.pathRanges.envelopeHalfWidths,
                      uncullable: geometry.pathRanges.uncullable?.slice(
                        first / geometry.pathRanges.blockSize,
                        Math.ceil((first + count) / geometry.pathRanges.blockSize),
                      ),
                    }
                  : {}),
                segments: geometry.pathRanges.segments.slice(
                  first / geometry.pathRanges.blockSize,
                  Math.ceil((first + count) / geometry.pathRanges.blockSize),
                ),
              },
            }
          : {}),
      };
    }
    return;
  }
  geometry = spatialFillGeometry(geometry);
  const source = geometry.indices!;
  // Typed remapping avoids one Map entry and boxed coordinate array per vertex.
  const seen = new Uint32Array(geometry.vertices.length / 4),
    remap = new Uint32Array(seen.length);
  let generation = 0;
  for (let first = 0; first < source.length; ) {
    const end = Math.min(source.length, first + Math.floor(MAX_VERTICES / 3) * 3);
    const indices = new Uint16Array(end - first),
      storage = new Float32Array(Math.min(end - first, seen.length) * 4);
    let n = 0,
      k = 0;
    generation++;
    for (; first < end; first++) {
      const id = source[first];
      if (seen[id] !== generation) {
        seen[id] = generation;
        remap[id] = n;
        const from = id * 4,
          to = n++ * 4;
        storage[to] = geometry.vertices[from];
        storage[to + 1] = geometry.vertices[from + 1];
        storage[to + 2] = geometry.vertices[from + 2];
        storage[to + 3] = geometry.vertices[from + 3];
      }
      indices[k++] = remap[id];
    }
    const mesh: GeometryBuffer = {
      kind: 'fill',
      vertices: n * 4 === storage.length ? storage : storage.slice(0, n * 4),
      indices,
      count: indices.length,
    };
    mesh.fillRanges = buildFillRanges(mesh);
    yield mesh;
  }
}
export function buildGeometryPacket(
  packet: GeometryPacket,
  cache?: FeatureGeometryCache,
): GeometryResult {
  const { coordinates, offsets, features } = packet;
  if (
    packet.storageBounds !== undefined &&
    (!Array.isArray(packet.storageBounds) ||
      packet.storageBounds.length !== 4 ||
      !packet.storageBounds.every(Number.isFinite) ||
      packet.storageBounds[0] >= packet.storageBounds[2] ||
      packet.storageBounds[1] >= packet.storageBounds[3] ||
      packet.kind !== 'fill')
  )
    throw new Error('Invalid fill upload bounds');
  if (
    !(coordinates instanceof Float64Array) ||
    !(offsets instanceof Uint32Array) ||
    !(features instanceof Uint32Array) ||
    coordinates.length % 2 ||
    coordinates.length / 2 > MAX_GEOMETRY_JOB_VERTICES ||
    offsets.length > MAX_GEOMETRY_JOB_VERTICES + 1 ||
    features.length > MAX_GEOMETRY_JOB_VERTICES + 1 ||
    !offsets.length ||
    !features.length ||
    offsets[0] !== 0 ||
    offsets[offsets.length - 1] * 2 !== coordinates.length ||
    features[0] !== 0 ||
    features[features.length - 1] !== offsets.length - 1 ||
    (packet.featureIds !== undefined &&
      (!(packet.featureIds instanceof Int32Array) ||
        packet.featureIds.length !== features.length - 1 ||
        packet.featureIds.some((id) => id < 0)))
  )
    throw new Error('Invalid bounded geometry packet');
  for (let i = 1; i < offsets.length; i++)
    if (offsets[i] < offsets[i - 1] || offsets[i] * 2 > coordinates.length)
      throw new Error('Invalid geometry path offsets');
  for (let i = 1; i < features.length; i++)
    if (features[i] < features[i - 1] || features[i] >= offsets.length)
      throw new Error('Invalid geometry feature offsets');
  for (const value of coordinates)
    if (!Number.isFinite(value)) throw new Error('Non-finite geometry coordinate');
  // Materialize only for legacy path/arrow fallback. Successful screen paths and
  // every polygon use the original binary packet directly.
  const readPaths = (): Point[][] => {
    const paths: Point[][] = [];
    for (let i = 0; i < offsets.length - 1; i++) {
      const path: Point[] = [];
      for (let j = offsets[i]; j < offsets[i + 1]; j++)
        path.push([coordinates[j * 2], coordinates[j * 2 + 1]]);
      paths.push(path);
    }
    return paths;
  };
  let directFeatures = 0;
  let geometry: GeometryBuffer;
  let screenSpace = false,
    screenStats: ScreenPathStats | undefined;
  if (packet.kind === 'path') {
    if (
      packet.screen &&
      !packet.screen.perspective &&
      !packet.screen.smallArcs &&
      !packet.screen.cull
    ) {
      const prepared = flatScreenPathGeometry(coordinates, offsets, packet.screen, true);
      geometry = prepared.geometry;
      screenSpace = prepared.screenSpace;
      screenStats = prepared.screenStats;
    } else if (packet.screen) {
      const count = offsets.length - 1,
        xx = new Float64Array(coordinates.length / 2),
        yy = new Float64Array(xx.length),
        nn = new Uint32Array(count);
      for (let i = 0; i < xx.length; i++) {
        xx[i] = coordinates[i * 2];
        yy[i] = coordinates[i * 2 + 1];
      }
      for (let i = 0; i < count; i++) nn[i] = offsets[i + 1] - offsets[i];
      const data = { xx, yy, nn, ii: offsets.subarray(0, count) } as ArcVertexData;
      const filtered = buildScreenPaths(
        data,
        Uint32Array.from({ length: count }, (_, i) => i),
        packet.screen,
      );
      screenStats = filtered.stats;
      screenSpace = !filtered.fallback;
      geometry = screenSpace ? filtered.geometry : flatPathGeometry(coordinates, offsets, true);
    } else geometry = flatPathGeometry(coordinates, offsets, true);
  } else if (packet.kind === 'arrow') geometry = lineGeometry(readPaths());
  else if (packet.kind === 'point') geometry = flatPointGeometry(coordinates);
  else if (packet.kind === 'fill') {
    // Cache complete feature triangulations, not only connectivity of an entire
    // viewport batch. Rings/nested islands are classified once per exact feature.
    const parts: (GeometryBuffer | { coordinates: Float64Array; indices: number[] })[] = [];
    let vertexCount = 0,
      indexCount = 0;
    for (let i = 0; i < features.length - 1; i++) {
      const a = features[i],
        b = features[i + 1],
        start = offsets[a];
      // Reject only an entire feature whose coordinates are certainly outside
      // the conservative upload coverage. Offscreen shells enclosing the view
      // are not rejected and all their holes remain in the tessellation.
      if (packet.storageBounds) {
        let x0 = Infinity,
          y0 = Infinity,
          x1 = -Infinity,
          y1 = -Infinity;
        for (let j = start * 2; j < offsets[b] * 2; j += 2) {
          x0 = Math.min(x0, coordinates[j]);
          x1 = Math.max(x1, coordinates[j]);
          y0 = Math.min(y0, coordinates[j + 1]);
          y1 = Math.max(y1, coordinates[j + 1]);
        }
        const v = packet.storageBounds;
        if (x1 < v[0] || y1 < v[1] || x0 > v[2] || y0 > v[3]) continue;
      }
      // Do not fill a 20k-entry cache with millions of cheap single-ring meshes.
      // Keep the indexed binary batch and pack hi/lo positions only once below.
      if (features.length > 129 && b === a + 1 && offsets[b] - start <= 16) {
        const xy = coordinates.subarray(start * 2, offsets[b] * 2),
          indices = flatSingleRingIndices(xy);
        directFeatures++;
        if (indices?.length) {
          parts.push({ coordinates: xy, indices });
          vertexCount += xy.length * 2;
          indexCount += indices.length;
        }
        continue;
      }
      const build = () => flatPolygonGeometry(coordinates, offsets, a, b);
      const ringOffsets = offsets.slice(a, b + 1);
      for (let j = 0; j < ringOffsets.length; j++) ringOffsets[j] -= start;
      const part =
        cache && packet.sourceId !== undefined && packet.cacheKey !== undefined && packet.featureIds
          ? cache.get(
              packet.sourceId,
              packet.cacheKey,
              packet.featureIds[i],
              coordinates.subarray(start * 2, offsets[b] * 2),
              ringOffsets,
              build,
            )
          : build();
      if (!part.count) continue;
      parts.push(part);
      vertexCount += part.vertices.length;
      indexCount += part.indices!.length;
    }
    const vertices = new Float32Array(vertexCount),
      indices = new Uint32Array(indexCount);
    let v = 0,
      index = 0;
    for (const part of parts) {
      const base = v / 4;
      if ('coordinates' in part) {
        for (let j = 0; j < part.coordinates.length; j += 2) {
          const x = part.coordinates[j],
            y = part.coordinates[j + 1],
            hx = Math.fround(x),
            hy = Math.fround(y);
          vertices[v++] = hx;
          vertices[v++] = hy;
          vertices[v++] = x - hx;
          vertices[v++] = y - hy;
        }
      } else {
        vertices.set(part.vertices, v);
        v += part.vertices.length;
      }
      for (const id of part.indices!) indices[index++] = base + id;
    }
    geometry = { kind: 'fill', vertices, indices, count: indices.length };
  } else throw new Error('Unsupported geometry packet kind');
  const pathInputInstances = packet.kind === 'path' ? geometry.count : 0;
  const prepared = packet.compactStroke && screenSpace ? compactStrokeParts(geometry) : [geometry];
  const pathOutputInstances =
    packet.kind === 'path' ? prepared.reduce((n, g) => n + g.count, 0) : 0;
  const geometries: GeometryBuffer[] = [];
  let uploadCulledBytes = 0;
  for (const preparedGeometry of prepared) {
    const spatial = spatialStrokeGeometry(preparedGeometry, !!packet.compactStroke && screenSpace);
    for (const mesh of geometryMeshes(spatial)) {
      const clipped = packet.storageBounds ? compactFillStorage(mesh, packet.storageBounds) : mesh;
      if (clipped) geometries.push(clipped);
      if (packet.storageBounds)
        uploadCulledBytes +=
          mesh.vertices.byteLength +
          (mesh.indices?.byteLength ?? 0) -
          (clipped ? clipped.vertices.byteLength + (clipped.indices?.byteLength ?? 0) : 0);
    }
  }
  return {
    geometries,
    pathInputInstances,
    pathOutputInstances,
    directFeatures,
    uploadCulledBytes,
    screenSpace,
    ...(screenStats ? { screenStats } : {}),
  };
}
