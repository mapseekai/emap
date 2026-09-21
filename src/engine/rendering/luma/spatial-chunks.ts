import { TriangulationCache } from './triangulation-cache';
import { buildScreenPaths, type ScreenPathRequest, type ScreenPathPacket } from './screen-paths';
import { LumaPointLodSource, type PointLodRequest, type PointLodPacket } from './point-lod-source';
import { applyCoordinatePatch, type CoordinatePatch } from './edit-patch';
import Flatbush from 'flatbush';
import { AffineTransform } from '../../../domain/geo/transform';
import { normalizePointShape } from '../../../domain/source/layer-utils';
import {
  absArcId,
  type ArcCollection,
  type ArcIterator,
  type ArcVertexData,
  type FeatureShape,
  type MapshaperDataset,
  type PathShape,
} from '../../../shared/types/mapshaper-types';
import { arcIdsFromShapes, pointGeometry, polygonGeometry, readPart, type Point } from './geometry';
import { pathGeometry } from './path-geometry';
import type { GeometryBuffer, Rect } from '../../../integrations/luma/types';

export async function lodYield(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  signal.throwIfAborted();
}
export interface SpatialChunk {
  id: number;
  layer: number;
  kind: 'point' | 'line' | 'fill';
  bounds: Rect;
  ids: Uint32Array;
  points?: readonly Point[];
  shapes?: readonly (FeatureShape | null)[];
  rawVertices: number;
}
export interface DisplayChunk {
  chunk: SpatialChunk;
  level: number;
  geometry: GeometryBuffer;
  arcs: ArcCollection | null;
  shapes: (FeatureShape | null)[];
  points: number;
  bytes: number;
  omitted: number;
  paths: readonly (readonly Point[])[];
}
const emptyBounds = (): [number, number, number, number] => [
  Infinity,
  Infinity,
  -Infinity,
  -Infinity,
];
function merge(a: number[], b: readonly number[]): void {
  a[0] = Math.min(a[0], b[0]);
  a[1] = Math.min(a[1], b[1]);
  a[2] = Math.max(a[2], b[2]);
  a[3] = Math.max(a[3], b[3]);
}
function intersects(a: Rect, b: Rect): boolean {
  return a[0] <= b[2] && a[1] <= b[3] && a[2] >= b[0] && a[3] >= b[1];
}
/** Small read-only display arcs, never a replacement of the authoritative ArcCollection. */
function displayArcs(paths: readonly (readonly Point[])[]): ArcCollection {
  const iterate = (ids: readonly number[]): ArcIterator => {
    let part = 0,
      point = 0;
    return {
      x: 0,
      y: 0,
      hasNext() {
        while (part < ids.length) {
          const id = ids[part],
            path = paths[absArcId(id)];
          if (point < path.length) {
            const p = path[id < 0 ? path.length - 1 - point++ : point++];
            this.x = p[0];
            this.y = p[1];
            return true;
          }
          part++;
          point = part < ids.length ? 1 : 0;
        }
        return false;
      },
    };
  };
  return { size: () => paths.length, getArcIter: (id) => iterate([id]), getShapeIter: iterate };
}

/**
 * Full-precision spatial chunks. No simplification, representative-point selection or
 * subpixel culling. Source coordinates, rings and attributes are never modified by rendering.
 */
export class FullGeometrySource {
  private readonly triangulationCache = new TriangulationCache();
  get triangulationStats() { return { ...this.triangulationCache.stats }; }
  private pointLod: LumaPointLodSource | null = null;
  queryPointLod(request: PointLodRequest): PointLodPacket[] {
    this.pointLod ??= new LumaPointLodSource(this.dataset);
    return this.pointLod.query(request, this.chunks);
  }
  buildScreenPaths(chunk: SpatialChunk, request: ScreenPathRequest): ScreenPathPacket {
    if(chunk.kind!=='line'||!this.vertices)throw new Error('Screen path filter requires raw arcs');
    if(request.revision!==(this.dataset.editVersion??0))throw new Error('Stale screen path revision');
    return buildScreenPaths(this.vertices,chunk.ids,request);
  }
  readonly chunks: SpatialChunk[] = [];
  private spatial: InstanceType<typeof Flatbush> | null = null;
  private vertices: ArcVertexData | null;
  private arcBounds: Float64Array | null = null;
  private bounds: Rect;
  readonly sourceRevision: number;
  readonly dataset: MapshaperDataset;

  constructor(dataset: MapshaperDataset, bounds: Rect) {
    this.dataset = dataset;
    this.bounds = bounds;
    this.sourceRevision = dataset.editVersion ?? 0;
    this.vertices = dataset.arcs?.getVertexData?.() ?? null;
  }
  async initialize(
    signal: AbortSignal,
    progress: (message: string) => void = () => {},
  ): Promise<void> {
    this.chunks.length = 0;
    if (this.vertices) {
      this.arcBounds = this.vertices.bb?.slice() ?? new Float64Array(this.vertices.nn.length * 4);
      if (!this.vertices.bb)
        for (let arc = 0; arc < this.vertices.nn.length; arc++) {
          if ((arc & 2047) === 0) await lodYield(signal);
          this.updateArcBounds(arc);
        }
    }
    progress('建立空间分块索引');
    for (let layerId = 0; layerId < this.dataset.layers.length; layerId++) {
      const layer = this.dataset.layers[layerId];
      if (!layer.shapes?.length || !layer.geometry_type) continue;
      if (layer.geometry_type === 'point') {
        const points: Point[] = [];
        for (let i = 0; i < layer.shapes.length; i++) {
          if ((i & 16383) === 0) await lodYield(signal);
          const shape = layer.shapes[i];
          if (shape)
            for (const p of normalizePointShape(shape))
              if (Number.isFinite(p[0]) && Number.isFinite(p[1])) points.push(p);
        }
        await this.partition(
          'point',
          layerId,
          Uint32Array.from({ length: points.length }, (_, i) => i),
          (id) => [points[id][0], points[id][1], points[id][0], points[id][1]],
          () => 1,
          signal,
          points,
        );
      } else if (this.dataset.arcs) {
        if (layer.geometry_type === 'polygon') {
          const getBounds = (id: number): Rect => {
            const box = emptyBounds();
            const shape = layer.shapes![id] as PathShape | null;
            if (shape)
              for (const part of shape)
                for (const arc of part) merge(box, this.getArcBounds(absArcId(arc)));
            return box;
          };
          const getCost = (id: number) => {
            let cost = 0;
            const shape = layer.shapes![id] as PathShape | null;
            if (shape)
              for (const part of shape)
                for (const arc of part) cost += this.vertices?.nn[absArcId(arc)] ?? 1;
            return cost;
          };
          await this.partition(
            'fill',
            layerId,
            Uint32Array.from({ length: layer.shapes.length }, (_, i) => i),
            getBounds,
            getCost,
            signal,
            undefined,
            layer.shapes,
          );
        }
        const ids = Uint32Array.from(arcIdsFromShapes(layer.shapes), absArcId);
        await this.partition(
          'line',
          layerId,
          ids,
          (id) => this.getArcBounds(id),
          (id) => this.vertices?.nn[id] ?? 1,
          signal,
        );
      }
    }
    if (this.chunks.length) {
      this.spatial = new Flatbush(this.chunks.length);
      for (const chunk of this.chunks) this.spatial.add(...chunk.bounds);
      this.spatial.finish();
    }
  }
  private updateArcBounds(arc: number): void {
    const { xx, yy, ii, nn, bb } = this.vertices!;
    if (bb) this.arcBounds!.set(bb.subarray(arc * 4, arc * 4 + 4), arc * 4);
    else {
      const b = emptyBounds();
      for (let i = ii[arc], end = i + nn[arc]; i < end; i++) merge(b, [xx[i], yy[i], xx[i], yy[i]]);
      this.arcBounds!.set(b, arc * 4);
    }
  }
  /** Rebuild only coordinate-dependent chunks; keep memberships and all unaffected caches. */
  async patch(patch: CoordinatePatch, signal: AbortSignal): Promise<SpatialChunk[]> {
    signal.throwIfAborted();
    const changed = applyCoordinatePatch(this.dataset, patch);
    for (const arc of changed.arcs) this.updateArcBounds(arc);
    const affected: SpatialChunk[] = [];
    for (const chunk of this.chunks) {
      const touches =
        chunk.kind === 'point'
          ? chunk.ids.some((id) => changed.points.has(chunk.points![id]))
          : chunk.kind === 'line'
            ? chunk.ids.some((id) => changed.arcs.has(id))
            : chunk.ids.some((id) =>
                (chunk.shapes![id] as PathShape | null)?.some((part) =>
                  part.some((arc) => changed.arcs.has(absArcId(arc))),
                ),
              );
      if (!touches) continue;
      const bounds = emptyBounds();
      for (const id of chunk.ids) {
        if (chunk.kind === 'point') {
          const p = chunk.points![id];
          merge(bounds, [p[0], p[1], p[0], p[1]]);
        } else if (chunk.kind === 'line') merge(bounds, this.getArcBounds(id));
        else
          for (const part of (chunk.shapes![id] as PathShape | null) ?? [])
            for (const arc of part) merge(bounds, this.getArcBounds(absArcId(arc)));
      }
      chunk.bounds = bounds;
      affected.push(chunk);
    }
    if (this.chunks.length) {
      this.spatial = new Flatbush(this.chunks.length);
      for (const chunk of this.chunks) this.spatial.add(...chunk.bounds);
      this.spatial.finish();
    }
    return affected;
  }
  private async partition(
    kind: SpatialChunk['kind'],
    layer: number,
    ids: Uint32Array,
    box: (id: number) => Rect,
    cost: (id: number) => number,
    signal: AbortSignal,
    points?: readonly Point[],
    shapes?: readonly (FeatureShape | null)[],
  ): Promise<void> {
    const bins: number[][] = Array.from({ length: 256 }, () => []);
    const [x0, y0, x1, y1] = this.bounds;
    for (let i = 0; i < ids.length; i++) {
      if ((i & 16383) === 0) await lodYield(signal);
      const id = ids[i],
        b = box(id);
      if (!b.every(Number.isFinite)) continue;
      const x = Math.max(
        0,
        Math.min(15, Math.floor((((b[0] + b[2]) / 2 - x0) / (x1 - x0 || 1)) * 16)),
      );
      const y = Math.max(
        0,
        Math.min(15, Math.floor((((b[1] + b[3]) / 2 - y0) / (y1 - y0 || 1)) * 16)),
      );
      bins[y * 16 + x].push(id);
    }
    for (const bin of bins) {
      await lodYield(signal);
      let members: number[] = [],
        bounds = emptyBounds(),
        rawVertices = 0;
      const flush = () => {
        if (!members.length) return;
        this.chunks.push({
          id: this.chunks.length,
          kind,
          layer,
          ids: Uint32Array.from(members),
          bounds,
          rawVertices,
          ...(points ? { points } : {}),
          ...(shapes ? { shapes } : {}),
        });
        members = [];
        bounds = emptyBounds();
        rawVertices = 0;
      };
      for (const id of bin) {
        const c = cost(id);
        if (members.length && (rawVertices + c > 131072 || members.length >= 8192)) flush();
        members.push(id);
        rawVertices += c;
        merge(bounds, box(id));
      }
      flush();
    }
  }
  private getArcBounds(id: number): Rect {
    const p = id * 4;
    if (this.arcBounds)
      return [
        this.arcBounds[p],
        this.arcBounds[p + 1],
        this.arcBounds[p + 2],
        this.arcBounds[p + 3],
      ];
    const box = emptyBounds(),
      iter = this.dataset.arcs!.getArcIter(id);
    while (iter.hasNext()) merge(box, [iter.x, iter.y, iter.x, iter.y]);
    return box;
  }
  private arc(id: number): Point[] {
    const data = this.vertices;
    if (!data) return readPart(this.dataset.arcs!, [id]);
    const reverse = id < 0,
      absolute = absArcId(id),
      start = data.ii[absolute],
      end = start + data.nn[absolute];
    const points: Point[] = [];
    for (let index = 0; index < end - start; index++) {
      const i = reverse ? end - 1 - index : start + index;
      points.push([data.xx[i], data.yy[i]]);
    }
    return points;
  }
  visible(transform: AffineTransform, width: number, height: number, padding = 8): SpatialChunk[] {
    const a = transform.unproject(-padding, -padding),
      b = transform.unproject(width + padding, height + padding);
    const rect: Rect = [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
    ];
    const ids: number[] = this.spatial?.search(...rect) ?? [];
    return ids
      .sort((a, b) => a - b)
      .map((id) => this.chunks[id])
      .filter((chunk) => intersects(chunk.bounds, rect));
  }
  /** Compatibility with the experimental harness; there is exactly one precision. */
  level(_transform: AffineTransform): number {
    return 0;
  }
  build(chunk: SpatialChunk, _level = 0): DisplayChunk {
    const level = 0;
    const omitted = 0;
    const paths: Point[][] = [],
      shapes: (FeatureShape | null)[] = [];
    let geometry: GeometryBuffer;
    if (chunk.kind === 'point') {
      const points = Array.from(chunk.ids, (id) => chunk.points![id]);
      shapes.push(points as [number, number][]);
      geometry = pointGeometry(points);
    } else if (chunk.kind === 'line') {
      for (const id of chunk.ids) {
        const points = this.arc(id);
        if (points.length > 1) {
          shapes.push([[paths.length]]);
          paths.push(points);
        }
      }
      geometry = pathGeometry(paths);
    } else {
      const features: Point[][][] = [], featureIds: number[] = [];
      for (const id of chunk.ids) {
        const shape = chunk.shapes![id] as PathShape | null;
        if (!shape) continue;
        const rings: Point[][] = [],
          parts: number[][] = [];
        for (const part of shape) {
          const ring: Point[] = [];
          for (const arc of part) {
            const points = this.arc(arc);
            for (const p of points) {
              const prev = ring[ring.length - 1];
              if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) ring.push(p);
            }
          }
          if (ring.length >= 3) {
            rings.push(ring);
            parts.push([paths.length]);
            paths.push(ring);
          } else if (ring.length)
            throw new Error('Cannot triangulate a ring with fewer than three distinct positions.');
        }
        features.push(rings);featureIds.push(id);
        shapes.push(parts);
      }
      geometry = polygonGeometry(features, (i) => (coordinates, holes, group) =>
        this.triangulationCache.triangulate(`${chunk.layer}:${featureIds[i]}:${group}`, coordinates, holes));
    }
    const retained =
      chunk.kind === 'point' ? geometry.count : paths.reduce((n, p) => n + p.length, 0);
    return {
      chunk,
      level,
      geometry,
      paths,
      arcs: chunk.kind === 'point' ? null : displayArcs(paths),
      shapes,
      points: retained,
      omitted,
      bytes: geometry.vertices.byteLength + (geometry.indices?.byteLength ?? 0) + retained * 32,
    };
  }
  dispose(): void {
    this.triangulationCache.clear();
    this.pointLod?.clear();
    this.pointLod = null;
    this.chunks.length = 0;
    this.spatial = null;
    this.vertices = null;
    this.arcBounds = null;
  }
}

export interface DisplayPacket {
  level: number;
  geometry: GeometryBuffer;
  coordinates: Float64Array;
  offsets: Uint32Array;
  shapes: (FeatureShape | null)[];
  points: number;
  omitted: number;
}
export function packDisplayChunk(display: DisplayChunk): DisplayPacket {
  const paths =
    display.chunk.kind === 'point' ? [display.shapes[0] as [number, number][]] : display.paths;
  const coordinates = new Float64Array(display.points * 2),
    offsets = new Uint32Array(paths.length + 1);
  let cursor = 0;
  for (let i = 0; i < paths.length; i++) {
    offsets[i] = cursor / 2;
    for (const p of paths[i]) {
      coordinates[cursor++] = p[0];
      coordinates[cursor++] = p[1];
    }
  }
  offsets[paths.length] = cursor / 2;
  return {
    level: display.level,
    geometry: display.geometry,
    coordinates,
    offsets,
    shapes: display.chunk.kind === 'point' ? [] : display.shapes,
    points: display.points,
    omitted: display.omitted,
  };
}
export function unpackDisplayChunk(chunk: SpatialChunk, packet: DisplayPacket): DisplayChunk {
  const { coordinates, offsets, geometry } = packet;
  const iterate = (ids: readonly number[]): ArcIterator => {
    let part = 0,
      point = 0;
    return {
      x: 0,
      y: 0,
      hasNext() {
        while (part < ids.length) {
          const id = ids[part],
            a = offsets[absArcId(id)],
            b = offsets[absArcId(id) + 1];
          if (point < b - a) {
            const index = id < 0 ? b - 1 - point++ : a + point++;
            this.x = coordinates[index * 2];
            this.y = coordinates[index * 2 + 1];
            return true;
          }
          part++;
          point = part < ids.length ? 1 : 0;
        }
        return false;
      },
    };
  };
  const arcs: ArcCollection = {
    size: () => offsets.length - 1,
    getArcIter: (id) => iterate([id]),
    getShapeIter: iterate,
  };
  const shapes =
    chunk.kind === 'point'
      ? [
          Array.from({ length: packet.points }, (_, i): [number, number] => [
            coordinates[i * 2],
            coordinates[i * 2 + 1],
          ]),
        ]
      : packet.shapes;
  return {
    chunk,
    level: packet.level,
    geometry,
    shapes,
    paths: [],
    arcs: chunk.kind === 'point' ? null : arcs,
    points: packet.points,
    omitted: packet.omitted,
    bytes:
      geometry.vertices.byteLength +
      (geometry.indices?.byteLength ?? 0) +
      coordinates.byteLength +
      offsets.byteLength +
      shapes.length * 32,
  };
}
export interface ChunkGeometryAccess {
  readonly chunks: SpatialChunk[];
  initialize(signal: AbortSignal, progress?: (message: string) => void): Promise<void>;
  visible(
    transform: AffineTransform,
    width: number,
    height: number,
    padding?: number,
  ): SpatialChunk[];
  level(transform: AffineTransform): number;
  build(chunk: SpatialChunk, level: number): DisplayChunk | Promise<DisplayChunk>;
  patch?(patch: CoordinatePatch, signal: AbortSignal): Promise<SpatialChunk[]>;
  queryPointLod?(request: PointLodRequest): PointLodPacket[] | Promise<PointLodPacket[]>;
  buildScreenPaths?(chunk: SpatialChunk, request: ScreenPathRequest): ScreenPathPacket | Promise<ScreenPathPacket>;
  dispose(): void;
}
