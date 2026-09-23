import type { AffineTransform } from '../../../domain/geo/transform';
import { normalizePointShape } from '../../../domain/source/layer-utils';
import {
  absArcId,
  type MapshaperDataset,
  type MapshaperLayer,
  type PathShape,
} from '../../../shared/types/mapshaper-types';
export type XY = readonly [number, number];
export type Box = [number, number, number, number];

export function featureBounds(dataset: MapshaperDataset, layer: MapshaperLayer, id: number): Box {
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    box[0] = Math.min(box[0], x);
    box[1] = Math.min(box[1], y);
    box[2] = Math.max(box[2], x);
    box[3] = Math.max(box[3], y);
  };
  const shape = layer.shapes?.[id];
  if (!shape) return box;
  if (layer.geometry_type === 'point') {
    for (const p of normalizePointShape(shape)) add(p[0], p[1]);
  } else {
    const data = dataset.arcs?.getVertexData?.();
    if (!data) return box;
    for (const part of shape as PathShape)
      for (const signed of part) {
        const arc = absArcId(signed);
        if (arc >= data.nn.length) continue;
        if (data.bb) {
          add(data.bb[arc * 4], data.bb[arc * 4 + 1]);
          add(data.bb[arc * 4 + 2], data.bb[arc * 4 + 3]);
        } else
          for (let i = data.ii[arc], end = i + data.nn[arc]; i < end; i++)
            add(data.xx[i], data.yy[i]);
      }
  }
  return box;
}

/** Reads authoritative coordinates, independent of ArcCollection's retained interval. */
export function featurePaths(dataset: MapshaperDataset, layer: MapshaperLayer, id: number): XY[][] {
  const data = dataset.arcs?.getVertexData?.(),
    shape = layer.shapes?.[id] as PathShape | null;
  if (!data || !shape) return [];
  const paths: XY[][] = [];
  for (const part of shape) {
    const path: XY[] = [];
    for (const signed of part) {
      const arc = absArcId(signed),
        n = data.nn[arc],
        start = data.ii[arc];
      for (let k = 0; k < n; k++) {
        const i = start + (signed < 0 ? n - 1 - k : k),
          p: XY = [data.xx[i], data.yy[i]],
          last = path.at(-1);
        if (Number.isFinite(p[0] + p[1]) && (!last || p[0] !== last[0] || p[1] !== last[1]))
          path.push(p);
      }
    }
    if (path.length) paths.push(path);
  }
  return paths;
}

/** Even-odd scanlines choose an interior span, excluding holes and supporting multipart islands.
 * Unlike a centroid this cannot place an anchor in a concavity or a hole. */
export function polygonAnchor(paths: readonly (readonly XY[])[]): XY | null {
  let ymin = Infinity,
    ymax = -Infinity;
  for (const path of paths)
    for (const p of path) {
      ymin = Math.min(ymin, p[1]);
      ymax = Math.max(ymax, p[1]);
    }
  if (!(ymax > ymin)) return null;
  let result: XY | null = null,
    best = -Infinity;
  for (const fraction of [0.5, 0.375, 0.625, 0.25, 0.75, 0.125, 0.875, 0.0625, 0.9375]) {
    const y = ymin + (ymax - ymin) * fraction,
      intersections: number[] = [];
    for (const path of paths)
      for (let i = 0; i < path.length; i++) {
        const a = path[i],
          b = path[(i + 1) % path.length];
        if (a[1] > y !== b[1] > y)
          intersections.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const a = intersections[i],
        b = intersections[i + 1],
        score = (b - a) * (1 - Math.abs(fraction - 0.5) * 0.5);
      if (score > 0 && score > best) {
        best = score;
        result = [a + (b - a) / 2, y];
      }
    }
  }
  return result;
}

export interface LabelPose {
  x: number;
  y: number;
  angle: number;
}
/** Longest visible run, measured in projected CSS pixels. Too-short/bent lines are omitted. */
export function linePose(
  paths: readonly (readonly XY[])[],
  view: AffineTransform,
  width: number,
  height: number,
  textWidth: number,
  parallel: boolean,
): LabelPose | null {
  let best: XY[] = [],
    longest = 0;
  for (const path of paths) {
    let run: XY[] = [],
      length = 0;
    const flush = () => {
      if (length > longest) {
        longest = length;
        best = run;
      }
      run = [];
      length = 0;
    };
    for (let i = 1; i < path.length; i++) {
      const a = view.project(...path[i - 1]),
        b = view.project(...path[i]);
      if (![...a, ...b].every(Number.isFinite)) {
        flush();
        continue;
      }
      const clipped = clipSegment(a, b, [-32, -32, width + 32, height + 32]);
      if (!clipped) {
        flush();
        continue;
      }
      const [p, q] = clipped,
        last = run.at(-1);
      if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.01) flush();
      if (!run.length) run.push(p);
      run.push(q);
      length += Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
    flush();
  }
  if (longest < textWidth + 8) return null;
  const sample = (at: number): XY => {
    let d = 0;
    for (let i = 1; i < best.length; i++) {
      const a = best[i - 1],
        b = best[i],
        n = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (n > 0 && d + n >= at) {
        const t = (at - d) / n;
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      }
      d += n;
    }
    return best.at(-1)!;
  };
  const center = sample(longest / 2),
    a = sample((longest - textWidth) / 2),
    b = sample((longest + textWidth) / 2);
  if (parallel && Math.hypot(b[0] - a[0], b[1] - a[1]) < textWidth * 0.8) return null;
  let angle = parallel ? Math.atan2(b[1] - a[1], b[0] - a[0]) : 0;
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle < -Math.PI / 2) angle += Math.PI;
  return { x: center[0], y: center[1], angle };
}

function clipSegment(a: XY, b: XY, box: Box): [XY, XY] | null {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  let lo = 0,
    hi = 1;
  const ps = [-dx, dx, -dy, dy],
    qs = [a[0] - box[0], box[2] - a[0], a[1] - box[1], box[3] - a[1]];
  for (let i = 0; i < 4; i++) {
    if (ps[i] === 0) {
      if (qs[i] < 0) return null;
    } else {
      const t = qs[i] / ps[i];
      if (ps[i] < 0) lo = Math.max(lo, t);
      else hi = Math.min(hi, t);
    }
    if (lo > hi) return null;
  }
  return [
    [a[0] + lo * dx, a[1] + lo * dy],
    [a[0] + hi * dx, a[1] + hi * dy],
  ];
}

/** Conservative screen-space AABB collision grid. Rotated labels never under-report bounds. */
export class LabelCollisionGrid {
  private cells = new Map<string, Box[]>();
  private keys(b: Box): string[] {
    const keys: string[] = [];
    for (let y = Math.floor(b[1] / 64); y <= Math.floor(b[3] / 64); y++)
      for (let x = Math.floor(b[0] / 64); x <= Math.floor(b[2] / 64); x++) keys.push(`${x}:${y}`);
    return keys;
  }
  collides(box: Box): boolean {
    return this.keys(box).some((k) =>
      this.cells
        .get(k)
        ?.some((b) => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1]),
    );
  }
  insert(box: Box): void {
    for (const k of this.keys(box)) {
      const list = this.cells.get(k) ?? [];
      list.push(box);
      this.cells.set(k, list);
    }
  }
}
export function poseBounds(pose: LabelPose, width: number, height: number, padding: number): Box {
  const c = Math.abs(Math.cos(pose.angle)),
    s = Math.abs(Math.sin(pose.angle));
  const x = (c * width + s * height) / 2 + padding,
    y = (s * width + c * height) / 2 + padding;
  return [pose.x - x, pose.y - y, pose.x + x, pose.y + y];
}
