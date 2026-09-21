import { GpuRenderer } from '../../../src/integrations/luma/gpu-renderer';
import {
  pointGeometry,
  lineGeometry,
  polygonGeometry,
  readPart,
  type Point,
} from '../../../src/engine/rendering/luma/geometry';
import { pathGeometry } from '../../../src/engine/rendering/luma/path-geometry';
import { AffineTransform } from '../../../src/domain/geo/transform';
import type { MeshPaint } from '../../../src/integrations/luma/types';

// Every coordinate comes from a fully imported, authorized real file. Small selections
// isolate numerical correctness; they are not a throughput benchmark.
(window as any).verifyZoomPrecision = async (backend: 'webgl' | 'webgpu') => {
  const dataset = (window as any).lumaBenchmark.scene.dataset;
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const errors: string[] = [];
  const gpu = await GpuRenderer.create(
    canvas,
    () => {},
    (e) => errors.push(e.message),
    backend,
  );
  const paths = [0, 1].map((id) => readPart(dataset.arcs, dataset.layers[0].shapes[id][0]));
  const rows: any[] = [];
  const width = 512,
    height = 384;
  const capture = async () => {
    const pending = createImageBitmap(canvas);
    await gpu.waitForIdle();
    const image = await pending;
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d')!;
    context.drawImage(image, 0, 0);
    image.close();
    return context.getImageData(0, 0, copy.width, copy.height).data;
  };
  try {
    for (let pathId = 0; pathId < paths.length; pathId++) {
      const path = paths[pathId],
        anchor = path[Math.floor(path.length / 2)];
      for (const kind of ['circle', 'handle', 'line', 'path', 'legacy-path', 'fill'] as const) {
        const geometry = (p: readonly Point[]) =>
          kind === 'circle' || kind === 'handle'
            ? pointGeometry([p[Math.floor(p.length / 2)]])
            : kind === 'line'
              ? lineGeometry([p])
              : kind === 'fill'
                ? polygonGeometry([[p]])
                : pathGeometry([p]);
        const originalGeometry = geometry(path);
        const raw = gpu.createMesh(originalGeometry);
        if (!raw) continue;
        const paint: MeshPaint = {
          color: [1, 0.38, 0, 1],
          radius: 4,
          width: 2,
          ...(kind === 'handle' ? { filled: false } : {}),
        };
        gpu.pathMode = kind === 'legacy-path' ? 'legacy' : 'auto';
        for (const dpr of [1, 1.25, 2])
          for (const scale of [1e3, 1e6, 1e7, 1e8, 1e9]) {
            gpu.resize(width, height, dpr);
            const view = new AffineTransform(
              scale,
              -scale * 0.93,
              273.25 - anchor[0] * scale,
              173.75 + anchor[1] * scale * 0.93,
            );
            const expected = view.project(...anchor);
            // Keep fill connectivity identical: re-running tessellation after reflection
            // would test triangulation/winding rather than coordinate projection.
            let referenceGeometry = geometry(path.map((p) => view.project(...p)));
            if (kind === 'fill') {
              const positions: Point[] = [],
                values = originalGeometry.vertices;
              for (let i = 0; i < values.length; i += 4)
                positions.push(
                  view.project(values[i] + values[i + 2], values[i + 1] + values[i + 3]),
                );
              referenceGeometry = {
                ...originalGeometry,
                vertices: pointGeometry(positions).vertices,
              };
            }
            const cpu = gpu.createMesh(referenceGeometry);
            if (!cpu) throw new Error('CPU reference has no drawable geometry');
            gpu.begin(view);
            gpu.drawMesh(raw, paint);
            gpu.end();
            const actual = await capture();
            gpu.begin(view);
            gpu.drawMesh(cpu, { ...paint, screenSpace: true });
            gpu.end();
            const reference = await capture();
            gpu.destroyMesh(cpu);
            let sum = 0,
              sx = 0,
              sy = 0,
              painted = 0,
              unmatched = 0,
              referencePainted = 0;
            const radius = Math.ceil(dpr),
              stride = canvas.width;
            const x0 = Math.max(0, Math.floor((expected[0] - 22) * dpr));
            const y0 = Math.max(0, Math.floor((expected[1] - 22) * dpr));
            const x1 = Math.min(canvas.width, Math.ceil((expected[0] + 22) * dpr));
            const y1 = Math.min(canvas.height, Math.ceil((expected[1] + 22) * dpr));
            for (let y = y0; y < y1; y++)
              for (let x = x0; x < x1; x++) {
                const index = (y * stride + x) * 4 + 3,
                  a = actual[index],
                  b = reference[index];
                sum += a;
                sx += ((x + 0.5) / dpr) * a;
                sy += ((y + 0.5) / dpr) * a;
                if (a > 64) painted++;
                if (b > 64) referencePainted++;
                for (const [first, second] of [
                  [a, reference],
                  [b, actual],
                ] as const)
                  if (first > 128) {
                    let found = false;
                    for (let dy = -radius; dy <= radius && !found; dy++)
                      for (let dx = -radius; dx <= radius; dx++) {
                        const xx = x + dx,
                          yy = y + dy;
                        if (
                          xx >= 0 &&
                          xx < stride &&
                          yy >= 0 &&
                          yy < canvas.height &&
                          second[(yy * stride + xx) * 4 + 3] > 32
                        ) {
                          found = true;
                          break;
                        }
                      }
                    if (!found) unmatched++;
                  }
              }
            rows.push({
              pathId,
              kind,
              dpr,
              scale,
              painted,
              referencePainted,
              unmatched,
              ...(kind === 'circle' || kind === 'handle'
                ? {
                    centerErrorCss: sum
                      ? Math.hypot(sx / sum - expected[0], sy / sum - expected[1])
                      : null,
                  }
                : {}),
            });
          }
        gpu.destroyMesh(raw);
      }
    }
  } finally {
    gpu.dispose();
    canvas.remove();
  }
  return { backend, rows, errors, resources: gpu.stats };
};
