import { colorizeRasterTile } from '../../../src/engine/rendering/raster/tile';
import { AffineTransform } from '../../../src/domain/geo/transform';
import { GeoTIFF } from 'geotiff';
import { LocalRasterFileSource } from '../../../src/integrations/geotiff/file-source';
import { readNumericWindow } from '../../../src/integrations/geotiff/read-window';

(window as any).checkNumericPixels = async (style: any) => {
  const app = (window as any).lumaRaster;
  app.setStyle(style);
  await app.settle();
  const meta = app.metadata,
    level = meta.levels.find((l: any) => l.id === app.stats().level),
    base = meta.levels[0],
    v = app.map.ctx.view.getTransform();
  const dpr = app.stats().dimensions.dpr;
  const toSource = new AffineTransform(
    (meta.resolution[0] * base.width) / level.width,
    (meta.resolution[1] * base.height) / level.height,
    ...(meta.origin as [number, number]),
  );
  const screen = await app.capture(),
    size = 24;
  const ratioX = screen.width / app.stats().dimensions.width,
    ratioY = screen.height / app.stats().dimensions.height;
  const centers: number[][] = [
    [0.5, 0.5],
    [0.2, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
    [0.8, 0.2],
  ].map((p) => [Math.floor(screen.width * p[0]), Math.floor(screen.height * p[1])]);
  // Explicit native block seams, in addition to viewport-interior samples.
  for (const entry of app.native.entries) {
    if (entry.tile.level.id !== level.id) continue;
    const b = entry.tile.bounds,
      p = v.project(b[0], (b[1] + b[3]) / 2);
    if (
      p[0] > size &&
      p[0] < screen.width / dpr - size &&
      p[1] > size &&
      p[1] < screen.height / dpr - size
    )
      centers.push([Math.floor(p[0] * dpr), Math.floor(p[1] * dpr)]);
    if (centers.length >= 9) break;
  }
  const rows = [];
  for (const [cx, cy] of centers) {
    const x0 = cx - size / 2,
      y0 = cy - size / 2;
    const locate = (x: number, y: number) => {
      const p = v.unproject((x0 + x) / ratioX, (y0 + y) / ratioY);
      return toSource.unproject(p[0], p[1]);
    };
    const a = locate(0, 0),
      b = locate(size, size);
    const win = [
      Math.max(0, Math.floor(a[0]) - 1),
      Math.max(0, Math.floor(a[1]) - 1),
      Math.min(level.width, Math.ceil(b[0]) + 1),
      Math.min(level.height, Math.ceil(b[1]) + 1),
    ] as const;
    if (win[2] <= win[0] || win[3] <= win[1]) continue;
    const request = {
      level: level.id,
      window: win,
      samples: Array.from({ length: level.samples }, (_, i) => i),
    };
    const result = await app.source.readWindow(request);
    const bands = style.bands ?? (level.samples >= 3 ? [0, 1, 2] : [0]);
    const expected = colorizeRasterTile(
      meta,
      {
        request,
        level,
        width: size,
        height: size,
        bands,
        locate,
        warp: { mode: 'grid', columns: 2, step: 1, points: new Float64Array() },
      },
      result,
      style,
    );
    let max = 0,
      large = 0,
      valid = 0,
      transparent = 0,
      boundaryPixels = 0,
      interiorMax = 0;
    const details: any[] = [];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4,
          j = ((y0 + y) * screen.width + x0 + x) * 4;
        const alpha = expected[i + 3] * (style.opacity ?? 1),
          ga = screen.pixels[j + 3];
        if (alpha) valid++;
        else transparent++;
        let error = Math.abs(alpha - ga);
        for (let k = 0; k < 3; k++)
          error = Math.max(
            error,
            Math.abs((expected[i + k] * alpha) / 255 - (screen.pixels[j + k] * ga) / 255),
          );
        max = Math.max(max, error);
        let boundaryMatch = false;
        if (error > 3 && style.resampling === 'nearest') {
          const p = locate(x + 0.5, y + 0.5),
            eps = 0.0001;
          const xs = Math.abs(p[0] - Math.round(p[0])) < eps ? [-eps, 0, eps] : [0];
          const ys = Math.abs(p[1] - Math.round(p[1])) < eps ? [-eps, 0, eps] : [0];
          if (xs.length > 1 || ys.length > 1)
            for (const dx of xs)
              for (const dy of ys) {
                const candidate = colorizeRasterTile(
                  meta,
                  {
                    request,
                    level,
                    width: 1,
                    height: 1,
                    bands,
                    locate: () => [p[0] + dx, p[1] + dy],
                    warp: { mode: 'grid', columns: 2, step: 1, points: new Float64Array() },
                  },
                  result,
                  style,
                );
                const ca = candidate[3] * (style.opacity ?? 1);
                let difference = Math.abs(ca - ga);
                for (let k = 0; k < 3; k++)
                  difference = Math.max(
                    difference,
                    Math.abs((candidate[k] * ca) / 255 - (screen.pixels[j + k] * ga) / 255),
                  );
                if (difference <= 3) boundaryMatch = true;
              }
        }
        if (boundaryMatch) boundaryPixels++;
        else {
          interiorMax = Math.max(interiorMax, error);
          if (error > 3) {
            large++;
            if (details.length < 4)
              details.push({ pixel: [x0 + x, y0 + y], source: locate(x + 0.5, y + 0.5), error });
          }
        }
      }
    rows.push({
      center: [cx, cy],
      max,
      interiorMax,
      large,
      boundaryPixels,
      valid,
      transparent,
      details,
    });
  }
  return rows;
};
(window as any).checkStripWindows = async () => {
  const file = (document.querySelector('#file-input') as HTMLInputElement).files![0];
  const source = new LocalRasterFileSource(file);
  const tiff = await GeoTIFF.fromSource(source, { cache: false });
  const image = await tiff.getImage();
  // Warm directory arrays only; pixel bytes remain cold for each comparison.
  await image.getFileDirectory().loadValue('StripOffsets');
  await image.getFileDirectory().loadValue('StripByteCounts');
  const rows = [];
  try {
    for (const [x, y] of [
      [0, 0],
      [27000, 28000],
      [54734, 56529],
    ]) {
      source.beginRead();
      const before = source.getDiagnostics().readBytes;
      const request = { level: 0, window: [x, y, x + 32, y + 16] as const, samples: [2, 0, 1] };
      const expected = await image.readRasters({
        window: [...request.window],
        samples: [...request.samples],
        interleave: false,
      });
      const middle = source.getDiagnostics().readBytes;
      source.beginRead();
      const actual = await readNumericWindow(image, request);
      let mismatch = 0;
      for (let b = 0; b < 3; b++)
        for (let i = 0; i < 32 * 16; i++) if (actual.data[b][i] !== expected[b][i]) mismatch++;
      rows.push({
        x,
        y,
        mismatch,
        legacyBytes: middle - before,
        directBytes: source.getDiagnostics().readBytes - middle,
      });
    }
  } finally {
    await source.close();
  }
  return rows;
};
