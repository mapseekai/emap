import {
  PerspectiveTransform,
  groundBounds,
  type PerspectiveOptions,
} from '../../../domain/geo/perspective-transform';
import { AffineTransform } from '../../../domain/geo/transform';
import type { ArcVertexData } from '../../../shared/types/mapshaper-types';
import type { GeometryBuffer } from '../../../integrations/luma/types';
import { pathGeometry } from './path-geometry';
import type { Point } from './geometry';

export interface ScreenPathRequest {
  /** Optional ground camera, serialized explicitly for the geometry Worker. */
  perspective?: PerspectiveOptions;
  view: [number, number, number, number];
  width: number;
  height: number;
  pixelRatio: number;
  initialScale: number;
  smallArcs: boolean;
  halfPixel: boolean;
  cull: boolean;
  padding: number;
  revision: number;
}
export interface ScreenPathStats {
  originalArcs: number;
  originalVertices: number;
  tinyArcs: number;
  outsideArcs: number;
  duplicateVertices: number;
  collapsedArcs: number;
  outputVertices: number;
  outputSegments: number;
  rawFallbackChunks: number;
}
export const emptyScreenPathStats = (): ScreenPathStats => ({
  originalArcs: 0,
  originalVertices: 0,
  tinyArcs: 0,
  outsideArcs: 0,
  duplicateVertices: 0,
  collapsedArcs: 0,
  outputVertices: 0,
  outputSegments: 0,
  rawFallbackChunks: 0,
});
export interface ScreenPathPacket {
  /** GPU coordinates are CSS pixels, never source coordinates. */
  geometry: GeometryBuffer;
  /** Canvas command coordinates are physical device pixels; do not snap them twice. */
  coordinates: Float64Array;
  offsets: Uint32Array;
  /** Stable original arc identity per retained path, including collapsed arcs. */
  arcIds: Uint32Array;
  stats: ScreenPathStats;
  fallback: boolean;
}
/** Exactly Viewport.getArcFilter's zoom-relative 0.35 CSS-pixel threshold. */
export function canvasMinArcLength(scale: number, initialScale: number): number {
  const mapScale = initialScale > 0 ? Math.abs(scale) / initialScale : 1;
  const min = 0.35 / Math.abs(scale);
  return mapScale < 1 ? min * mapScale : min;
}
export function validateScreenPathRequest(r: ScreenPathRequest): void {
  if (
    !r.view.every(Number.isFinite) ||
    r.view[0] === 0 ||
    r.view[1] === 0 ||
    ![r.width, r.height, r.pixelRatio].every((v) => Number.isFinite(v) && v > 0) ||
    !Number.isFinite(r.initialScale) ||
    r.initialScale < 0 ||
    !Number.isFinite(r.padding) ||
    r.padding < 0 ||
    !Number.isInteger(r.revision) ||
    r.revision < 0 ||
    [r.smallArcs, r.halfPixel, r.cull].some((v) => typeof v !== 'boolean')
  ) {
    throw new Error('Invalid Canvas screen-filter request');
  }
  if (r.perspective !== undefined && (!r.perspective || typeof r.perspective !== 'object'))
    throw new Error('Invalid perspective screen-filter request');
}
/** Match CanvasPainter._traceSnapped/drawPathSnapping without touching source arcs.
 * Only consecutive equal half-device-pixel commands are dropped (A-B-A is retained).
 * Overflow falls back to the original GPU chunk, rather than wrapping distant coordinates.
 */
export function buildScreenPaths(
  data: ArcVertexData,
  ids: Uint32Array,
  r: ScreenPathRequest,
): ScreenPathPacket {
  validateScreenPathRequest(r);
  const stats = emptyScreenPathStats();
  const paths: Point[][] = [],
    keptIds: number[] = [],
    coordinates: number[] = [],
    offsets = [0];
  const { xx, yy, ii, nn, bb } = data;
  const [mx, my, bx, by] = r.view;
  const pixelView = new AffineTransform(
    mx * r.pixelRatio,
    my * r.pixelRatio,
    bx * r.pixelRatio,
    by * r.pixelRatio,
  );
  const flat = new AffineTransform(mx, my, bx, by);
  const perspective = r.perspective
    ? new PerspectiveTransform(flat, r.width, r.height, r.perspective)
    : null;
  const view = perspective ?? flat;
  const box = groundBounds(view, r.width, r.height, r.padding);
  const min = canvasMinArcLength(mx, r.initialScale);
  const fallback = (): ScreenPathPacket => ({
    geometry: { kind: 'path', vertices: new Float32Array(0), count: 0, segmentCount: 0 },
    coordinates: new Float64Array(0),
    offsets: new Uint32Array([0]),
    arcIds: new Uint32Array(0),
    stats: { ...emptyScreenPathStats(), rawFallbackChunks: 1 },
    fallback: true,
  });
  for (const id of ids) {
    if (id >= nn.length) throw new Error('Unknown original arc ID');
    stats.originalArcs++;
    stats.originalVertices += nn[id];
    const start = ii[id],
      end = start + nn[id];
    if (!nn[id]) continue;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    if (bb) {
      x0 = bb[id * 4];
      y0 = bb[id * 4 + 1];
      x1 = bb[id * 4 + 2];
      y1 = bb[id * 4 + 3];
    } else
      for (let i = start; i < end; i++) {
        x0 = Math.min(x0, xx[i]);
        y0 = Math.min(y0, yy[i]);
        x1 = Math.max(x1, xx[i]);
        y1 = Math.max(y1, yy[i]);
      }
    // Same strict width AND height test as mapshaper ArcCollection.arcIsSmaller.
    let tiny = x1 - x0 < min && y1 - y0 < min;
    if (r.smallArcs && perspective?.active) {
      const corners = [
        [x0, y0],
        [x1, y0],
        [x0, y1],
        [x1, y1],
      ].map(([x, y]) => view.project(x, y));
      const threshold = min * Math.abs(mx);
      tiny =
        corners.every((p) => p.every(Number.isFinite)) &&
        Math.max(...corners.map((p) => p[0])) - Math.min(...corners.map((p) => p[0])) < threshold &&
        Math.max(...corners.map((p) => p[1])) - Math.min(...corners.map((p) => p[1])) < threshold;
    }
    if (r.smallArcs && tiny) {
      stats.tinyArcs++;
      continue;
    }
    // Keep symbol padding, unlike Canvas's unexpanded bbox, so thick boundary strokes survive.
    if (r.cull && (x1 < box[0] || y1 < box[1] || x0 > box[2] || y0 > box[3])) {
      stats.outsideArcs++;
      continue;
    }
    const path: Point[] = [];
    let lastX = NaN,
      lastY = NaN;
    for (let i = start; i < end; i++) {
      let [x, y] = perspective?.active
        ? perspective.project(xx[i], yy[i])
        : pixelView.project(xx[i], yy[i]);
      if (perspective?.active) {
        x *= r.pixelRatio;
        y *= r.pixelRatio;
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback();
      if (r.halfPixel) {
        // Canvas uses ToInt32, not Math.round/floor; preserve negative-coordinate truncation.
        if (x * 2 < -2147483648 || x * 2 > 2147483647 || y * 2 < -2147483648 || y * 2 > 2147483647)
          return fallback();
        x = ((x * 2) | 0) / 2;
        y = ((y * 2) | 0) / 2;
        if (path.length && x === lastX && y === lastY) {
          stats.duplicateVertices++;
          continue;
        }
      }
      path.push([x / r.pixelRatio, y / r.pixelRatio]);
      coordinates.push(x, y);
      lastX = x;
      lastY = y;
    }
    if (r.halfPixel && path.length === 1) {
      // Canvas emits a 0.1-device-pixel line when every command collapses; retain its round-cap dot.
      path.push([(lastX + 0.1) / r.pixelRatio, lastY / r.pixelRatio]);
      coordinates.push(lastX + 0.1, lastY);
      stats.collapsedArcs++;
    }
    paths.push(path);
    keptIds.push(id);
    offsets.push(coordinates.length / 2);
  }
  const geometry = pathGeometry(paths);
  stats.outputVertices = coordinates.length / 2;
  stats.outputSegments = geometry.segmentCount ?? 0;
  return {
    geometry,
    coordinates: Float64Array.from(coordinates),
    offsets: Uint32Array.from(offsets),
    arcIds: Uint32Array.from(keptIds),
    stats,
    fallback: false,
  };
}
