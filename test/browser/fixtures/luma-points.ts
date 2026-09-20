import { GpuRenderer } from '../../../src/integrations/luma/gpu-renderer';
import { pointGeometry, lineGeometry } from '../../../src/engine/rendering/luma/geometry';
import { AffineTransform } from '../../../src/domain/geo/transform';
import type { MeshPaint } from '../../../src/integrations/luma/types';

// Functional overlap fixtures use original coordinates supplied from a real file.
// They are never used as throughput benchmark data.
(window as any).verifyCirclePixels = async (backend: 'webgl' | 'webgpu') => {
  const api = (window as any).lumaBenchmark;
  const points = api.scene.dataset.layers[0].shapes.slice(0, 1024).flat();
  const results: unknown[] = [];
  const errors: string[] = [];
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const gpu = await GpuRenderer.create(
    canvas,
    () => {},
    (e) => errors.push(e.message),
    backend,
  );
  const geometry = pointGeometry(points),
    mesh = gpu.createMesh(geometry)!;
  const line = gpu.createMesh(lineGeometry([[points[0], points[1]]]))!;
  const base = api.view;
  const paint: MeshPaint = { color: [37 / 255, 99 / 255, 235 / 255, 1], radius: 3 };
  const scenarios: { name: string; paints: (MeshPaint | 'line')[] }[] = [
    { name: 'opaque', paints: [paint] },
    { name: 'same-color-overlap', paints: [paint, { ...paint, radius: 6 }] },
    {
      name: 'different-color-order',
      paints: [paint, { ...paint, color: [1, 0, 0, 1], radius: 4 }, paint],
    },
    {
      name: 'transparent-barrier',
      paints: [paint, { ...paint, color: [1, 0, 0, 0.4], radius: 4 }, paint],
    },
    { name: 'line-barrier', paints: [paint, 'line', paint] },
    {
      name: 'outline-barrier',
      paints: [paint, { ...paint, filled: false, color: [0, 0, 0, 1], width: 2 }, paint],
    },
    {
      name: 'partial-opacity',
      paints: [
        { ...paint, color: [0.1, 0.4, 0.8, 0.4] },
        { ...paint, color: [0.8, 0.2, 0.3, 0.7] },
      ],
    },
    ...[0.25, 1, 1.5, 2, 8].map((radius) => ({
      name: 'radius-' + radius,
      paints: [{ ...paint, radius }],
    })),
  ];
  try {
    for (const pr of [1, 1.25, 2]) {
      gpu.resize(640, 360, pr);
      const t = new AffineTransform(base.mx, base.my, base.bx, base.by);
      t.translate(320 - 1238 / 2, 180 - 450 / 2);
      for (const scene of scenarios) {
        const draw = async (enabled: boolean) => {
          gpu.circleOptimizationEnabled = enabled;
          gpu.begin(t);
          for (const p of scene.paints)
            if (p === 'line') gpu.drawMesh(line, { color: [0.9, 0.1, 0.1, 0.65], width: 5 });
            else gpu.drawMesh(mesh, p);
          gpu.end();
          const pending = createImageBitmap(canvas);
          await gpu.waitForIdle();
          const image = await pending;
          const copy = document.createElement('canvas');
          copy.width = image.width;
          copy.height = image.height;
          const ctx = copy.getContext('2d')!;
          ctx.drawImage(image, 0, 0);
          image.close();
          return ctx.getImageData(0, 0, copy.width, copy.height).data;
        };
        const standard = await draw(false),
          optimized = await draw(true);
        let max = 0,
          different = 0,
          painted = 0;
        for (let i = 0; i < standard.length; i++) {
          const delta = Math.abs(standard[i] - optimized[i]);
          max = Math.max(max, delta);
          if (delta) different++;
          if (i % 4 === 3 && standard[i]) painted++;
        }
        results.push({
          scenario: scene.name,
          pr,
          maxChannelDifference: max,
          differentChannels: different,
          painted,
        });
      }
    }
  } finally {
    gpu.dispose();
    canvas.remove();
  }
  return { backend, results, errors, resources: { ...gpu.stats } };
};
