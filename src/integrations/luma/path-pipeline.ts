import type { MeshPaint } from './types';
export type PathRenderMode = 'auto' | 'reference' | 'legacy';
/** Solid opaque strokes alone can replace per-sample color and reuse coverage depth.
 * Analytic fringes, dashes and translucent strokes retain the existing pipeline.
 * No change to raw coordinates, segment counts, line widths or pixel ratio.
 */
export function useMsaaPath(paint: MeshPaint, mode: PathRenderMode, samples: number): boolean {
  const width = paint.width ?? 1;
  return (
    mode !== 'legacy' &&
    samples > 1 &&
    Number.isFinite(width) &&
    width > 0 &&
    paint.color[3] === 1 &&
    !paint.dash?.length &&
    !paint.arrow
  );
}
export function opaquePathGroup(paint: MeshPaint): string {
  return 'path:' + paint.color.join(',');
}
