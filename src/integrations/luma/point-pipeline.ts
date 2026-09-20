import type { MeshPaint } from './types';

/** Only the ordinary filled circle has the specialized Scatterplot-style path. */
export function isFilledCircle(paint: MeshPaint): boolean {
  return paint.filled !== false && !paint.marker?.length;
}

/** Coverage optimization never groups different colors or non-opaque symbols. */
export function opaqueCircleGroup(
  paint: MeshPaint,
  enabled: boolean,
  pixelRatio: number,
): string | null {
  const radius = paint.radius ?? 4;
  if (
    !enabled ||
    !isFilledCircle(paint) ||
    paint.color[3] !== 1 ||
    !Number.isFinite(radius) ||
    !Number.isFinite(pixelRatio) ||
    pixelRatio <= 0 ||
    (radius - 0.5) * 0.7071067 - 1 / pixelRatio <= 0
  )
    return null;
  return paint.color.join(',');
}
