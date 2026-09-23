import { getDefaultMapshaperAdapter } from '../../../../src/integrations/mapshaper/adapter';
import type { RasterSource, RasterMetadata } from '../../../../src/domain/raster/types';
import { generateScene, vectorScene } from '../luma-benchmark/scene';

/** Explicit calibration data, not a substitute for real-file performance tests. */
export async function calibrationScene(signal: AbortSignal) {
  const generated = await generateScene('polygon', 144, signal);
  generated.dataset.layers.push({
    name: 'control-points',
    geometry_type: 'point',
    shapes: Array.from({ length: 9 }, (_, i) => [
      [13001000 + (i % 3) * 3500, 4001000 + Math.floor(i / 3) * 3500],
    ]),
  });
  for (const [index, layer] of generated.dataset.layers.entries()) {
    layer.data = getDefaultMapshaperAdapter().createDataTable((layer.shapes ?? []).map((_, id) => ({
      name: `${index === 0 ? '地块' : '控制点'} ${id + 1}`, code: id + 1,
    })));
  }
  return vectorScene(generated.dataset, '演示网格 / 原始面与控制点');
}
export function calibrationRaster(): RasterSource {
  let closed = false;
  const metadata: RasterMetadata = {
    filename: '演示棋盘格（内存生成，含 NoData）',
    fileSize: 0,
    lastModified: 0,
    crs: 'EPSG:3857',
    bounds: [13000000, 4000000, 13010000, 4010000],
    origin: [13000000, 4010000],
    resolution: [10000 / 1024, -10000 / 1024],
    levels: [
      {
        id: 0,
        width: 1024,
        height: 1024,
        tileWidth: 256,
        tileHeight: 256,
        samples: 3,
        bits: [8, 8, 8],
        formats: [1, 1, 1],
        photometric: 2,
        subfileType: 0,
      },
    ],
    statistics: Array.from({ length: 3 }, () => ({
      min: 0,
      max: 255,
      p02: 0,
      p98: 255,
      count: 1024 ** 2,
      approximate: false,
    })),
    noData: 0,
    alphaBand: null,
    bigTiff: false,
  };
  return {
    metadata,
    async readWindow(request, signal) {
      await new Promise<void>((r) => setTimeout(r, 0));
      signal?.throwIfAborted();
      if (closed) throw new DOMException('Source disposed', 'AbortError');
      const [x0, y0, x1, y1] = request.window,
        width = x1 - x0,
        height = y1 - y0;
      const data = Array.from({ length: 3 }, () => new Uint8Array(width * height));
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const gx = x + x0,
            gy = y + y0,
            cellX = Math.floor(gx / 64),
            cellY = Math.floor(gy / 64);
          const empty = cellX === 7 && cellY === 7;
          const rgb = empty ? [0, 0, 0] : (cellX + cellY) % 2 ? [165, 205, 222] : [222, 237, 239];
          for (let b = 0; b < 3; b++) data[b][y * width + x] = rgb[b];
        }
      return { width, height, data };
    },
    toReference() {
      throw new Error('Calibration data is not a persistent source.');
    },
    dispose() {
      closed = true;
    },
  };
}
