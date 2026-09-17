import { RasterError, validateRasterWindow } from '../../../domain/raster/policy';
import type {
  RasterMetadata,
  RasterRenderRequest,
  RasterWarpMesh,
} from '../../../domain/raster/types';

type Coordinate = [number, number];
export function makeRasterWarp(
  grid: readonly (Coordinate | null)[],
  columns: number,
  step: number,
  size: number,
  locate: (x: number, y: number) => Coordinate | null,
): RasterWarpMesh {
  if (grid.every((point) => point !== null && point.every(Number.isFinite))) {
    const points = new Float64Array(grid.length * 2);
    grid.forEach((point, i) => {
      points[i * 2] = point![0];
      points[i * 2 + 1] = point![1];
    });
    return { mode: 'grid', columns, step, points };
  }
  // Exceptional projection boundaries need the exact old center-coordinate fallback.
  // Do not serialize functions or silently replace invalid cells with linear guesses.
  const points = new Float64Array(size * size * 2).fill(NaN);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const p = locate(x + 0.5, y + 0.5);
      if (p) {
        const i = (y * size + x) * 2;
        points[i] = p[0];
        points[i + 1] = p[1];
      }
    }
  return { mode: 'pixels', columns: size, step: 1, points };
}

export function rasterWarpLocator(
  mesh: RasterWarpMesh,
  width: number,
): (x: number, y: number, output?: Coordinate) => Coordinate | null {
  const { points, columns, step, mode } = mesh;
  return (x, y, output) => {
    const result = output ?? [0, 0];
    if (mode === 'pixels') {
      const index = (Math.floor(y) * width + Math.floor(x)) * 2;
      if (!Number.isFinite(points[index]) || !Number.isFinite(points[index + 1])) return null;
      result[0] = points[index];
      result[1] = points[index + 1];
    } else {
      const col = Math.min(columns - 2, Math.floor(x / step)),
        row = Math.min(columns - 2, Math.floor(y / step));
      const u = x / step - col,
        v = y / step - row,
        a = (row * columns + col) * 2,
        b = a + 2,
        c = a + columns * 2,
        d = c + 2;
      result[0] =
        (points[a] * (1 - u) + points[b] * u) * (1 - v) + (points[c] * (1 - u) + points[d] * u) * v;
      result[1] =
        (points[a + 1] * (1 - u) + points[b + 1] * u) * (1 - v) +
        (points[c + 1] * (1 - u) + points[d + 1] * u) * v;
    }
    return result;
  };
}

/** Validate before either posting or allocating decoded/display buffers. Returns a reservation. */
export function validateRasterRender(
  metadata: RasterMetadata,
  request: RasterRenderRequest,
): number {
  const { width, height, warp, read } = request;
  if (!Number.isSafeInteger(width) || width < 1 || width > 1024 || height !== width)
    throw new RasterError(
      'INVALID_RASTER_RENDER',
      'Display tiles must be square with 1–1024 pixels per edge.',
    );
  const { step, columns, mode, points } = warp;
  if (
    !(points instanceof Float64Array) ||
    !Number.isSafeInteger(columns) ||
    columns < 1 ||
    (mode === 'grid'
      ? ![1, 2, 4, 8, 16].includes(step) ||
        columns !== Math.ceil(width / step) + 1 ||
        points.length !== columns * columns * 2
      : mode !== 'pixels' ||
        step !== 1 ||
        columns !== width ||
        points.length !== width * height * 2)
  )
    throw new RasterError('INVALID_RASTER_WARP', 'Invalid serialized projection mesh.');
  const level = metadata.levels.find((item) => item.id === read.level);
  if (!level) throw new RasterError('INVALID_LEVEL', 'Unknown raster level.');
  const bytes =
    validateRasterWindow(level, read.window, read.samples) + points.byteLength + width * height * 4;
  if (bytes > 64 * 1024 ** 2)
    throw new RasterError(
      'RASTER_READ_BUDGET',
      'Combined decode, warp and display request exceeds 64MiB.',
    );
  return bytes;
}
