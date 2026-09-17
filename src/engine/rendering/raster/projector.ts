import { resolveProjectCrs } from '../../../domain/geo/crs-resolver';
import { createWgs84CoordinateTransformer } from '../../../integrations/mapshaper/adapter';
import { RasterError } from '../../../domain/raster/policy';
import type { RasterWindow } from '../../../domain/raster/types';

export type RasterCoordinateTransform = (x: number, y: number) => [number, number] | null;
export async function rasterCoordinateTransform(
  from: string,
  to: string,
): Promise<RasterCoordinateTransform> {
  const [a, b] = await Promise.all([resolveProjectCrs(from), resolveProjectCrs(to)]);
  if (a === b) return (x, y) => [x, y];
  const source = createWgs84CoordinateTransformer(a),
    target = createWgs84CoordinateTransformer(b);
  return (x, y) => {
    const point = source.inverse([x, y]);
    return point ? target.forward(point) : null;
  };
}
export function transformRasterBounds(
  bounds: RasterWindow,
  transform: RasterCoordinateTransform,
): RasterWindow {
  let left = Infinity,
    bottom = Infinity,
    right = -Infinity,
    top = -Infinity;
  for (let i = 0; i <= 32; i++) {
    const x = bounds[0] + ((bounds[2] - bounds[0]) * i) / 32;
    const y = bounds[1] + ((bounds[3] - bounds[1]) * i) / 32;
    for (const input of [
      [x, bounds[1]],
      [x, bounds[3]],
      [bounds[0], y],
      [bounds[2], y],
    ]) {
      const point = transform(input[0], input[1]);
      if (!point || !point.every(Number.isFinite)) continue;
      left = Math.min(left, point[0]);
      bottom = Math.min(bottom, point[1]);
      right = Math.max(right, point[0]);
      top = Math.max(top, point[1]);
    }
  }
  if (![left, bottom, right, top].every(Number.isFinite) || left >= right || bottom >= top)
    throw new RasterError(
      'RASTER_PROJECTION_FAILED',
      'Raster bounds cannot be transformed into the map CRS.',
    );
  return [left, bottom, right, top];
}
