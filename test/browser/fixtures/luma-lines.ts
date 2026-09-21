import { buildPathRanges, PathRangeIndex } from '../../../src/engine/rendering/luma/path-ranges';
import { GpuRenderer } from '../../../src/integrations/luma/gpu-renderer';
import { pathGeometry } from '../../../src/engine/rendering/luma/path-geometry';
import {
  readPart,
  pointGeometry,
  polygonGeometry,
} from '../../../src/engine/rendering/luma/geometry';
import { AffineTransform } from '../../../src/domain/geo/transform';
import { Bounds } from '../../../src/domain/geo/bounds';
import type { MeshPaint } from '../../../src/integrations/luma/types';
// Functional geometry is taken from the real input; this subset is NOT a performance sample.
(window as any).verifyLinePixels = async (backend: 'webgl' | 'webgpu') => {
  const d = (window as any).lumaBenchmark.scene.dataset;
  const paths: [number, number][][] = [];
  for (let i = 0; i < d.arcs.size() && paths.length < 48; i++) {
    const p = readPart(d.arcs, [i]);
    if (p.length >= 2 && p.length < 1000) paths.push(p as [number, number][]);
  }
  const all = paths.flat(),
    bbox = new Bounds();
  for (const p of all) bbox.mergePoint(...p);
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const errors: string[] = [],
    gpu = await GpuRenderer.create(
      canvas,
      () => {},
      (e) => errors.push(e.message),
      backend,
    );
  const a = gpu.createMesh(pathGeometry(paths))!,
    b = gpu.createMesh(pathGeometry(paths.map((p) => [...p].reverse())))!;
  const rangeA = new PathRangeIndex(buildPathRanges(paths, a.count, 64), a.count);
  const rangeB = new PathRangeIndex(
    buildPathRanges(
      paths.map((p) => [...p].reverse()),
      b.count,
      64,
    ),
    b.count,
  );
  let rangeRejected = 0;
  const point = gpu.createMesh(pointGeometry(all.slice(0, 512)))!;
  const rings =
    d.layers[0].geometry_type === 'polygon'
      ? d.layers[0].shapes[0].map((p: number[]) => readPart(d.arcs, p))
      : [];
  const fill = rings.length ? gpu.createMesh(polygonGeometry([rings])) : null;
  const color: MeshPaint = { color: [0.05, 0.45, 0.4, 1], width: 3 };
  type Draw = { kind: 'a' | 'b' | 'point' | 'fill'; paint: MeshPaint };
  const draw = (paint: MeshPaint, kind: Draw['kind'] = 'a'): Draw => ({ kind, paint });
  const cases: {
    name: string;
    draws: Draw[];
    legacy?: boolean;
    view?: 'near' | 'far' | 'anisotropic';
  }[] = [
    { name: 'open-and-closed-original-arcs', draws: [draw(color)] },
    { name: 'reverse-and-cross-chunk-overlap', draws: [draw(color), draw(color, 'b')] },
    {
      name: 'different-color-order',
      draws: [
        draw(color),
        draw({ ...color, color: [0.9, 0.1, 0.2, 1], width: 7 }, 'b'),
        draw(color),
      ],
    },
    {
      name: 'transparent-barrier',
      draws: [draw(color), draw({ ...color, color: [1, 0, 0, 0.4], width: 5 }, 'b'), draw(color)],
    },
    {
      name: 'point-barrier',
      draws: [draw(color), draw({ color: [0, 0, 1, 1], radius: 3 }, 'point'), draw(color)],
    },
    {
      name: 'fill-barrier',
      draws: [draw(color), draw({ color: [1, 0.5, 0, 0.4] }, 'fill'), draw(color)],
    },
    { name: 'dashes-unchanged', draws: [draw({ ...color, dash: [5, 3] })], legacy: true },
    {
      name: 'translucent-unchanged',
      draws: [draw({ ...color, color: [0, 0.4, 1, 0.5] })],
      legacy: true,
    },
    ...(['near', 'far', 'anisotropic'] as const).map((view) => ({
      name: 'raw-path-view-' + view,
      draws: [draw(color), draw(color, 'b')],
      view,
    })),
    ...[0.2, 0.6, 1.2, 8].map((width) => ({
      name: 'width-' + width,
      draws: [draw({ ...color, width })],
    })),
  ];
  const rows: unknown[] = [];
  try {
    for (const pr of [1, 1.25, 2]) {
      gpu.resize(640, 360, pr);
      const t = AffineTransform.fromBounds(
        bbox.clone().fillOut(640 / 360),
        new Bounds(20, 20, 620, 340),
        true,
      );
      for (const c of cases) {
        const capture = async (mode: 'auto' | 'reference' | 'legacy') => {
          gpu.pathMode = mode;
          const actual = t.clone();
          if (c.view === 'near') {
            actual.scale(8, 320, 180);
            const anchor = actual.project(...all[Math.floor(all.length / 2)]);
            actual.translate(320 - anchor[0], 180 - anchor[1]);
          }
          if (c.view === 'far') actual.scale(Math.exp(-3.2), 320, 180);
          if (c.view === 'anisotropic') {
            actual.mx *= 0.65;
            actual.my *= -0.8;
            const center = actual.project((bbox.xmin + bbox.xmax) / 2, (bbox.ymin + bbox.ymax) / 2);
            actual.translate(320 - center[0], 180 - center[1]);
          }
          gpu.begin(actual);
          for (const cmd of c.draws) {
            const mesh =
              cmd.kind === 'a' ? a : cmd.kind === 'b' ? b : cmd.kind === 'point' ? point : fill;
            if (mesh) {
              const selection =
                mode === 'auto' && mesh.kind === 'path'
                  ? (cmd.kind === 'a' ? rangeA : rangeB).select(
                      actual,
                      640,
                      360,
                      Math.max(8, (cmd.paint.width ?? 1) * 4 + 2),
                    )
                  : null;
              rangeRejected += selection?.rejected ?? 0;
              gpu.drawMesh(mesh, cmd.paint, selection?.ranges);
            }
          }
          gpu.end();
          const pending = createImageBitmap(canvas);
          await gpu.waitForIdle();
          const bitmap = await pending;
          const out = document.createElement('canvas');
          out.width = bitmap.width;
          out.height = bitmap.height;
          const ctx = out.getContext('2d')!;
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          return ctx.getImageData(0, 0, out.width, out.height).data;
        };
        const reference = await capture(c.legacy ? 'legacy' : 'reference'),
          optimized = await capture('auto');
        let max = 0,
          different = 0,
          painted = 0,
          fractional = 0;
        for (let i = 0; i < reference.length; i++) {
          const v = Math.abs(reference[i] - optimized[i]);
          max = Math.max(max, v);
          if (v) different++;
          if (i % 4 === 3 && reference[i]) {
            painted++;
            if (reference[i] < 255) fractional++;
          }
        }
        rows.push({ name: c.name, pr, max, different, painted, fractional });
      }
    }
  } finally {
    gpu.dispose();
    canvas.remove();
  }
  return {
    backend,
    rows,
    errors,
    resources: gpu.stats,
    sourceArcCount: d.arcs.size(),
    originalPaths: paths.length,
    rangeRejected,
  };
};
