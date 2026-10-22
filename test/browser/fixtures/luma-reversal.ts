import { GpuRenderer } from '../../../src/integrations/luma/gpu-renderer';
import { pathGeometry } from '../../../src/engine/rendering/luma/path-geometry';
import { compactStrokeGeometry } from '../../../src/engine/rendering/luma/compact-stroke';
import { AffineTransform } from '../../../src/domain/geo/transform';
import type { Point } from '../../../src/engine/rendering/luma/geometry';
import type { GeometryBuffer } from '../../../src/integrations/luma/types';

type Options = {
  backend: 'webgl' | 'webgpu';
  dpr: number;
  width?: number;
  scale?: number;
  shift?: number;
  angle?: number;
  scenario?: 'closed' | 'caps' | 'open' | 'tiny' | 'near' | 'precise';
};
// Independent screen-space finite-segment distance; no production join or envelope math.
function distance(x: number, y: number, path: Point[]): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1],
      [bx, by] = path[i];
    const dx = bx - ax,
      dy = by - ay,
      squared = dx * dx + dy * dy;
    if (!squared) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / squared));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}
function preciseLayout(g: GeometryBuffer): GeometryBuffer {
  if (!g.compactStrokeXY) return g;
  const vertices = new Float32Array(g.count * 16);
  for (let i = 0; i < g.count; i++) {
    const a = i * 12,
      b = i * 16;
    vertices.set(g.vertices.subarray(a, a + 2), b);
    vertices.set(g.vertices.subarray(a + 2, a + 4), b + 4);
    vertices.set(g.vertices.subarray(a + 4, a + 12), b + 8);
  }
  return { ...g, compactStrokeXY: false, vertices };
}
(window as any).verifyReversalPixels = async (options: Options) => {
  const {
    backend,
    dpr,
    width = 7,
    scale = 1,
    angle = 0,
    scenario = 'closed',
    shift = scenario === 'tiny' ? 0.5 / dpr : 0.25,
  } = options;
  const origin: Point = scenario === 'precise' ? [13000000.001, 4000000.002] : [0, 0];
  const local: Point[] =
    scenario === 'open'
      ? [
          [-80, -30],
          [0, 0],
          [160, 0],
          [0, 0],
          [-80, 40],
        ]
      : scenario === 'tiny'
        ? [
            [0, 0],
            [0.01, 0],
            [0, 0],
          ]
        : scenario === 'near'
          ? [
              [0, 0],
              [160, 0],
              [0, 0.001],
            ]
          : scenario === 'caps'
            ? [
                [0, 0],
                [0, 0],
                [160, 0],
                [0, 0],
                [0, 0],
              ]
            : [
                [0, 0],
                [160, 0],
                [0, 0],
              ];
  const path = local.map(
    ([x, y]) =>
      [
        x * Math.cos(angle) - y * Math.sin(angle) + origin[0],
        x * Math.sin(angle) + y * Math.cos(angle) + origin[1],
      ] as Point,
  );
  const view = new AffineTransform(
    scale,
    scale,
    240 + shift - origin[0] * scale,
    240 + shift - origin[1] * scale,
  );
  const screen = path.map((p) => view.project(...p) as Point);
  const raw = pathGeometry([path]),
    compact = compactStrokeGeometry(raw, 4);
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const errors: string[] = [];
  const gpu = await GpuRenderer.create(
    canvas,
    () => {},
    (e) => errors.push(e.message),
    backend,
  );
  const actualBackend = gpu.backend,
    rows: unknown[] = [];
  let samples = 0;
  let reference: Uint8ClampedArray | undefined;
  try {
    gpu.resize(640, 480, dpr);
    samples = gpu.pathRendering.samples;
    const capture = async (geometry: GeometryBuffer) => {
      const mesh = gpu.createMesh(geometry)!;
      gpu.begin(view);
      gpu.drawMesh(mesh, { color: [0.1, 0.3, 0.8, 1], width });
      gpu.end();
      const pending = createImageBitmap(canvas);
      await gpu.waitForIdle();
      const bitmap = await pending,
        out = document.createElement('canvas');
      out.width = bitmap.width;
      out.height = bitmap.height;
      const ctx = out.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = ctx.getImageData(0, 0, out.width, out.height).data;
      gpu.destroyMesh(mesh);
      return { pixels, width: out.width, height: out.height };
    };
    // The ordinary straight segment preserves hardware MSAA along its body.
    const bodyReference =
      scenario === 'closed' && angle === 0
        ? (await capture(pathGeometry([[path[0], path[1]]]))).pixels
        : undefined;
    for (const [mode, geometry] of [
      ['raw', raw],
      ['compact', compact],
      ['compact-hi-lo', preciseLayout(compact)],
    ] as const) {
      const { pixels, width: pixelWidth, height: pixelHeight } = await capture(geometry);
      let pixelHash = 2166136261,
        different = 0,
        maxDifference = 0;
      for (let i = 0; i < pixels.length; i++) {
        pixelHash = Math.imul(pixelHash ^ pixels[i], 16777619) >>> 0;
        if (reference && pixels[i] !== reference[i]) {
          different++;
          maxDifference = Math.max(maxDifference, Math.abs(pixels[i] - reference[i]));
        }
      }
      reference ??= pixels;
      let interior = 0,
        missing = 0,
        exterior = 0,
        extra = 0,
        painted = 0,
        fringe = 0,
        bodyCompared = 0,
        bodyDifferent = 0;
      const radius = width / 2,
        margin = 1.1 / dpr;
      for (let y = 0; y < pixelHeight; y++)
        for (let x = 0; x < pixelWidth; x++) {
          const at = (y * pixelWidth + x) * 4;
          const alpha = pixels[at + 3];
          const sx = (x + 0.5) / dpr,
            sy = (y + 0.5) / dpr;
          if (
            bodyReference &&
            sx > screen[0][0] + 2 / dpr &&
            sx < screen[1][0] - 2 / dpr &&
            Math.abs(sy - screen[0][1]) < radius + 2 / dpr
          ) {
            bodyCompared++;
            if (
              pixels[at] !== bodyReference[at] ||
              pixels[at + 1] !== bodyReference[at + 1] ||
              pixels[at + 2] !== bodyReference[at + 2] ||
              alpha !== bodyReference[at + 3]
            )
              bodyDifferent++;
          }
          const delta = distance((x + 0.5) / dpr, (y + 0.5) / dpr, screen) - radius;
          if (delta < -margin) {
            interior++;
            if (alpha !== 255) missing++;
          }
          if (delta > margin) {
            exterior++;
            if (alpha !== 0) extra++;
          }
          if (alpha) painted++;
          if (alpha > 0 && alpha < 255) fringe++;
        }
      const probe = (normal: number) => {
        const x = Math.floor((screen[0][0] - radius * 0.25) * dpr);
        const y = Math.floor((screen[0][1] + radius * normal) * dpr);
        return pixels[(y * pixelWidth + x) * 4 + 3];
      };
      rows.push({
        mode,
        pixelHash,
        different,
        maxDifference,
        compact: !!geometry.compactStroke,
        xy: !!geometry.compactStrokeXY,
        count: geometry.count,
        submitted: gpu.stats.pathFrameSubmitted,
        segments: geometry.segmentCount,
        interior,
        missing,
        exterior,
        extra,
        painted,
        fringe,
        bodyCompared,
        bodyDifferent,
        wedge: [probe(0.96), probe(-0.96)],
      });
    }
  } finally {
    gpu.dispose();
    canvas.remove();
  }
  return {
    options,
    actualBackend,
    samples,
    rows,
    errors,
    liveBufferBytes: gpu.stats.liveBufferBytes,
  };
};
